from pathlib import Path

from .ocr import IMAGE_EXTS, image_to_csv, image_to_xlsx
from .office import docx_to_pdf
from .pdf import pdf_to_docx, pdf_to_xlsx

_ROUTES = {(".pdf", ".docx"): pdf_to_docx, (".pdf", ".xlsx"): pdf_to_xlsx, (".docx", ".pdf"): docx_to_pdf}
for _e in IMAGE_EXTS:
    _ROUTES[(_e, ".csv")] = image_to_csv
    _ROUTES[(_e, ".xlsx")] = image_to_xlsx


def supported() -> list[tuple[str, str]]:
    return sorted(_ROUTES)


def convert(src, dst) -> Path:
    src, dst = Path(src), Path(dst)
    key = (src.suffix.lower(), dst.suffix.lower())
    if key not in _ROUTES:
        raise ValueError(f"Conversão {key[0]} -> {key[1]} não suportada")
    if not src.exists():
        raise FileNotFoundError(src)
    _ROUTES[key](src, dst)
    return dst
