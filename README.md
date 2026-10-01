# Conversor de arquivos

| Entrada | Saída | Como |
|---|---|---|
| PDF (com texto) | DOCX | `pdf2docx` |
| PNG/JPG/BMP/TIFF/WEBP | CSV, XLSX | OCR (Tesseract) + reconstrução de linhas/colunas |

## Instalação
```
sudo apt install tesseract-ocr tesseract-ocr-por
pip install -r requirements.txt
```

## Uso
```
python -m converter relatorio.pdf --para docx
python -m converter tabela.png --para xlsx -o saida.xlsx
```

## Limitações
Imagem → planilha funciona melhor com tabelas nítidas; fotos tortas ou manuscritos exigem revisão.
PDF escaneado (sem texto) ainda não é suportado.

## Próximos passos
PDF escaneado → DOCX (OCR), DOCX → PDF, PDF → XLSX (tabelas), interface web.
