import argparse
import sys
from pathlib import Path

from . import convert


def main() -> int:
    p = argparse.ArgumentParser(prog="converter", description="Conversor de arquivos (PDF/imagem -> DOCX/CSV/XLSX)")
    p.add_argument("entrada")
    p.add_argument("--para", required=True, help="formato de saída: docx, csv, xlsx")
    p.add_argument("-o", "--saida", help="arquivo de saída (padrão: mesmo nome)")
    a = p.parse_args()
    src = Path(a.entrada)
    dst = Path(a.saida) if a.saida else src.with_suffix("." + a.para.lstrip("."))
    try:
        print(convert(src, dst))
    except (ValueError, FileNotFoundError) as e:
        print(f"Erro: {e}", file=sys.stderr)
        return 1
    return 0


sys.exit(main())
