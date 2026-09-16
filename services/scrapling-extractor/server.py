"""Minimal JSON HTTP sidecar exposing extractors.extract(). stdlib only."""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import scrapling

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extractors import ExtractError, extract  # noqa: E402
from list_extractors import DEFAULT_MAX_ITEMS, extract_list  # noqa: E402

MAX_HTML_BYTES = 2 * 1024 * 1024
MAX_BODY_BYTES = MAX_HTML_BYTES + 64 * 1024
DEFAULT_PORT = 8091
DEFAULT_STORAGE_DIR = "/data/scrapling"
# Seconds a single connection may stay idle mid-request before the handler gives up; without it a
# client that sends headers and then stalls pins a server thread forever on rfile.read().
REQUEST_TIMEOUT_SECONDS = 30


class RequestError(Exception):
    """A malformed request. Always answered with the `INVALID_REQUEST` envelope."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


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

    def _read_payload(self):
        """The request body as a dict, or raise `RequestError` with the response to send."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length < 0:
                raise ValueError("negative length")
        except ValueError:
            raise RequestError(400, "Content-Length must be a nonnegative integer")
        if length > MAX_BODY_BYTES:
            raise RequestError(413, f"request body exceeds {MAX_BODY_BYTES} bytes")
        try:
            payload = json.loads(self.rfile.read(length))
        except ValueError:
            raise RequestError(400, "body must be valid JSON")
        if not isinstance(payload, dict):
            raise RequestError(400, "body must be a JSON object")
        return payload

    @staticmethod
    def _require_page(payload):
        """`(html, url)` — the two fields both extraction routes need, with the html cap applied."""
        html = payload.get("html")
        url = payload.get("url")
        if not isinstance(html, str) or not isinstance(url, str):
            raise RequestError(400, "html (str) and url (str) are required")
        if len(html.encode("utf-8", errors="ignore")) > MAX_HTML_BYTES:
            raise RequestError(413, f"html exceeds {MAX_HTML_BYTES} bytes")
        return html, url

    def _extract_payload(self, payload):
        html, url = self._require_page(payload)
        fields = payload.get("fields")
        selectors = payload.get("selectors")
        if not isinstance(fields, list):
            raise RequestError(400, "fields (list) is required")
        if selectors is not None and not isinstance(selectors, dict):
            raise RequestError(400, "selectors must be an object or null")
        return extract(html, url, fields, selectors, storage_dir=self.server.storage_dir)

    def _extract_list_payload(self, payload):
        """POST /extract-list (contract C2)."""
        html, url = self._require_page(payload)
        fields = payload.get("fields")
        selectors = payload.get("selectors")
        item_selector = payload.get("item_selector")
        max_items = payload.get("max_items", DEFAULT_MAX_ITEMS)
        auto_save = payload.get("auto_save", True)
        if fields is not None and not isinstance(fields, list):
            raise RequestError(400, "fields must be an array or null")
        if selectors is not None and not isinstance(selectors, dict):
            raise RequestError(400, "selectors must be an object or null")
        if max_items is None:
            max_items = DEFAULT_MAX_ITEMS
        if not isinstance(auto_save, bool):
            raise RequestError(400, "auto_save must be a boolean")
        return extract_list(
            html,
            url,
            item_selector=item_selector,
            selectors=selectors,
            fields=fields,
            max_items=max_items,
            storage_dir=self.server.storage_dir,
            auto_save=auto_save,
        )

    def do_POST(self):
        handlers = {"/extract": self._extract_payload, "/extract-list": self._extract_list_payload}
        handler = handlers.get(self.path)
        if handler is None:
            self._error(404, "NOT_FOUND", f"no route for {self.path}")
            return
        try:
            result = handler(self._read_payload())
        except RequestError as error:
            self._error(error.status, "INVALID_REQUEST", error.message)
            return
        except ExtractError as error:
            self._error(400, "INVALID_REQUEST", str(error))
            return
        except Exception as error:  # noqa: BLE001 - never leak a traceback to the crawler
            self._error(500, "EXTRACT_FAILED", f"{type(error).__name__}: {error}")
            return
        self._send(200, result)


def create_server(port=DEFAULT_PORT, storage_dir=None, host=None):
    server = ThreadingHTTPServer((host or os.environ.get("EXTRACTOR_HOST") or "127.0.0.1", port), ExtractorHandler)
    server.storage_dir = storage_dir if storage_dir is not None else resolve_storage_dir()
    return server


def main():
    port = int(os.environ.get("EXTRACTOR_PORT", DEFAULT_PORT))
    server = create_server(port)
    print(f"scrapling-extractor listening on {server.server_address[0]}:{port} (scrapling {scrapling.__version__})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
