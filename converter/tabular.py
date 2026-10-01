"""CSV -> texto alinhado / imagem JPG."""
import csv
import io
from pathlib import Path


def read_csv(src: Path) -> list[list[str]]:
    raw = Path(src).read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = [r for r in csv.reader(io.StringIO(text), dialect)]
    width = max((len(r) for r in rows), default=0)
    return [r + [""] * (width - len(r)) for r in rows]


def csv_to_txt(src: Path, dst: Path) -> None:
    rows = read_csv(src)
    if not rows:
        raise ValueError("CSV vazio")
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    lines = ["  ".join(c.ljust(w) for c, w in zip(r, widths)).rstrip() for r in rows]
    Path(dst).write_text("\n".join(lines) + "\n", encoding="utf-8")


def _font(size: int, bold: bool = False):
    from PIL import ImageFont

    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    for path in (f"/usr/share/fonts/truetype/dejavu/{name}", name):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def csv_to_jpg(src: Path, dst: Path) -> None:
    from PIL import Image, ImageDraw

    rows = read_csv(src)
    if not rows:
        raise ValueError("CSV vazio")
    if len(rows) > 600:
        raise ValueError("CSV com linhas demais para uma imagem (máx. 600)")
    font, bold = _font(18), _font(18, True)
    pad, row_h = 12, 38
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    widths = [
        max(probe.textlength(r[i], font=bold if n == 0 else font) for n, r in enumerate(rows)) + pad * 2
        for i in range(len(rows[0]))
    ]
    img = Image.new("RGB", (int(sum(widths)) + 1, row_h * len(rows) + 1), "white")
    d = ImageDraw.Draw(img)
    for n, r in enumerate(rows):
        y = n * row_h
        if n == 0:
            d.rectangle([0, y, img.width, y + row_h], fill="#dfe6f5")
        elif n % 2 == 0:
            d.rectangle([0, y, img.width, y + row_h], fill="#f6f8fc")
        x = 0
        for c, w in zip(r, widths):
            d.text((x + pad, y + (row_h - 18) // 2 - 2), c, fill="black", font=bold if n == 0 else font)
            x += w
    y = 0
    for n in range(len(rows) + 1):
        d.line([0, n * row_h, img.width, n * row_h], fill="#b8c0d0")
    x = 0
    for w in [0] + widths:
        x += w
        d.line([x, 0, x, img.height], fill="#b8c0d0")
    img.save(dst, "JPEG", quality=92)
