from pathlib import Path


def pdf_to_docx(src: Path, dst: Path) -> None:
    """Converte PDF (com texto) em DOCX preservando layout."""
    from pdf2docx import Converter

    cv = Converter(str(src))
    try:
        cv.convert(str(dst))
    finally:
        cv.close()
