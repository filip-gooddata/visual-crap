#!/bin/sh
set -eu
cd "$(dirname "$0")"
PYTHON=${PYTHON:-python3}
if [ ! -x .venv/bin/python ]; then "$PYTHON" -m venv .venv; fi
.venv/bin/python -m pip install --quiet 'graphifyy==0.9.97' 'pyinstaller==6.16.0'
printf '%s\n' "${VERSION:-dev}" > version.txt
.venv/bin/pyinstaller --noconfirm --clean --onefile --name visual-crap \
    --collect-all graphify --collect-all tree_sitter \
    --add-data canvas.html:. --add-data heat.js:. --add-data force-worker.bundle.js:. \
    --add-data version.txt:. --add-data ts-relations.cjs:. visual_crap.py
