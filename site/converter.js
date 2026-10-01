pdfjsLib.GlobalWorkerOptions.workerSrc =
  "vendor/pdf.worker.min.js";

const IMG = ["png", "jpg", "jpeg", "bmp", "webp"];
const ROUTES = { pdf: ["docx", "xlsx"], docx: ["pdf"], csv: ["txt", "jpg"] };
IMG.forEach((e) => (ROUTES[e] = ["csv", "xlsx"]));

const $ = (id) => document.getElementById(id);
const ext = (name) => name.split(".").pop().toLowerCase();

function setStatus(msg, err) {
  $("status").textContent = msg;
  $("status").classList.toggle("err", !!err);
}
function setProgress(p) {
  $("bar").hidden = p == null;
  $("bar").firstElementChild.style.width = p == null ? "0" : Math.round(p * 100) + "%";
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
        const t = { "loading tesseract core": "Carregando o motor de OCR…", "loading language traineddata": "Carregando o idioma…",
          "initializing tesseract": "Iniciando o OCR…", "initializing api": "Iniciando o OCR…" }[m.status];
        if (m.status === "recognizing text") { setStatus("Lendo o texto da imagem…"); setProgress(m.progress); }
        else if (t) setStatus(t);
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

/* ---------- CSV -> TXT / JPG ---------- */
async function readCsv(file) {
  const buf = await file.arrayBuffer();
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch (e) { text = new TextDecoder("latin1").decode(buf); }
  text = text.replace(/^\ufeff/, "");
  const head = text.split("\n").slice(0, 5).join("\n");
  const delim = [",", ";", "\t", "|"].map((d) => [d, head.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const data = rows.filter((r) => r.some((c) => c.trim()));
  if (!data.length) throw new Error("CSV vazio.");
  const w = Math.max(...data.map((r) => r.length));
  return data.map((r) => r.concat(Array(w - r.length).fill("")));
}

async function csvToTxt(file) {
  const rows = await readCsv(file);
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => [...r[i]].length)));
  const out = rows.map((r) => r.map((c, i) => c + " ".repeat(widths[i] - [...c].length)).join("  ").trimEnd());
  return new Blob([out.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
}

async function csvToJpg(file) {
  const rows = await readCsv(file);
  if (rows.length > 600) throw new Error("CSV com linhas demais para uma imagem (máx. 600).");
  const S = 2, pad = 12, rowH = 38, font = "system-ui, Arial, sans-serif";
  const probe = document.createElement("canvas").getContext("2d");
  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map((r, n) => { probe.font = `${n ? "" : "bold "}18px ${font}`; return probe.measureText(r[i]).width; })) + pad * 2);
  const W = Math.ceil(widths.reduce((a, b) => a + b, 0)), H = rowH * rows.length;
  const cv = document.createElement("canvas");
  cv.width = (W + 1) * S; cv.height = (H + 1) * S;
  const g = cv.getContext("2d");
  g.scale(S, S);
  g.fillStyle = "#fff"; g.fillRect(0, 0, W + 1, H + 1);
  g.textBaseline = "middle";
  rows.forEach((r, n) => {
    if (n === 0) { g.fillStyle = "#dfe6f5"; g.fillRect(0, 0, W, rowH); }
    else if (n % 2 === 0) { g.fillStyle = "#f6f8fc"; g.fillRect(0, n * rowH, W, rowH); }
    g.fillStyle = "#000"; g.font = `${n ? "" : "bold "}18px ${font}`;
    let x = 0;
    r.forEach((c, i) => { g.fillText(c, x + pad, n * rowH + rowH / 2); x += widths[i]; });
  });
  g.strokeStyle = "#b8c0d0"; g.lineWidth = 1; g.beginPath();
  for (let n = 0; n <= rows.length; n++) { g.moveTo(0, n * rowH + .5); g.lineTo(W, n * rowH + .5); }
  let x = 0;
  for (const w of [0, ...widths]) { x += w; g.moveTo(x + .5, 0); g.lineTo(x + .5, H); }
  g.stroke();
  return new Promise((ok, no) => cv.toBlob((b) => (b ? ok(b) : no(new Error("Falha ao gerar a imagem."))), "image/jpeg", 0.92));
}

