#!/usr/bin/env bash
# Run the Scrapling extractor sidecar on the host without Docker (Python >= 3.10 required).
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-python3.12}"
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/pip install -q -r requirements.txt
export SCRAPLING_STORAGE_DIR="${SCRAPLING_STORAGE_DIR:-$PWD/.data}"
export EXTRACTOR_PORT="${EXTRACTOR_PORT:-8091}"
exec .venv/bin/python server.py
