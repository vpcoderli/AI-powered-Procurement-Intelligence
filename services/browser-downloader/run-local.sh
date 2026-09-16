#!/usr/bin/env bash
# Run the browser-downloader sidecar on the host without Docker (Python 3.12 required).
# The first run downloads Chromium (~150 MB) into the Playwright cache.
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-python3.12}"
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/pip install -q -r requirements.txt
.venv/bin/python -m playwright install chromium
export BROWSER_DOWNLOADER_PORT="${BROWSER_DOWNLOADER_PORT:-8092}"
export BROWSER_DOWNLOADER_HOST="${BROWSER_DOWNLOADER_HOST:-127.0.0.1}"
exec .venv/bin/python server.py