/* ---------- UI ---------- */
async function convert(file, to) {
  const from = ext(file.name);
  if (from === "pdf" && to === "docx") return pdfToDocx(file);
  if (from === "pdf" && to === "xlsx") return pdfToXlsx(file);
  if (from === "docx" && to === "pdf") return docxToPdf(file);
  if (from === "csv" && to === "txt") return csvToTxt(file);
  if (from === "csv" && to === "jpg") return csvToJpg(file);
  if (IMG.includes(from) && to === "csv") return imageToCsv(file);
  if (IMG.includes(from) && to === "xlsx") return imageToXlsx(file);
  throw new Error(`Conversão ${from} → ${to} não suportada`);
}

const LABEL = { docx: "Word", xlsx: "Excel", csv: "CSV", pdf: "PDF", txt: "Texto", jpg: "Imagem" };
const HINT = {
  docx: "Documento editável", xlsx: "Planilha", csv: "Texto separado por vírgulas", pdf: "Documento fixo",
  txt: "Colunas alinhadas", jpg: "Tabela como imagem",
};
let file = null, target = null, downloadUrl = null;

function show(step) { // "pick" | "setup" | "work" | "done"
  for (const s of ["pick", "setup", "work", "done"]) $("step-" + s).hidden = s !== step;
}
function fmtSize(n) {
  return n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1024 / 1024).toFixed(1) + " MB";
}

function reset() {
  file = target = null;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  $("file").value = "";
  setStatus("");
  setProgress(null);
  $("drop").classList.remove("error");
  $("pick-error").textContent = "";
  show("pick");
}

function choose(f) {
  if (!f) return;
  const opts = ROUTES[ext(f.name)];
  if (!opts) {
    $("pick-error").textContent = `Não consigo converter arquivos .${ext(f.name)}. Use PDF, DOCX, CSV, PNG, JPG, BMP ou WEBP.`;
    $("drop").classList.add("error");
    return;
  }
  file = f;
  $("pick-error").textContent = "";
  $("drop").classList.remove("error");
  $("file-ext").textContent = ext(f.name).toUpperCase();
  $("file-name").textContent = f.name;
  $("file-size").textContent = fmtSize(f.size);
  $("formats").innerHTML = opts
    .map((o) => `<button type="button" class="fmt" data-fmt="${o}"><b>${LABEL[o]}</b><span>.${o} · ${HINT[o]}</span></button>`)
    .join("");
  select(opts[0]);
  show("setup");
}

function select(fmt) {
  target = fmt;
  for (const b of document.querySelectorAll(".fmt")) b.setAttribute("aria-pressed", b.dataset.fmt === fmt);
  $("go").textContent = "Converter para " + LABEL[fmt];
}

$("formats").addEventListener("click", (e) => {
  const b = e.target.closest(".fmt");
  if (b) select(b.dataset.fmt);
});
$("file").addEventListener("change", () => choose($("file").files[0]));
for (const id of ["change", "again"]) $(id).addEventListener("click", reset);

const drop = $("drop");
["dragenter", "dragover"].forEach((t) =>
  drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) =>
  drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => choose(e.dataTransfer.files[0]));
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

$("go").addEventListener("click", async () => {
  show("work");
  setStatus("Convertendo…");
  setProgress(null);
  try {
    const blob = await convert(file, target);
    const name = file.name.replace(/\.[^.]+$/, "") + "." + target;
    downloadUrl = URL.createObjectURL(blob);
    const a = $("download");
    a.href = downloadUrl;
    a.download = name;
    $("out-name").textContent = name;
    $("out-size").textContent = fmtSize(blob.size);
    show("done");
  } catch (e) {
    console.error(e);
    show("setup");
    $("setup-error").textContent = "Não foi possível converter: " + e.message;
    return;
  } finally {
    setProgress(null);
  }
  $("setup-error").textContent = "";
});
