"""Minimal JSON/binary HTTP sidecar in front of downloader.download_attachment(). stdlib only.

Contract C2 of docs/superpowers/plans/2026-09-16-attachment-repair.md:
  GET  /health   → 200 {"ok": true, "browser": "chromium", "playwright": "…"} | 503 {"ok": false, …}
  POST /download → 200 binary + X-Download-* headers | {"error": {"code", "message"}}

No authentication: bind to 127.0.0.1 (the default) or to a private container network only.
"""

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from downloader import DownloadResult, download_attachment, probe_browser  # noqa: E402,F401
from guards import (  # noqa: E402
    DownloadError,
    error_envelope,
    header_safe,
    host_of,
    parse_download_request,
    parse_render_request,
)
from renderer import RenderResult, render_page  # noqa: E402,F401

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8092
# A C2 request is a few hundred bytes; anything larger is a mistake or an attack.
MAX_BODY_BYTES = 64 * 1024
# Seconds a single connection may stay idle mid-request before the handler gives up; without it a
# client that sends headers and then stalls pins a server thread forever on rfile.read().
REQUEST_TIMEOUT_SECONDS = 30


def log_request_line(entry):
    """One JSON line per request on stderr. Never contains request or response bodies."""
    print(json.dumps(entry, sort_keys=True), file=sys.stderr, flush=True)


class DownloaderHandler(BaseHTTPRequestHandler):
    server_version = "browser-downloader/1.0"
    # HTTP/1.0 (the BaseHTTPRequestHandler default) closes every connection, so a request we reject
    # without draining its body — an oversized Content-Length — can never desync a keep-alive pipe.
    timeout = REQUEST_TIMEOUT_SECONDS  # honoured by BaseHTTPRequestHandler on the connection socket

    def log_message(self, format, *args):  # noqa: A002 - structured logging only
        if os.environ.get("BROWSER_DOWNLOADER_LOG") == "1":
            super().log_message(format, *args)

    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, code, message):
        self._send(status, error_envelope(code, message))

    def _send_download(self, result):
        self.send_response(200)
        self.send_header("Content-Type", header_safe(result.content_type))
        self.send_header("Content-Length", str(len(result.content)))
        self.send_header("X-Download-Filename", header_safe(result.filename))
        self.send_header("X-Download-Content-Type", header_safe(result.content_type))
        self.send_header("X-Download-Final-Url", header_safe(result.final_url))
        self.send_header("X-Download-Byte-Size", str(len(result.content)))
        self.end_headers()
        self.wfile.write(result.content)

    def do_GET(self):
        if self.path != "/health":
            self._error(404, "NOT_FOUND", f"no route for {self.path}")
            return
        try:
            self._send(200, probe_browser())
        except DownloadError as error:
            self._send(503, {"ok": False, "error": error.message})
        except Exception as error:  # noqa: BLE001 - /health must always answer
            self._send(503, {"ok": False, "error": f"{type(error).__name__}: {error}"})

    def _read_body(self):
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length)
        except (TypeError, ValueError):
            raise DownloadError("INVALID_REQUEST", "Content-Length must be a nonnegative integer")
        if length <= 0:
            raise DownloadError("INVALID_REQUEST", "request body is required")
        if length > MAX_BODY_BYTES:
            raise DownloadError("INVALID_REQUEST", f"request body exceeds {MAX_BODY_BYTES} bytes")
        try:
            return json.loads(self.rfile.read(length))
        except ValueError:
            raise DownloadError("INVALID_REQUEST", "body must be valid JSON")

    def do_POST(self):
        if self.path == "/download":
            self._run("browser_download", parse_download_request, download_attachment, self._send_download)
            return
        if self.path == "/render":
            self._run("browser_render", parse_render_request, render_page, self._send_render)
            return
        self._error(404, "NOT_FOUND", f"no route for {self.path}")

    def _run(self, event, parse, execute, respond):
        started = time.monotonic()
        host = ""
        try:
            payload = self._read_body()
            host = host_of(payload.get("page_url")) if isinstance(payload, dict) else ""
            request = parse(payload)
            host = host_of(request.page_url)
            result = execute(request)
        except DownloadError as error:
            self._finish(event, started, host, error.code, error.status, 0)
            self._error(error.status, error.code, error.message)
            return
        except Exception as error:  # noqa: BLE001 - never leak a traceback to the crawler
            message = f"{type(error).__name__}: {error}"
            self._finish(event, started, host, "BROWSER_ERROR", 500, 0)
            self._error(500, "BROWSER_ERROR", message)
            return
        self._finish(event, started, host, "OK", 200, result.byte_size)
        respond(result)

    def _send_render(self, result):
        self._send(200, result.as_dict())

    def _finish(self, event, started, host, outcome, status, byte_size):
        log_request_line(
            {
                "event": event,
                "host": host,
                "outcome": outcome,
                "status": status,
                "byte_size": byte_size,
                "duration_ms": int((time.monotonic() - started) * 1000),
            }
        )


def create_server(port=DEFAULT_PORT, host=None):
    bind = host or os.environ.get("BROWSER_DOWNLOADER_HOST") or DEFAULT_HOST
    return ThreadingHTTPServer((bind, port), DownloaderHandler)


def main():
    port = int(os.environ.get("BROWSER_DOWNLOADER_PORT", DEFAULT_PORT))
    server = create_server(port)
    print(
        f"browser-downloader listening on {server.server_address[0]}:{server.server_address[1]}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
