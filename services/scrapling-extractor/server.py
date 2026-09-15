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
DEFAULT_STORAGE_DIR = "/data/scrapling"
# Seconds a single connection may stay idle mid-request before the handler gives up; without it a
# client that sends headers and then stalls pins a server thread forever on rfile.read().
REQUEST_TIMEOUT_SECONDS = 30


def resolve_storage_dir():
    """Directory to hold Scrapling's adaptive-selector SQLite store.

    Scrapling writes that store to the absolute path it is handed through
    `storage_args["storage_file"]` (default: inside site-packages) — it is not relative to the
    process cwd and scrapling reads no environment variable of its own, so the resolved directory
    has to be threaded explicitly into every `extract()` call. Falls back to the current directory
    when SCRAPLING_STORAGE_DIR (default /data/scrapling) cannot be created or written.
    """
    storage_dir = os.environ.get("SCRAPLING_STORAGE_DIR") or DEFAULT_STORAGE_DIR
    try:
        os.makedirs(storage_dir, exist_ok=True)
    except OSError:
        return os.getcwd()
    if not os.access(storage_dir, os.W_OK):
        return os.getcwd()
    return storage_dir


class ExtractorHandler(BaseHTTPRequestHandler):
    server_version = "scrapling-extractor/1.0"
    timeout = REQUEST_TIMEOUT_SECONDS  # honoured by BaseHTTPRequestHandler on the connection socket

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
            result = extract(html, url, fields, selectors, storage_dir=self.server.storage_dir)
        except ExtractError as error:
            self._error(400, "INVALID_REQUEST", str(error))
            return
        except Exception as error:  # noqa: BLE001 - never leak a traceback to the crawler
            self._error(500, "EXTRACT_FAILED", f"{type(error).__name__}: {error}")
            return
        self._send(200, result)


def create_server(port=DEFAULT_PORT, storage_dir=None):
    server = ThreadingHTTPServer(("0.0.0.0", port), ExtractorHandler)
    server.storage_dir = storage_dir if storage_dir is not None else resolve_storage_dir()
    return server


def main():
    port = int(os.environ.get("EXTRACTOR_PORT", DEFAULT_PORT))
    server = create_server(port)
    print(f"scrapling-extractor listening on :{port} (scrapling {scrapling.__version__})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
