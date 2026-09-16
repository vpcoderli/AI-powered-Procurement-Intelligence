"""`POST /render` (contract C3): request validation, HTTP surface, and — when Chromium is
installed — real renders against a throwaway loopback portal.

The unit classes need neither Playwright nor a browser. `TestBrowserRender` drives real Chromium
and skips itself when Playwright or Chromium is missing. No test ever contacts a portal.
"""

import http.client
import json
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

import pytest

import server
from guards import (
    MAX_RENDER_HTML_BYTES,
    DownloadError,
    enforce_render_cap,
    is_host_allowed,
    parse_render_request,
)
from renderer import RenderResult

# The list this page shows is injected by JavaScript a beat after load — the case `/render` exists
# for. Without waiting, the served HTML holds only the placeholder.
JS_LIST_PAGE = """<!doctype html>
<html><head><title>Open Solicitations — Example County</title></head>
<body>
  <h1>Open Solicitations</h1>
  <div id="results"><p id="placeholder">Loading solicitations…</p></div>
  <script>
    setTimeout(function () {
      document.getElementById('results').innerHTML =
        '<ul id="bid-list">' +
        '<li class="bid"><a href="/solicitations/0000412233">Street Sweeping Services 2026</a></li>' +
        '<li class="bid"><a href="/solicitations/0000412244">Fleet Fuel Supply</a></li>' +
        '</ul>';
    }, 400);
  </script>
</body></html>
"""

LOGIN_PAGE = """<!doctype html>
<html><head><title>Sign In</title></head>
<body><h1>Sign In</h1>
  <form action="/login" method="post">
    <input type="email" name="user"><input type="password" name="pass">
    <button type="submit">Log in</button>
  </form>
</body></html>
"""


class _PortalHandler(BaseHTTPRequestHandler):
    redirect_target = ""

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
        if self.path.startswith("/list"):
            self._html(JS_LIST_PAGE)
        elif self.path.startswith("/login"):
            self._html(LOGIN_PAGE)
        elif self.path.startswith("/redirect"):
            self.send_response(302)
            self.send_header("Location", type(self).redirect_target)
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self.send_error(404)


def _serve():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _PortalHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, thread


def body(**overrides):
    payload = {
        "page_url": "https://portal.example.gov/solicitations/open-bids",
        "timeout_seconds": 5,
        "allowed_hosts": ["portal.example.gov"],
        "wait_for": {"selector": "#bid-list", "network_idle": False},
    }
    payload.update(overrides)
    return payload


def request(address, method, path, payload=None, headers=None, raw_content_length=None):
    connection = http.client.HTTPConnection(address, timeout=15)
    sent_headers = dict(headers or {})
    data = payload
    if isinstance(payload, (dict, list)):
        data = json.dumps(payload).encode()
        sent_headers.setdefault("Content-Type", "application/json")
    if raw_content_length is not None:
        sent_headers["Content-Length"] = raw_content_length
        connection.putrequest(method, path)
        for key, value in sent_headers.items():
            connection.putheader(key, value)
        connection.endheaders()
        if data:
            connection.send(data)
    else:
        connection.request(method, path, body=data, headers=sent_headers)
    response = connection.getresponse()
    result = (response.status, dict(response.getheaders()), response.read())
    connection.close()
    return result


@pytest.fixture()
def running_server():
    httpd = server.create_server(port=0, host="127.0.0.1")
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


