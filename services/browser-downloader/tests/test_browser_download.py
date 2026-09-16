"""End-to-end downloads against a local HTTP server. Skipped unless Chromium is installed.

Run after `python -m playwright install chromium` (run-local.sh does it). Everything here stays on
127.0.0.1 / localhost — no portal is ever contacted from a test.
"""

import http.client
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from guards import DownloadError, parse_download_request

PDF_BYTES = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"

DETAIL_PAGE = """<!doctype html>
<html><head><title>Solicitation 27-444</title></head>
<body>
  <h1>Solicitation 27-444</h1>
  <p>Janitorial services for the Springfield district office, awarded annually by the agency.</p>
  <form id="f" method="post" action="/file"><input type="hidden" name="docId" value=""></form>
  <script>
    function downloadFile(id) {
      var form = document.getElementById('f');
      form.docId.value = id;
      form.submit();
    }
  </script>
  <a href="javascript:downloadFile('123');">Doc.pdf</a>
</body></html>
"""

LOGIN_PAGE = """<!doctype html>
<html><head><title>Sign In</title></head>
<body><h1>Sign In</h1>
  <form action="/login" method="post">
    <input type="email" name="user"><input type="password" name="pass">
    <button type="submit">Log in</button>
  </form>
  <a href="javascript:downloadFile('123');">Doc.pdf</a>
</body></html>
"""

OFFSITE_PAGE = """<!doctype html>
<html><head><title>Solicitation 27-445</title></head>
<body><h1>Solicitation 27-445</h1>
  <p>Grounds maintenance for the northern district, with documents hosted by a partner site.</p>
  <a href="{target}">Doc.pdf</a>
</body></html>
"""


class _PortalHandler(BaseHTTPRequestHandler):
    offsite_target = ""

    def log_message(self, format, *args):  # noqa: A002 - keep pytest output clean
        return

    def _html(self, body):
        payload = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.startswith("/detail"):
            self._html(DETAIL_PAGE)
        elif self.path.startswith("/login"):
            self._html(LOGIN_PAGE)
        elif self.path.startswith("/offsite"):
            self._html(OFFSITE_PAGE.format(target=type(self).offsite_target))
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/file":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Disposition", 'attachment; filename="Doc.pdf"')
        self.send_header("Content-Length", str(len(PDF_BYTES)))
        self.end_headers()
        self.wfile.write(PDF_BYTES)


def _serve():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _PortalHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, thread


@pytest.fixture(scope="session")
def chromium_available():
    try:
        from playwright.sync_api import sync_playwright
    except Exception as error:  # noqa: BLE001 - playwright is an optional local dependency
        pytest.skip(f"playwright is not installed: {error}")
    playwright = None
    try:
        playwright = sync_playwright().start()
        browser = playwright.chromium.launch(headless=True)
        browser.close()
    except Exception as error:  # noqa: BLE001 - chromium binaries are not installed in CI
        pytest.skip(f"chromium is not installed: {error}")
    finally:
        if playwright is not None:
            playwright.stop()
    return True


@pytest.fixture(scope="module")
def portal():
    primary, primary_thread = _serve()
    secondary, secondary_thread = _serve()
    # A second origin the caller does not allow-list. Same loopback IP, different *hostname*, which
    # is what the allow-list compares — so `localhost:<port2>` is off-host for `127.0.0.1`.
    _PortalHandler.offsite_target = f"http://localhost:{secondary.server_address[1]}/detail"
    try:
        yield f"http://127.0.0.1:{primary.server_address[1]}"
    finally:
        for server, thread in ((primary, primary_thread), (secondary, secondary_thread)):
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


def download(payload):
    from downloader import download_attachment

    return download_attachment(parse_download_request(payload))


