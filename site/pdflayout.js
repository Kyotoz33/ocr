/* Reconstrói o layout de uma página de PDF (texto nativo ou OCR) em DOCX:
   tabelas, tamanho/negrito/cor da fonte, cor de fundo e bordas das células.
   Coordenadas internas em pontos (pt), origem no canto superior esquerdo. */
const PdfLayout = (() => {
  const SCALE = 3; // escala do canvas usado para amostrar cores e linhas

  /* ---------- amostragem de pixels ---------- */
  function makeImage(canvas) {
    const { width: w, height: h } = canvas;
    const data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    const luma = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < luma.length; i++, j += 4)
      luma[i] = (data[j] * 299 + data[j + 1] * 587 + data[j + 2] * 114) / 1000;
    return { w, h, data, luma };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hex = (c) => c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

  /* cor de fundo (a mais comum) e de texto (a mais distante do fundo) de um retângulo */
  function rectColors(img, x0, y0, x1, y1) {
    const X0 = clamp(Math.floor(x0 * SCALE), 0, img.w - 1), X1 = clamp(Math.ceil(x1 * SCALE), X0 + 1, img.w);
    const Y0 = clamp(Math.floor(y0 * SCALE), 0, img.h - 1), Y1 = clamp(Math.ceil(y1 * SCALE), Y0 + 1, img.h);
    const sx = Math.max(1, Math.floor((X1 - X0) / 60)), sy = Math.max(1, Math.floor((Y1 - Y0) / 40));
    const hist = new Map();
    for (let y = Y0; y < Y1; y += sy)
      for (let x = X0; x < X1; x += sx) {
        const i = (y * img.w + x) * 4, d = img.data;
        const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
        const e = hist.get(k);
        if (e) { e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2]; }
        else hist.set(k, { n: 1, r: d[i], g: d[i + 1], b: d[i + 2] });
      }
    let best = null;
    for (const e of hist.values()) if (!best || e.n > best.n) best = e;
    const bg = [best.r / best.n, best.g / best.n, best.b / best.n];
    let far = null, fd = -1;
    for (let y = Y0; y < Y1; y++)
      for (let x = X0; x < X1; x++) {
        const i = (y * img.w + x) * 4, d = img.data;
        const dist = (d[i] - bg[0]) ** 2 + (d[i + 1] - bg[1]) ** 2 + (d[i + 2] - bg[2]) ** 2;
        if (dist > fd) { fd = dist; far = [d[i], d[i + 1], d[i + 2]]; }
      }
    return { bg, fg: far, dist: Math.sqrt(fd) };
  }
  const isWhite = (c) => c.every((v) => v > 244);
  const isBlack = (c) => c.every((v) => v < 70);

  /* ---------- itens (texto + posição + estilo) ---------- */
  async function nativeItems(page, img) {
    const tc = await page.getTextContent();
    const [vx, vy, , vh] = page.view;
    const fontInfo = {};
    const info = (name) => {
      if (!(name in fontInfo)) {
        let real = "";
        try { real = page.commonObjs.get(name).name || ""; } catch (e) { /* fonte não resolvida */ }
        const fam = (tc.styles[name] || {}).fontFamily || "";
        const all = real + " " + fam;
        const base = real.replace(/^[A-Z]{6}\+/, "").split(/[-,]/)[0].replace(/MT$/, "");
        fontInfo[name] = {
          bold: /bold|black|heavy|demi/i.test(all),
          italic: /italic|oblique/i.test(all),
          font: pickFont(base, fam),
        };
      }
      return fontInfo[name];
    };
    const items = [];
    for (const it of tc.items) {
      if (!it.str.trim()) continue;
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      const x = it.transform[4] - vx, base = vh - (it.transform[5] - vy);
      items.push({
        text: it.str, x, r: x + it.width, base, size,
        top: base - size * 0.85, bottom: base + size * 0.2, ...info(it.fontName),
      });
    }
    return items.map((it) => styleItem(img, it));
  }

  function ocrItems(words, img) {
    return words.map((w) => {
      const size = (w.bbox.y1 - w.bbox.y0) / SCALE;
      return styleItem(img, {
        text: w.text, x: w.bbox.x0 / SCALE, r: w.bbox.x1 / SCALE, size,
        base: w.bbox.y1 / SCALE - size * 0.1, top: w.bbox.y0 / SCALE, bottom: w.bbox.y1 / SCALE,
        bold: false, italic: false, font: "Arial",
      });
    });
  }

  const SAFE_FONTS = ["Arial", "Calibri", "Cambria", "Times New Roman", "Courier New", "Verdana", "Tahoma", "Georgia", "Trebuchet MS"];
  function pickFont(name, family) {
    const n = name.replace(/\s+/g, "").toLowerCase();
    for (const f of SAFE_FONTS) if (n.startsWith(f.replace(/\s+/g, "").toLowerCase())) return f;
    if (/helvetica|arial/i.test(name)) return "Arial";
    if (/times/i.test(name) || /serif/.test(family) && !/sans/.test(family)) return "Times New Roman";
    if (/courier|mono/i.test(name + family)) return "Courier New";
    return "Arial";
  }

  function styleItem(img, it) {
    const c = rectColors(img, it.x, it.top, it.r, it.bottom);
    it.bg = isWhite(c.bg) ? null : hex(c.bg);
    it.color = c.dist > 90 && !isBlack(c.fg) ? hex(c.fg) : null;
    return it;
  }

  /* ---------- itens -> linhas -> células ---------- */
  function buildLines(items) {
    items = items.slice().sort((a, b) => a.base - b.base || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(it.base - last.base) <= 0.45 * Math.max(it.size, last.size)) {
        last.items.push(it);
        if (it.size > last.size) { last.size = it.size; last.base = it.base; }
      } else lines.push({ items: [it], base: it.base, size: it.size });
    }
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      line.cells = [];
      let cell = null;
      for (const it of line.items) {
        const run = { text: it.text, size: it.size, bold: it.bold, italic: it.italic, font: it.font, color: it.color };
        const prev = cell && cell.last;
        if (prev && it.x - prev.r <= 0.7 * Math.max(it.size, prev.size)) {
          if (it.x - prev.r > 0.12 * it.size && !/\s$/.test(prev.runText) && !/^\s/.test(it.text)) run.text = " " + run.text;
          cell.runs.push(run);
          cell.r = it.r; cell.last = { r: it.r, size: it.size, runText: it.text };
          cell.top = Math.min(cell.top, it.top); cell.bottom = Math.max(cell.bottom, it.bottom);
        } else {
          cell = {
            x: it.x, r: it.r, runs: [run], bg: it.bg, top: it.top, bottom: it.bottom,
            last: { r: it.r, size: it.size, runText: it.text },
          };
          line.cells.push(cell);
        }
      }
      line.top = Math.min(...line.cells.map((c) => c.top));
      line.bottom = Math.max(...line.cells.map((c) => c.bottom));
    }
    return lines;
  }

  /* agrupa linhas consecutivas com ≥2 células em tabelas (uma linha solta entre duas de tabela é absorvida) */
  function segment(lines) {
    const isT = lines.map((l) => l.cells.length >= 2);
    for (let i = 1; i < lines.length - 1; i++) if (!isT[i] && isT[i - 1] && isT[i + 1]) isT[i] = true;
    const blocks = [];
    for (let i = 0; i < lines.length; i++) {
      const last = blocks[blocks.length - 1];
      if (last && last.table === isT[i] && isT[i]) last.lines.push(lines[i]);
      else blocks.push({ table: isT[i], lines: [lines[i]] });
    }
    return blocks;
  }

  /* colunas: faixas de x cobertas por conteúdo; vãos (quase) vazios separam colunas */
  function findBands(lines) {
    let xmin = Infinity, xmax = -Infinity;
    for (const l of lines) for (const c of l.cells) { xmin = Math.min(xmin, c.x); xmax = Math.max(xmax, c.r); }
    xmin = Math.floor(xmin); xmax = Math.ceil(xmax);
    const cover = new Int32Array(xmax - xmin + 2);
    for (const l of lines) for (const c of l.cells)
      for (let x = Math.floor(c.x) - xmin; x < Math.ceil(c.r) - xmin; x++) cover[x]++;
    const allowed = Math.floor(0.12 * lines.length);
    const bands = [];
    let start = null;
    for (let x = 0; x <= xmax - xmin + 1; x++) {
      const on = x <= xmax - xmin && cover[x] > allowed;
      if (on && start === null) start = x;
      if (!on && start !== null) { bands.push([start + xmin, x + xmin]); start = null; }
    }
    if (!bands.length) bands.push([xmin, xmax]);
    // fronteiras: ponto médio dos vãos; extremos = limites do bloco
    const bounds = [xmin];
    for (let i = 1; i < bands.length; i++) bounds.push((bands[i - 1][1] + bands[i][0]) / 2);
    bounds.push(xmax);
    return { bands, bounds, xmin, xmax };
  }

  /* ---------- bordas: procura linhas finas no canvas ---------- */
  function hLine(img, y, xa, xb) {
    // melhor linha horizontal em y±2.5pt: fração de pixels mais escuros que o entorno
    let best = 0, bestL = 255;
    const X0 = clamp(Math.floor(xa * SCALE), 0, img.w - 1), X1 = clamp(Math.ceil(xb * SCALE), X0 + 1, img.w);
    for (let py = Math.floor((y - 2.5) * SCALE); py <= Math.ceil((y + 2.5) * SCALE); py++) {
      if (py < 5 || py >= img.h - 5) continue;
      let n = 0, minL = 255;
      for (let x = X0; x < X1; x++) {
        const l = img.luma[py * img.w + x];
        const around = Math.min(img.luma[(py - 5) * img.w + x], img.luma[(py + 5) * img.w + x]);
        if (l + 25 < around) { n++; if (l < minL) minL = l; }
      }
      const f = n / (X1 - X0);
      if (f > best) { best = f; bestL = minL; }
    }
    return best >= 0.6 ? bestL : null;
  }
  function vLine(img, x, ya, yb) {
    let best = 0, bestL = 255;
    const Y0 = clamp(Math.floor(ya * SCALE), 0, img.h - 1), Y1 = clamp(Math.ceil(yb * SCALE), Y0 + 1, img.h);
    for (let px = Math.floor((x - 2.5) * SCALE); px <= Math.ceil((x + 2.5) * SCALE); px++) {
      if (px < 5 || px >= img.w - 5) continue;
      let n = 0, minL = 255;
      for (let y = Y0; y < Y1; y++) {
        const l = img.luma[y * img.w + px];
        const around = Math.min(img.luma[y * img.w + px - 5], img.luma[y * img.w + px + 5]);
        if (l + 25 < around) { n++; if (l < minL) minL = l; }
      }
      const f = n / (Y1 - Y0);
      if (f > best) { best = f; bestL = minL; }
    }
    return best >= 0.6 ? bestL : null;
  }
  const border = (lum) =>
    lum == null
      ? { style: docx.BorderStyle.NONE, size: 0, color: "FFFFFF" }
      : { style: docx.BorderStyle.SINGLE, size: 4, color: hex([lum, lum, lum]) };

  /* ---------- DOCX ---------- */
  const tw = (pt) => Math.max(0, Math.round(pt * 20));

  function runOf(r) {
    return new docx.TextRun({
      text: r.text, font: r.font, size: Math.max(2, Math.round(r.size * 2)),
      bold: r.bold, italics: r.italic, color: r.color || undefined,
    });
  }

  function buildTable(lines, img, margins) {
    const { bands, bounds } = findBands(lines);
    const nb = bands.length;
    const widths = [];
    for (let i = 0; i < nb; i++) widths.push(bounds[i + 1] - bounds[i]);
    const rowTop = lines.map((l) => l.top), rowBottom = lines.map((l) => l.bottom);
    const yb = [rowTop[0] - 1];
    for (let i = 0; i < lines.length - 1; i++) yb.push((rowBottom[i] + rowTop[i + 1]) / 2);
    yb.push(rowBottom[lines.length - 1] + 1);
    const tableLeft = bounds[0], tableRight = bounds[nb];

    const rows = lines.map((line, ri) => {
      // posiciona cada célula nas faixas
      const placed = [];
      let nextFree = 0;
      for (const c of line.cells) {
        let s = bands.findIndex((b) => b[1] > c.x + 0.5);
        let e = -1;
        bands.forEach((b, i) => { if (b[0] < c.r - 0.5) e = i; });
        if (s < 0) s = nb - 1;
        if (e < s) e = s;
        if (s < nextFree) s = nextFree;
        if (s >= nb) { // sem faixa livre: junta na célula anterior
          if (placed.length) placed[placed.length - 1].runs.push(...c.runs);
          continue;
        }
        if (e < s) e = s;
        placed.push({ s, e, runs: c.runs.slice(), bg: c.bg, x: c.x, r: c.r });
        nextFree = e + 1;
      }
      // completa vãos com células vazias
      const cells = [];
      let pos = 0;
      const addEmpty = (s, e) => {
        if (e < s) return;
        const x0 = bounds[s], x1 = bounds[e + 1];
        const c = rectColors(img, x0 + 1, yb[ri] + 1, x1 - 1, yb[ri + 1] - 1);
        cells.push({ s, e, runs: [], bg: isWhite(c.bg) ? null : hex(c.bg) });
      };
      for (const p of placed) { addEmpty(pos, p.s - 1); cells.push(p); pos = p.e + 1; }
      addEmpty(pos, nb - 1);

      const rowH = yb[ri + 1] - yb[ri];
      const tcells = cells.map((c) => {
        const x0 = bounds[c.s], x1 = bounds[c.e + 1];
        const size = c.runs.length ? Math.max(...c.runs.map((r) => r.size)) : 6;
        // mantém a posição exata do texto: recuo à esquerda/direita conforme o lado mais próximo
        let align = docx.AlignmentType.LEFT, indent;
        if (c.runs.length) {
          const leftGap = Math.max(0, c.x - x0), rightGap = Math.max(0, x1 - c.r);
          if (Math.abs(leftGap - rightGap) < Math.max(3, 0.08 * (x1 - x0))) align = docx.AlignmentType.CENTER;
          else if (rightGap < leftGap) { align = docx.AlignmentType.RIGHT; indent = { right: tw(rightGap) }; }
          else indent = { left: tw(leftGap) };
        }
        const top = ri === 0 ? border(hLine(img, yb[0], x0, x1)) : border(null);
        const bottom = border(hLine(img, yb[ri + 1], x0, x1));
        const left = c.s === 0 ? border(vLine(img, x0, yb[ri], yb[ri + 1])) : border(null);
        const right = border(vLine(img, x1, yb[ri], yb[ri + 1]));
        return new docx.TableCell({
          columnSpan: c.e - c.s + 1,
          width: { size: tw(x1 - x0), type: docx.WidthType.DXA },
          verticalAlign: docx.VerticalAlign.CENTER,
          shading: c.bg ? { type: docx.ShadingType.CLEAR, fill: c.bg, color: "auto" } : undefined,
          borders: { top, bottom, left, right },
          children: [new docx.Paragraph({
            alignment: align,
            indent,
            spacing: { before: 0, after: 0, line: tw(size * 1.2), lineRule: docx.LineRuleType.EXACT },
            children: c.runs.map(runOf),
          })],
        });
      });
      return new docx.TableRow({
        height: { value: tw(rowH), rule: docx.HeightRule.ATLEAST },
        cantSplit: true,
        children: tcells,
      });
    });

    return {
      table: new docx.Table({
        rows,
        width: { size: tw(tableRight - tableLeft), type: docx.WidthType.DXA },
        columnWidths: widths.map(tw),
        layout: docx.TableLayoutType.FIXED,
        indent: { size: tw(tableLeft - margins.left), type: docx.WidthType.DXA },
        margins: { top: 0, bottom: 0, left: 30, right: 30 },
        borders: {
          top: border(null), bottom: border(null), left: border(null), right: border(null),
          insideHorizontal: border(null), insideVertical: border(null),
        },
      }),
      top: rowTop[0], bottom: rowBottom[rowBottom.length - 1],
    };
  }

  function buildParagraph(line, prevBottom, margins) {
    const c = line.cells[0];
    return {
      para: new docx.Paragraph({
        indent: { left: tw(c.x - margins.left) },
        spacing: {
          before: tw(Math.max(0, line.top - prevBottom)), after: 0,
          line: tw(line.size * 1.2), lineRule: docx.LineRuleType.EXACT,
        },
        children: c.runs.map(runOf),
      }),
      top: line.top, bottom: line.bottom,
    };
  }

  /* pages: [{width, height, items, img}] -> Blob */
  function buildSection(page) {
    const lines = buildLines(page.items);
    if (!lines.length) return null;
    let minX = Infinity, maxR = 0;
    for (const l of lines) for (const c of l.cells) { minX = Math.min(minX, c.x); maxR = Math.max(maxR, c.r); }
    const margins = {
      left: Math.max(8, minX), right: Math.max(8, page.width - maxR),
      top: Math.max(8, lines[0].top), bottom: 10,
    };
    const children = [];
    let prevBottom = margins.top, prevWasTable = false;
    for (const block of segment(lines)) {
      if (block.table) {
        if (prevWasTable) children.push(new docx.Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: docx.LineRuleType.EXACT } }));
        const t = buildTable(block.lines, page.img, margins);
        children.push(t.table);
        prevBottom = t.bottom; prevWasTable = true;
      } else {
        for (const line of block.lines) {
          const p = buildParagraph(line, prevBottom, margins);
          children.push(p.para);
          prevBottom = p.bottom; prevWasTable = false;
        }
      }
    }
    const landscape = page.width > page.height;
    return {
      properties: {
        page: {
          size: {
            width: tw(Math.min(page.width, page.height)), height: tw(Math.max(page.width, page.height)),
            orientation: landscape ? docx.PageOrientation.LANDSCAPE : docx.PageOrientation.PORTRAIT,
          },
          margin: { left: tw(margins.left), right: tw(margins.right), top: tw(margins.top), bottom: tw(margins.bottom), header: 0, footer: 0 },
        },
      },
      children,
    };
  }

  async function toDocxBlob(pages) {
    const sections = pages.map(buildSection).filter(Boolean);
    if (!sections.length) throw new Error("Nenhum texto encontrado.");
    return docx.Packer.toBlob(new docx.Document({ sections }));
  }

  return { SCALE, makeImage, nativeItems, ocrItems, toDocxBlob };
})();
