pdfjsLib.GlobalWorkerOptions.workerSrc =
  "vendor/pdf.worker.min.js";

const IMG = ["png", "jpg", "jpeg", "bmp", "webp"];
const ROUTES = { pdf: ["docx", "xlsx"], docx: ["pdf"] };
IMG.forEach((e) => (ROUTES[e] = ["csv", "xlsx"]));

const $ = (id) => document.getElementById(id);
const ext = (name) => name.split(".").pop().toLowerCase();

function setStatus(msg, err) {
  $("status").textContent = msg;
  $("status").className = err ? "err" : "";
}
function setProgress(p) {
  $("bar").hidden = p == null;
  if (p != null) $("bar").value = p;
}

/* ---------- palavras -> linhas/colunas ----------
   word: {text, x, r, y (centro vertical), h} */
function wordsToRows(words, gapFactor = 1.5) {
  if (!words.length) return [];
  words = words.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  let cur = [words[0]];
  for (const w of words.slice(1)) {
    const last = cur[cur.length - 1];
    if (Math.abs(w.y - last.y) <= Math.max(w.h, last.h) * 0.6) cur.push(w);
    else { lines.push(cur); cur = [w]; }
  }
  lines.push(cur);

  const hs = words.map((w) => w.h).sort((a, b) => a - b);
  const gap = hs[Math.floor(hs.length / 2)] * gapFactor;
  const rows = lines.map((line) => {
    line.sort((a, b) => a.x - b.x);
    const cells = [];
    let cell = [line[0].text], lastR = line[0].r;
    for (const w of line.slice(1)) {
      if (w.x - lastR > gap) { cells.push(cell.join(" ")); cell = []; }
      cell.push(w.text);
      lastR = w.r;
    }
    cells.push(cell.join(" "));
    return cells;
  });
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.concat(Array(width - r.length).fill("")));
}

/* ---------- OCR ---------- */
let worker;
async function getWorker() {
  if (!worker) {
    worker = await Tesseract.createWorker("por+eng", 1, {
      workerPath: new URL("vendor/worker.min.js", location.href).href,
      corePath: new URL("vendor/tesseract-core/", location.href).href,
      langPath: new URL("vendor/lang/", location.href).href,
      logger: (m) => {
        if (m.status === "recognizing text") setProgress(m.progress);
        else setStatus(m.status);
      },
    });
    await worker.setParameters({ tessedit_pageseg_mode: "6" });
  }
  return worker;
}
async function ocr(source) {
  const w = await getWorker();
  const { data } = await w.recognize(source);
  const words = (data.words || [])
    .filter((x) => x.text.trim())
    .map((x) => ({
      text: x.text.trim(), x: x.bbox.x0, r: x.bbox.x1,
      y: (x.bbox.y0 + x.bbox.y1) / 2, h: x.bbox.y1 - x.bbox.y0,
    }));
  return { text: data.text, words, raw: (data.words || []).filter((x) => x.text.trim()) };
}

/* ---------- PDF ---------- */
async function loadPdf(file) {
  return pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}
async function pageWords(page) {
  const tc = await page.getTextContent();
  return tc.items
    .filter((i) => i.str.trim())
    .map((i) => ({
      text: i.str.trim(), x: i.transform[4], r: i.transform[4] + i.width,
      y: -i.transform[5], h: i.height || 10,
    }));
}
async function pageCanvas(page) {
  const vp = page.getViewport({ scale: PdfLayout.SCALE });
  const c = document.createElement("canvas");
  c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  return c;
}
async function pdfHasText(pdf) {
  for (let i = 1; i <= pdf.numPages; i++)
    if ((await pageWords(await pdf.getPage(i))).length) return true;
  return false;
}

