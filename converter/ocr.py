"""Imagem -> tabela (CSV/XLSX) usando Tesseract."""
import csv
from pathlib import Path

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}


def image_to_rows(src: Path, lang: str = "por+eng") -> list[list[str]]:
    from PIL import Image

    return pil_to_rows(Image.open(src), lang)


def pil_to_text(img, lang: str = "por+eng") -> str:
    import pytesseract

    return pytesseract.image_to_string(img.convert("L"), lang=lang)


def pil_to_rows(img, lang: str = "por+eng") -> list[list[str]]:
    """Faz OCR e reconstrói linhas/colunas a partir da posição das palavras."""
    import pytesseract

    img = img.convert("L")
    data = pytesseract.image_to_data(
        img, lang=lang, config="--psm 6", output_type=pytesseract.Output.DICT
    )
    words = []
    for i, text in enumerate(data["text"]):
        text = text.strip()
        if text and float(data["conf"][i]) >= 0:
            words.append(
                dict(text=text, x=data["left"][i], r=data["left"][i] + data["width"][i],
                     y=data["top"][i] + data["height"][i] / 2, h=data["height"][i])
            )
    if not words:
        return []

    # Agrupa palavras em linhas pelo centro vertical.
    words.sort(key=lambda w: (w["y"], w["x"]))
    lines, cur = [], [words[0]]
    for w in words[1:]:
        if abs(w["y"] - cur[-1]["y"]) <= max(w["h"], cur[-1]["h"]) * 0.6:
            cur.append(w)
        else:
            lines.append(cur)
            cur = [w]
    lines.append(cur)

    # Dentro de cada linha, uma lacuna grande separa as células.
    heights = sorted(w["h"] for w in words)
    gap = heights[len(heights) // 2] * 1.5
    rows = []
    for line in lines:
        line.sort(key=lambda w: w["x"])
        cells, cell, last_r = [], [line[0]["text"]], line[0]["r"]
        for w in line[1:]:
            if w["x"] - last_r > gap:
                cells.append(" ".join(cell))
                cell = []
            cell.append(w["text"])
            last_r = w["r"]
        cells.append(" ".join(cell))
        rows.append(cells)
    return _align_columns(rows)


def _align_columns(rows):
    # Mantém simples: linhas com menos células são completadas à direita.
    width = max(len(r) for r in rows)
    return [list(r) + [""] * (width - len(r)) for r in rows]


def image_to_csv(src: Path, dst: Path, lang: str = "por+eng") -> None:
    rows = image_to_rows(src, lang)
    with open(dst, "w", newline="", encoding="utf-8-sig") as f:
        csv.writer(f).writerows(rows)


def image_to_xlsx(src: Path, dst: Path, lang: str = "por+eng") -> None:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    for row in image_to_rows(src, lang):
        ws.append(row)
    wb.save(dst)
