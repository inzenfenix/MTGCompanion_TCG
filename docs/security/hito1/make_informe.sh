#!/usr/bin/env bash
# Construye el informe del Hito 1 en .docx y .pdf, con el índice numerado.
# Dos pasadas: (1) genera y convierte a PDF para ver en qué página cae cada
# sección; (2) regenera el .docx con esos números en el índice.
#
#   DOCX_NODE_PATH=<dir con node_modules/docx@9> bash make_informe.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
export NODE_PATH="${DOCX_NODE_PATH:?set DOCX_NODE_PATH to a node_modules dir containing docx@9}"
OUT=Hito1_Inventario_Datos_Personales
TMP=$(mktemp -d)

pdf() { soffice --headless --convert-to pdf --outdir "$HERE" "$OUT.docx" >/dev/null 2>&1; }

node build_informe.js
pdf
python3 - "$OUT.pdf" "$TMP/pages.json" <<'PY'
import json, subprocess, sys
pdf, out = sys.argv[1], sys.argv[2]
n = int([l for l in subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout.splitlines() if l.startswith('Pages:')][0].split()[1])
text = [subprocess.run(['pdftotext', '-layout', '-f', str(i), '-l', str(i), pdf, '-'], capture_output=True, text=True).stdout for i in range(1, n + 1)]
sections = ['1. Portada', '2. Índice', '3. Introducción', '4. Inventario de datos personales', '5. Mapa de flujos de datos',
            '6. Clasificación por sensibilidad', '7. Finalidad y base de licitud', '8. Conclusiones', '9. Referencias',
            '10. Anexos', 'Anexo A — Actividad N°1: Mapeo de actores, datos y riesgos CIA', 'Anexo B — Actividad N°2: Cifrado, hashing y tokenización']
pages = {'1. Portada': 1}
index_page = next(i for i, t in enumerate(text, 1) if '2. Índice' in t)
pages['2. Índice'] = index_page
for s in sections[2:]:
    for i, t in enumerate(text, 1):
        if i <= index_page:
            continue
        if any(line.strip() == s for line in t.splitlines()):
            pages[s] = i
            break
missing = [s for s in sections if s not in pages]
if missing:
    sys.exit(f'secciones no encontradas en el PDF: {missing}')
json.dump(pages, open(out, 'w'), ensure_ascii=False)
print(json.dumps(pages, ensure_ascii=False))
print('páginas totales:', n)
PY
node build_informe.js "$TMP/pages.json"
pdf
cp "$TMP/pages.json" "$HERE/.pages.json"
rm -rf "$TMP"
echo "listo: $OUT.docx / $OUT.pdf"
