# Conversor de arquivos

| Entrada | Saída | Como |
|---|---|---|
| PDF (texto) | DOCX | `pdf2docx` |
| PDF escaneado | DOCX | OCR por página (detecção automática) |
| PDF | XLSX | tabelas via `pdfplumber`; OCR se escaneado |
| DOCX | PDF | LibreOffice headless |
| PNG/JPG/BMP/TIFF/WEBP | CSV, XLSX | OCR (Tesseract) + linhas/colunas |

## Instalação
```
sudo apt install tesseract-ocr tesseract-ocr-por libreoffice-writer
pip install -r requirements.txt
```

## Uso
```
python -m converter relatorio.pdf --para docx
python -m converter tabela.png --para xlsx -o saida.xlsx
```

Interface web: `python -m converter.web` e abra http://localhost:5000

## Limitações
OCR de tabelas funciona melhor com imagens nítidas; fotos tortas ou manuscritos exigem revisão.
PDF escaneado → DOCX gera só texto (sem layout original).