class TestParseRenderRequest:
    def test_defaults_to_domcontentloaded_only(self):
        parsed = parse_render_request({"page_url": "https://portal.example.gov/open-bids"})
        assert parsed.timeout_seconds == 30
        assert parsed.wait_for.selector is None
        assert parsed.wait_for.network_idle is False

    def test_the_page_host_is_implicitly_allowed(self):
        parsed = parse_render_request(body(allowed_hosts=["files.example.gov"]))
        assert parsed.allowed_hosts == ("files.example.gov", "portal.example.gov")
        assert is_host_allowed("https://portal.example.gov/x", parsed.allowed_hosts)
        # Exact host match only: a sibling host is off-limits unless it was listed.
        assert not is_host_allowed("https://cdn.example.gov/x", parsed.allowed_hosts)

    def test_wait_for_is_normalized(self):
        parsed = parse_render_request(body(wait_for={"selector": "  #bid-list ", "network_idle": True}))
        assert parsed.wait_for.selector == "#bid-list"
        assert parsed.wait_for.network_idle is True

    @pytest.mark.parametrize(
        "payload",
        [
            "not-an-object",
            {},
            {"page_url": ""},
            {"page_url": "file:///etc/passwd"},
            {"page_url": "https:///no-host"},
            {"page_url": "https://portal.example.gov/x", "timeout_seconds": 0},
            {"page_url": "https://portal.example.gov/x", "timeout_seconds": 301},
            {"page_url": "https://portal.example.gov/x", "timeout_seconds": "30"},
            {"page_url": "https://portal.example.gov/x", "timeout_seconds": None},
            {"page_url": "https://portal.example.gov/x", "allowed_hosts": "example.gov"},
            {"page_url": "https://portal.example.gov/x", "allowed_hosts": [""]},
            {"page_url": "https://portal.example.gov/x", "wait_for": "#list"},
            {"page_url": "https://portal.example.gov/x", "wait_for": {"selector": 7}},
            {"page_url": "https://portal.example.gov/x", "wait_for": {"selector": "  "}},
            {"page_url": "https://portal.example.gov/x", "wait_for": {"network_idle": "yes"}},
            {"page_url": "https://portal.example.gov/x", "wait_for": {"click": ".next"}},
        ],
    )
    def test_invalid_bodies_are_rejected(self, payload):
        with pytest.raises(DownloadError) as error:
            parse_render_request(payload)
        assert error.value.code == "INVALID_REQUEST"
        assert error.value.status == 400

    def test_there_is_no_way_to_ask_for_a_credential_or_a_click(self):
        parsed = parse_render_request(body())
        assert set(vars(parsed)) == {"page_url", "timeout_seconds", "allowed_hosts", "wait_for"}


class TestRenderCap:
    def test_a_document_under_the_cap_passes_through(self):
        assert enforce_render_cap("<html></html>") == "<html></html>"

    def test_a_document_over_the_cap_is_too_large(self):
        with pytest.raises(DownloadError) as error:
            enforce_render_cap("x" * (MAX_RENDER_HTML_BYTES + 1))
        assert error.value.code == "TOO_LARGE"
        assert error.value.status == 413

    def test_the_cap_counts_utf8_bytes_not_characters(self):
        just_over = "招" * (MAX_RENDER_HTML_BYTES // 3 + 1)  # 3 bytes each
        with pytest.raises(DownloadError):
            enforce_render_cap(just_over)


class TestRenderRoute:
    def test_success_returns_the_c3_json_shape(self, running_server, monkeypatch):
        monkeypatch.setattr(
            server,
            "render_page",
            lambda request: RenderResult(
                final_url="https://portal.example.gov/open-bids",
                status=200,
                title="Open Solicitations",
                html="<html><ul id='bid-list'></ul></html>",
            ),
        )
        status, headers, data = request(running_server, "POST", "/render", body())
        assert status == 200
        assert headers["Content-Type"] == "application/json"
        assert json.loads(data) == {
            "final_url": "https://portal.example.gov/open-bids",
            "status": 200,
            "title": "Open Solicitations",
            "html": "<html><ul id='bid-list'></ul></html>",
        }

    @pytest.mark.parametrize(
        "code,status",
        [
            ("LOGIN_WALL", 403),
            ("OFF_HOST", 403),
            ("TOO_LARGE", 413),
            ("TIMEOUT", 504),
            ("NAVIGATION_FAILED", 502),
            ("BROWSER_ERROR", 500),
            ("INVALID_REQUEST", 400),
        ],
    )
    def test_errors_map_to_the_shared_status_table(self, running_server, monkeypatch, code, status):
        def failing(request):
            raise DownloadError(code, f"{code} happened")

        monkeypatch.setattr(server, "render_page", failing)
        got_status, _, data = request(running_server, "POST", "/render", body())
        assert got_status == status
        assert json.loads(data)["error"] == {"code": code, "message": f"{code} happened"}

    def test_an_unexpected_exception_becomes_browser_error(self, running_server, monkeypatch):
        def exploding(request):
            raise RuntimeError("boom")

        monkeypatch.setattr(server, "render_page", exploding)
        status, _, data = request(running_server, "POST", "/render", body())
        assert status == 500
        assert json.loads(data)["error"]["code"] == "BROWSER_ERROR"

    def test_an_invalid_body_never_reaches_the_browser(self, running_server, monkeypatch):
        called = []
        monkeypatch.setattr(server, "render_page", lambda request: called.append(request))
        status, _, data = request(running_server, "POST", "/render", body(page_url="file:///etc/passwd"))
        assert status == 400
        assert json.loads(data)["error"]["code"] == "INVALID_REQUEST"
        assert called == []

    def test_non_json_body_is_rejected(self, running_server):
        status, _, data = request(running_server, "POST", "/render", b"not json")
        assert status == 400
        assert json.loads(data)["error"]["code"] == "INVALID_REQUEST"

    def test_oversized_body_is_rejected_without_reading_it(self, running_server):
        status, _, data = request(
            running_server, "POST", "/render", raw_content_length=str(server.MAX_BODY_BYTES + 1)
        )
        assert status == 400
        assert json.loads(data)["error"]["code"] == "INVALID_REQUEST"

    def test_one_json_log_line_per_render_without_the_document(self, running_server, monkeypatch, capsys):
        monkeypatch.setattr(
            server,
            "render_page",
            lambda request: RenderResult(
                "https://portal.example.gov/open-bids", 200, "Open Solicitations", "<html>secret</html>"
            ),
        )
        request(running_server, "POST", "/render", body())
        captured = capsys.readouterr()
        lines = [line for line in captured.err.splitlines() if line.startswith("{")]
        assert len(lines) == 1
        entry = json.loads(lines[0])
        assert entry["event"] == "browser_render"
        assert entry["host"] == "portal.example.gov"
        assert entry["outcome"] == "OK"
        assert entry["byte_size"] == len("<html>secret</html>")
        assert "secret" not in captured.err


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
    _PortalHandler.redirect_target = f"http://localhost:{secondary.server_address[1]}/list"
    try:
        yield f"http://127.0.0.1:{primary.server_address[1]}"
    finally:
        for httpd, thread in ((primary, primary_thread), (secondary, secondary_thread)):
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)


