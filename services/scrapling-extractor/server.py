"""Minimal JSON HTTP sidecar exposing extractors.extract(). stdlib only."""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import scrapling

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extractors import ExtractError, extract  # noqa: E402

MAX_HTML_BYTES = 2 * 1024 * 1024
MAX_BODY_BYTES = MAX_HTML_BYTES + 64 * 1024
DEFAULT_PORT = 8091


def _configure_storage_dir():
    storage_dir = os.environ.get("SCRAPLING_STORAGE_DIR", "/data/scrapling")
    try:
        os.makedirs(storage_dir, exist_ok=True)
        os.chdir(storage_dir)  # Scrapling's adaptive SQLite store is created relative to cwd
    except OSError:
        pass


class ExtractorHandler(BaseHTTPRequestHandler):
    server_version = "scrapling-extractor/1.0"

    def log_message(self, format, *args):  # noqa: A002 - keep stdout quiet in tests
        if os.environ.get("EXTRACTOR_LOG") == "1":
            super().log_message(format, *args)

    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, code, message):
        self._send(status, {"error": {"code": code, "message": message}})

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True, "scrapling": scrapling.__version__})
            return
        self._error(404, "NOT_FOUND", f"no route for {self.path}")

    def do_POST(self):
        if self.path != "/extract":
            self._error(404, "NOT_FOUND", f"no route for {self.path}")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY_BYTES:
            self._error(413, "INVALID_REQUEST", f"request body exceeds {MAX_BODY_BYTES} bytes")
            return
        try:
            payload = json.loads(self.rfile.read(length))
        except ValueError:
            self._error(400, "INVALID_REQUEST", "body must be valid JSON")
            return
        if not isinstance(payload, dict):
            self._error(400, "INVALID_REQUEST", "body must be a JSON object")
            return
        html = payload.get("html")
        url = payload.get("url")
        fields = payload.get("fields")
        selectors = payload.get("selectors")
        if not isinstance(html, str) or not isinstance(url, str) or not isinstance(fields, list):
            self._error(400, "INVALID_REQUEST", "html (str), url (str) and fields (list) are required")
            return
        if len(html.encode("utf-8", errors="ignore")) > MAX_HTML_BYTES:
            self._error(413, "INVALID_REQUEST", f"html exceeds {MAX_HTML_BYTES} bytes")
            return
        if selectors is not None and not isinstance(selectors, dict):
            self._error(400, "INVALID_REQUEST", "selectors must be an object or null")
            return
        try:
            result = extract(html, url, fields, selectors)
        except ExtractError as error:
            self._error(400, "INVALID_REQUEST", str(error))
            return
        except Exception as error:  # noqa: BLE001 - never leak a traceback to the crawler
            self._error(500, "EXTRACT_FAILED", f"{type(error).__name__}: {error}")
            return
        self._send(200, result)


def create_server(port=DEFAULT_PORT):
    return ThreadingHTTPServer(("0.0.0.0", port), ExtractorHandler)


def main():
    _configure_storage_dir()
    port = int(os.environ.get("EXTRACTOR_PORT", DEFAULT_PORT))
    server = create_server(port)
    print(f"scrapling-extractor listening on :{port} (scrapling {scrapling.__version__})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