async function pdfToDocx(file) {
  const pdf = await loadPdf(file);
  const scanned = !(await pdfHasText(pdf));
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    setStatus(`Página ${i}/${pdf.numPages}${scanned ? " (OCR)" : ""}`);
    const page = await pdf.getPage(i);
    const canvas = await pageCanvas(page);
    const img = PdfLayout.makeImage(canvas);
    const items = scanned
      ? PdfLayout.ocrItems((await ocr(canvas)).raw, img)
      : await PdfLayout.nativeItems(page, img);
    pages.push({ width: page.view[2] - page.view[0], height: page.view[3] - page.view[1], items, img });
  }
  return PdfLayout.toDocxBlob(pages);
}

function rowsToXlsxBlob(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of sheets)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  if (!wb.SheetNames.length) throw new Error("Nenhuma tabela/texto encontrado.");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function pdfToXlsx(file) {
  const pdf = await loadPdf(file);
  const scanned = !(await pdfHasText(pdf));
  const sheets = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    setStatus(`Página ${i}/${pdf.numPages}${scanned ? " (OCR)" : ""}`);
    const page = await pdf.getPage(i);
    const words = scanned ? (await ocr(await pageCanvas(page))).words : await pageWords(page);
    const rows = wordsToRows(words, scanned ? 1.5 : 0.4);
    if (rows.length) sheets.push([`p${i}`, rows]);
  }
  return rowsToXlsxBlob(sheets);
}

/* ---------- imagem ---------- */
async function imageToRows(file) {
  const url = URL.createObjectURL(file);
  try { return wordsToRows((await ocr(url)).words); }
  finally { URL.revokeObjectURL(url); }
}
async function imageToCsv(file) {
  const rows = await imageToRows(file);
  const esc = (c) => (/[",\n;]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}
async function imageToXlsx(file) {
  return rowsToXlsxBlob([["Planilha", await imageToRows(file)]]);
}

/* ---------- DOCX -> PDF (somente texto) ---------- */
async function docxToPdf(file) {
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const pdf = new jspdf.jsPDF({ unit: "mm", format: "a4" });
  const w = 180, lh = 6;
  let y = 15;
  pdf.setFontSize(11);
  for (const para of value.split("\n")) {
    for (const line of para ? pdf.splitTextToSize(para, w) : [""]) {
      if (y > 285) { pdf.addPage(); y = 15; }
      pdf.text(line, 15, y);
      y += lh;
    }
  }
  return pdf.output("blob");
}

/* ---------- UI ---------- */
async function convert(file, to) {
  const from = ext(file.name);
  if (from === "pdf" && to === "docx") return pdfToDocx(file);
  if (from === "pdf" && to === "xlsx") return pdfToXlsx(file);
  if (from === "docx" && to === "pdf") return docxToPdf(file);
  if (IMG.includes(from) && to === "csv") return imageToCsv(file);
  if (IMG.includes(from) && to === "xlsx") return imageToXlsx(file);
  throw new Error(`Conversão ${from} → ${to} não suportada`);
}

$("file").addEventListener("change", () => {
  const f = $("file").files[0];
  const opts = f ? ROUTES[ext(f.name)] || [] : [];
  $("to").innerHTML = opts.map((o) => `<option>${o}</option>`).join("");
  $("to").disabled = $("go").disabled = !opts.length;
  $("result").innerHTML = "";
  setStatus(f && !opts.length ? "Formato de entrada não suportado." : "", !!f && !opts.length);
});

$("go").addEventListener("click", async () => {
  const f = $("file").files[0], to = $("to").value;
  $("go").disabled = true;
  $("result").innerHTML = "";
  setStatus("Convertendo…");
  try {
    const blob = await convert(f, to);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = f.name.replace(/\.[^.]+$/, "") + "." + to;
    a.id = "download";
    a.textContent = "Baixar " + a.download;
    $("result").appendChild(a);
    setStatus("Pronto.");
  } catch (e) {
    console.error(e);
    setStatus("Falha: " + e.message, true);
  } finally {
    setProgress(null);
    $("go").disabled = false;
  }
});