def render(payload):
    from renderer import render_page

    return render_page(parse_render_request(payload))


class TestBrowserRender:
    def test_waiting_for_a_selector_returns_the_javascript_built_list(self, chromium_available, portal):
        result = render(
            {
                "page_url": f"{portal}/list",
                "timeout_seconds": 20,
                "allowed_hosts": ["127.0.0.1"],
                "wait_for": {"selector": "#bid-list", "network_idle": False},
            }
        )
        assert result.status == 200
        assert result.title == "Open Solicitations — Example County"
        assert result.final_url.endswith("/list")
        # The served document has none of this; only the rendered one does.
        assert '<ul id="bid-list">' in result.html
        assert "Street Sweeping Services 2026" in result.html
        assert "/solicitations/0000412233" in result.html

    def test_network_idle_alone_also_reaches_the_rendered_list(self, chromium_available, portal):
        result = render(
            {
                "page_url": f"{portal}/list",
                "timeout_seconds": 20,
                "allowed_hosts": ["127.0.0.1"],
                "wait_for": {"network_idle": True},
            }
        )
        assert '<ul id="bid-list">' in result.html

    def test_a_selector_that_never_appears_is_a_timeout(self, chromium_available, portal):
        with pytest.raises(DownloadError) as error:
            render(
                {
                    "page_url": f"{portal}/list",
                    "timeout_seconds": 2,
                    "allowed_hosts": ["127.0.0.1"],
                    "wait_for": {"selector": "#never-rendered"},
                }
            )
        assert error.value.code == "TIMEOUT"
        assert error.value.status == 504

    def test_a_login_wall_is_refused_and_its_html_is_not_returned(self, chromium_available, portal):
        with pytest.raises(DownloadError) as error:
            render({"page_url": f"{portal}/login", "timeout_seconds": 10, "allowed_hosts": ["127.0.0.1"]})
        assert error.value.code == "LOGIN_WALL"
        assert error.value.status == 403
        assert "password" not in error.value.message

    def test_a_redirect_to_an_unlisted_host_is_blocked(self, chromium_available, portal):
        with pytest.raises(DownloadError) as error:
            render({"page_url": f"{portal}/redirect", "timeout_seconds": 10, "allowed_hosts": ["127.0.0.1"]})
        assert error.value.code == "OFF_HOST"
        assert error.value.status == 403

    def test_an_unreachable_page_fails_without_a_traceback(self, chromium_available):
        with pytest.raises(DownloadError) as error:
            render({"page_url": "http://127.0.0.1:1/list", "timeout_seconds": 5, "allowed_hosts": ["127.0.0.1"]})
        assert error.value.code in ("NAVIGATION_FAILED", "TIMEOUT")

    def test_the_route_renders_end_to_end_over_http(self, chromium_available, portal, running_server):
        status, _, data = request(
            running_server,
            "POST",
            "/render",
            {
                "page_url": f"{portal}/list",
                "timeout_seconds": 20,
                "allowed_hosts": ["127.0.0.1"],
                "wait_for": {"selector": "#bid-list"},
            },
        )
        assert status == 200
        payload = json.loads(data)
        assert payload["status"] == 200
        assert payload["final_url"].endswith("/list")
        assert "Street Sweeping Services 2026" in payload["html"]