class TestBrowserDownload:
    def test_clicking_a_javascript_link_returns_the_attachment_bytes(self, chromium_available, portal):
        result = download(
            {
                "page_url": f"{portal}/detail",
                "link": {"href_contains": "123", "text": "Doc.pdf"},
                "timeout_seconds": 30,
                "max_bytes": 1048576,
                "allowed_hosts": ["127.0.0.1"],
            }
        )
        assert result.content == PDF_BYTES
        assert result.filename == "Doc.pdf"
        assert result.content_type == "application/pdf"
        assert result.final_url.endswith("/file")

    def test_text_only_link_spec_also_resolves(self, chromium_available, portal):
        result = download(
            {
                "page_url": f"{portal}/detail",
                "link": {"text": "Doc.pdf"},
                "timeout_seconds": 30,
                "allowed_hosts": ["127.0.0.1"],
            }
        )
        assert result.content == PDF_BYTES

    def test_login_wall_page_is_refused_before_clicking(self, chromium_available, portal):
        with pytest.raises(DownloadError) as error:
            download(
                {
                    "page_url": f"{portal}/login",
                    "link": {"href_contains": "123"},
                    "timeout_seconds": 30,
                    "allowed_hosts": ["127.0.0.1"],
                }
            )
        assert error.value.code == "LOGIN_WALL"
        assert error.value.status == 403

    def test_navigation_to_an_unlisted_host_is_blocked(self, chromium_available, portal):
        with pytest.raises(DownloadError) as error:
            download(
                {
                    "page_url": f"{portal}/offsite",
                    "link": {"text": "Doc.pdf"},
                    "timeout_seconds": 10,
                    "allowed_hosts": ["127.0.0.1"],
                }
            )
        assert error.value.code == "OFF_HOST"
        assert error.value.status == 403

    def test_missing_link_is_reported(self, chromium_available, portal):
        with pytest.raises(DownloadError) as error:
            download(
                {
                    "page_url": f"{portal}/detail",
                    "link": {"href_contains": "no-such-file", "text": "Missing.pdf"},
                    "timeout_seconds": 10,
                    "allowed_hosts": ["127.0.0.1"],
                }
            )
        assert error.value.code == "LINK_NOT_FOUND"

    def test_download_above_max_bytes_is_refused(self, chromium_available, portal):
        with pytest.raises(DownloadError) as error:
            download(
                {
                    "page_url": f"{portal}/detail",
                    "link": {"href_contains": "123"},
                    "timeout_seconds": 30,
                    "max_bytes": 8,
                    "allowed_hosts": ["127.0.0.1"],
                }
            )
        assert error.value.code == "TOO_LARGE"

    def test_unreachable_page_is_a_navigation_failure(self, chromium_available):
        with pytest.raises(DownloadError) as error:
            download(
                {
                    "page_url": "http://127.0.0.1:1/detail",
                    "link": {"text": "Doc.pdf"},
                    "timeout_seconds": 10,
                    "allowed_hosts": ["127.0.0.1"],
                }
            )
        assert error.value.code in ("NAVIGATION_FAILED", "TIMEOUT")


class TestServerEndToEnd:
    def test_health_and_download_over_http(self, chromium_available, portal):
        from server import create_server

        httpd = create_server(port=0, host="127.0.0.1")
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        address = f"127.0.0.1:{httpd.server_address[1]}"
        try:
            connection = http.client.HTTPConnection(address, timeout=30)
            connection.request("GET", "/health")
            response = connection.getresponse()
            health = json.loads(response.read())
            connection.close()
            assert response.status == 200
            assert health["ok"] is True
            assert health["browser"] == "chromium"

            body = json.dumps(
                {
                    "page_url": f"{portal}/detail",
                    "link": {"href_contains": "123", "text": "Doc.pdf"},
                    "timeout_seconds": 30,
                    "max_bytes": 1048576,
                    "allowed_hosts": ["127.0.0.1"],
                }
            ).encode()
            connection = http.client.HTTPConnection(address, timeout=60)
            connection.request("POST", "/download", body=body, headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            data = response.read()
            headers = dict(response.getheaders())
            connection.close()
            assert response.status == 200
            assert data == PDF_BYTES
            assert headers["X-Download-Filename"] == "Doc.pdf"
            assert headers["X-Download-Content-Type"] == "application/pdf"
            assert headers["X-Download-Byte-Size"] == str(len(PDF_BYTES))
            assert headers["X-Download-Final-Url"].endswith("/file")
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)
