import csv

import pytest
from PIL import Image, ImageDraw, ImageFont
from openpyxl import load_workbook

from converter import convert


def make_table_image(path):
    img = Image.new("RGB", (700, 200), "white")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28)
    except OSError:
        font = ImageFont.load_default()
    for r, row in enumerate([("Nome", "Idade", "Cidade"), ("Ana", "30", "Recife"), ("Joao", "25", "Natal")]):
        for c, text in enumerate(row):
            d.text((20 + c * 230, 20 + r * 55), text, fill="black", font=font)
    img.save(path)


def test_image_to_csv_and_xlsx(tmp_path):
    img = tmp_path / "t.png"
    make_table_image(img)
    convert(img, tmp_path / "t.csv")
    rows = list(csv.reader(open(tmp_path / "t.csv", encoding="utf-8-sig")))
    assert rows[0] == ["Nome", "Idade", "Cidade"]
    assert rows[1][0] == "Ana"
    convert(img, tmp_path / "t.xlsx")
    ws = load_workbook(tmp_path / "t.xlsx").active
    assert ws["C3"].value == "Natal"


def test_pdf_to_docx(tmp_path):
    from reportlab.pdfgen import canvas

    pdf = tmp_path / "a.pdf"
    c = canvas.Canvas(str(pdf))
    c.drawString(100, 750, "Ola mundo")
    c.save()
    out = convert(pdf, tmp_path / "a.docx")
    from docx import Document

    assert "Ola mundo" in "\n".join(p.text for p in Document(out).paragraphs)


def test_unsupported(tmp_path):
    f = tmp_path / "x.txt"
    f.write_text("a")
    with pytest.raises(ValueError):
        convert(f, tmp_path / "x.docx")


def make_pdf(path, scanned_from=None):
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path))
    if scanned_from:
        c.drawImage(str(scanned_from), 50, 500, width=500, height=143)
    else:
        c.drawString(100, 750, "Ola mundo")
    c.save()


def test_scanned_pdf_to_docx_and_xlsx(tmp_path):
    img = tmp_path / "t.png"
    make_table_image(img)
    pdf = tmp_path / "s.pdf"
    make_pdf(pdf, img)
    out = convert(pdf, tmp_path / "s.docx")
    from docx import Document

    text = "\n".join(p.text for p in Document(out).paragraphs)
    assert "Nome" in text and "Recife" in text
    convert(pdf, tmp_path / "s.xlsx")
    ws = load_workbook(tmp_path / "s.xlsx").worksheets[0]
    assert ws["A2"].value == "Ana"


def test_pdf_table_to_xlsx(tmp_path):
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle

    pdf = tmp_path / "tb.pdf"
    t = Table([["Nome", "Idade"], ["Ana", "30"], ["Joao", "25"]])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 1, "black")]))
    SimpleDocTemplate(str(pdf)).build([t])
    convert(pdf, tmp_path / "tb.xlsx")
    ws = load_workbook(tmp_path / "tb.xlsx").worksheets[0]
    assert [c.value for c in ws[2]] == ["Ana", "30"]


def test_docx_to_pdf(tmp_path):
    from docx import Document

    d = Document()
    d.add_paragraph("Ola mundo")
    d.save(tmp_path / "d.docx")
    out = convert(tmp_path / "d.docx", tmp_path / "d.pdf")
    assert out.read_bytes().startswith(b"%PDF")


def test_web(tmp_path):
    import io

    from converter.web import app

    img = tmp_path / "t.png"
    make_table_image(img)
    c = app.test_client()
    assert c.get("/").status_code == 200
    r = c.post("/", data={"arquivo": (io.BytesIO(img.read_bytes()), "t.png"), "para": "csv"})
    assert r.status_code == 200 and b"Ana" in r.data
    r = c.post("/", data={"arquivo": (io.BytesIO(b"x"), "t.txt"), "para": "csv"})
    assert r.status_code == 400


def test_csv_to_txt_and_jpg(tmp_path):
    src = tmp_path / "d.csv"
    src.write_text("Nome;Idade\nAna;30\nJoão;25\n", encoding="utf-8")
    txt = convert(src, tmp_path / "d.txt").read_text(encoding="utf-8").splitlines()
    assert txt[0].split() == ["Nome", "Idade"] and txt[2].split() == ["João", "25"]
    out = convert(src, tmp_path / "d.jpg")
    img = Image.open(out)
    assert img.format == "JPEG" and img.width > 100 and img.height > 100
