import shutil
import subprocess
import tempfile
from pathlib import Path


def docx_to_pdf(src: Path, dst: Path) -> None:
    """DOCX -> PDF via LibreOffice (precisa do `soffice` instalado)."""
    exe = shutil.which("soffice") or shutil.which("libreoffice")
    if not exe:
        raise RuntimeError("LibreOffice não encontrado (instale libreoffice-writer)")
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            [exe, "--headless", f"-env:UserInstallation=file://{tmp}/profile",
             "--convert-to", "pdf", "--outdir", tmp, str(src)],
            check=True, capture_output=True, timeout=180,
        )
        shutil.move(str(Path(tmp) / (src.stem + ".pdf")), dst)
