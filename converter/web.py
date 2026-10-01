"""Interface web: `python -m converter.web` e abra http://localhost:5000"""
import tempfile
from pathlib import Path

from flask import Flask, render_template_string, request, send_file

from . import convert, supported

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

PAGE = """<!doctype html><meta charset=utf-8><title>Conversor</title>
<style>body{font:16px system-ui;max-width:480px;margin:3em auto;padding:0 1em}
select,input,button{font:inherit;margin:.4em 0;width:100%}.err{color:#b00}</style>
<h1>Conversor de arquivos</h1>
{% if erro %}<p class=err>{{ erro }}</p>{% endif %}
<form method=post enctype=multipart/form-data>
<input type=file name=arquivo required>
<select name=para>{% for f in formatos %}<option>{{ f }}</option>{% endfor %}</select>
<button>Converter</button></form>
<p>Entradas: PDF, DOCX, CSV, PNG, JPG, BMP, TIFF, WEBP.</p>"""


def _page(erro=None, status=200):
    formatos = sorted({d.lstrip(".") for _, d in supported()})
    return render_template_string(PAGE, erro=erro, formatos=formatos), status


@app.get("/")
def index():
    return _page()


@app.post("/")
def upload():
    f = request.files.get("arquivo")
    para = request.form.get("para", "").lstrip(".")
    if not f or not f.filename:
        return _page("Envie um arquivo.", 400)
    name = Path(f.filename).name
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / ("entrada" + Path(name).suffix.lower())
        dst = Path(tmp) / ("saida." + para)
        f.save(src)
        try:
            convert(src, dst)
        except ValueError as e:
            return _page(str(e), 400)
        except Exception as e:
            return _page(f"Falha na conversão: {e}", 500)
        data = dst.read_bytes()
    out = Path(name).stem + "." + para
    import io

    return send_file(io.BytesIO(data), as_attachment=True, download_name=out)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)
