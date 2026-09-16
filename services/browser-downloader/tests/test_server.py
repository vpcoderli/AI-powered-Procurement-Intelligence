"""HTTP surface of the sidecar. The downloader is stubbed, so no browser is needed."""

import http.client
import json
import threading

import pytest

import server
from guards import DownloadError
from server import MAX_BODY_BYTES, DownloadResult, create_server


@pytest.fixture()
def running_server():
    httpd = create_server(port=0, host="127.0.0.1")
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def request(address, method, path, body=None, headers=None, raw_content_length=None):
    connection = http.client.HTTPConnection(address, timeout=10)
    sent_headers = dict(headers or {})
    payload = body
    if isinstance(body, (dict, list)):
        payload = json.dumps(body).encode()
        sent_headers.setdefault("Content-Type", "application/json")
    if raw_content_length is not None:
        sent_headers["Content-Length"] = raw_content_length
        connection.putrequest(method, path)
        for key, value in sent_headers.items():
            connection.putheader(key, value)
        connection.endheaders()
        if payload:
            connection.send(payload)
    else:
        connection.request(method, path, body=payload, headers=sent_headers)
    response = connection.getresponse()
    data = response.read()
    result = (response.status, dict(response.getheaders()), data)
    connection.close()
    return result


def valid_body(**overrides):
    body = {
        "page_url": "https://portal.example.gov/detail?id=1",
        "link": {"href_contains": "1807333", "text": "Solicitation.pdf", "selector": None},
        "timeout_seconds": 5,
        "max_bytes": 1048576,
        "allowed_hosts": ["portal.example.gov"],
    }
    body.update(overrides)
    return body


class TestHealth:
    def test_reports_ok_when_chromium_is_available(self, running_server, monkeypatch):
        monkeypatch.setattr(
            server, "probe_browser", lambda: {"ok": True, "browser": "chromium", "playwright": "1.63.0"}
        )
        status, _, data = request(running_server, "GET", "/health")
        assert status == 200
        assert json.loads(data) == {"ok": True, "browser": "chromium", "playwright": "1.63.0"}

    def test_reports_503_when_chromium_is_missing(self, running_server, monkeypatch):
        def missing():
            raise DownloadError("BROWSER_ERROR", "chromium executable not found")

        monkeypatch.setattr(server, "probe_browser", missing)
        status, _, data = request(running_server, "GET", "/health")
        assert status == 503
        payload = json.loads(data)
        assert payload["ok"] is False
        assert "chromium" in payload["error"]

    def test_unknown_get_route_is_404(self, running_server):
        status, _, data = request(running_server, "GET", "/nope")
        assert status == 404
        assert json.loads(data)["error"]["code"] == "NOT_FOUND"


class TestDownloadValidation:
    def test_unknown_post_route_is_404(self, running_server):
        status, _, data = request(running_server, "POST", "/extract", body={})
        assert status == 404
        assert json.loads(data)["error"]["code"] == "NOT_FOUND"

    def test_non_json_body_is_rejected(self, running_server):
        status, _, data = request(running_server, "POST", "/download", body=b"not json")
        assert status == 400
        assert json.loads(data)["error"]["code"] == "INVALID_REQUEST"

    def test_missing_content_length_is_rejected(self, running_server):
        status, _, data = request(running_server, "POST", "/download", raw_content_length="0")
        assert status == 400
        assert json.loads(data)["error"]["code"] == "INVALID_REQUEST"

    def test_negative_content_length_is_rejected(self, running_server):
        status, _, data = request(running_server, "POST", "/download", raw_content_length="-1")
        assert status == 400
        assert json.loads(data)["error"]["code"] == "INVALID_REQUEST"

    def test_non_numeric_content_length_is_rejected(self, running_server):
        status, _, data = request(running_server, "POST", "/download", raw_content_length="abc")
        assert status == 400
        assert json.loads(data)["error"]["code"] == "INVALID_REQUEST"

    def test_oversized_body_is_rejected_without_reading_it(self, running_server):
        status, _, data = request(
            running_server, "POST", "/download", raw_content_length=str(MAX_BODY_BYTES + 1)
        )
        assert status == 400
        assert json.loads(data)["error"]["code"] == "INVALID_REQUEST"

    def test_non_http_page_url_is_rejected(self, running_server, monkeypatch):
        called = []
        monkeypatch.setattr(server, "download_attachment", lambda request: called.append(request))
        status, _, data = request(running_server, "POST", "/download", body=valid_body(page_url="file:///etc/passwd"))
        assert status == 400
        assert json.loads(data)["error"]["code"] == "INVALID_REQUEST"
        assert called == []

    def test_missing_link_spec_is_rejected(self, running_server):
        status, _, data = request(running_server, "POST", "/download", body=valid_body(link={}))
        assert status == 400
        assert json.loads(data)["error"]["code"] == "INVALID_REQUEST"


class TestDownloadOutcomes:
    def test_success_returns_binary_body_and_c2_headers(self, running_server, monkeypatch):
        monkeypatch.setattr(
            server,
            "download_attachment",
            lambda req: DownloadResult(
                content=b"%PDF-1.4 fake",
                filename="Solicitation.pdf",
                content_type="application/pdf",
                final_url="https://portal.example.gov/files/1807333.pdf",
            ),
        )
        status, headers, data = request(running_server, "POST", "/download", body=valid_body())
        assert status == 200
        assert data == b"%PDF-1.4 fake"
        assert headers["Content-Type"] == "application/pdf"
        assert headers["X-Download-Filename"] == "Solicitation.pdf"
        assert headers["X-Download-Content-Type"] == "application/pdf"
        assert headers["X-Download-Final-Url"] == "https://portal.example.gov/files/1807333.pdf"
        assert headers["X-Download-Byte-Size"] == str(len(b"%PDF-1.4 fake"))
        assert headers["Content-Length"] == str(len(b"%PDF-1.4 fake"))

    def test_non_ascii_filename_is_header_safe(self, running_server, monkeypatch):
        monkeypatch.setattr(
            server,
            "download_attachment",
            lambda req: DownloadResult(b"%PDF-1.4", "招标文件.pdf", "application/pdf", "https://portal.example.gov/a"),
        )
        status, headers, _ = request(running_server, "POST", "/download", body=valid_body())
        assert status == 200
        assert headers["X-Download-Filename"].isascii()

    @pytest.mark.parametrize(
        "code,status",
        [
            ("LOGIN_WALL", 403),
            ("OFF_HOST", 403),
            ("LINK_NOT_FOUND", 404),
            ("TOO_LARGE", 413),
            ("TIMEOUT", 504),
            ("NAVIGATION_FAILED", 502),
            ("BROWSER_ERROR", 500),
        ],
    )
    def test_download_errors_map_to_c2_statuses(self, running_server, monkeypatch, code, status):
        def failing(req):
            raise DownloadError(code, f"{code} happened")

        monkeypatch.setattr(server, "download_attachment", failing)
        got_status, _, data = request(running_server, "POST", "/download", body=valid_body())
        assert got_status == status
        assert json.loads(data)["error"] == {"code": code, "message": f"{code} happened"}

    def test_unexpected_exception_becomes_browser_error(self, running_server, monkeypatch):
        def exploding(req):
            raise RuntimeError("boom")

        monkeypatch.setattr(server, "download_attachment", exploding)
        status, _, data = request(running_server, "POST", "/download", body=valid_body())
        assert status == 500
        payload = json.loads(data)
        assert payload["error"]["code"] == "BROWSER_ERROR"
        assert "RuntimeError" in payload["error"]["message"]


class TestAccessLog:
    def test_logs_one_json_line_per_request_without_bodies(self, running_server, monkeypatch, capsys):
        monkeypatch.setattr(
            server,
            "download_attachment",
            lambda req: DownloadResult(b"%PDF-1.4 secret bytes", "Doc.pdf", "application/pdf", "https://portal.example.gov/a"),
        )
        request(running_server, "POST", "/download", body=valid_body())
        captured = capsys.readouterr()
        lines = [line for line in captured.err.splitlines() if line.startswith("{")]
        assert len(lines) == 1
        entry = json.loads(lines[0])
        assert entry["event"] == "browser_download"
        assert entry["host"] == "portal.example.gov"
        assert entry["outcome"] == "OK"
        assert entry["status"] == 200
        assert entry["byte_size"] == len(b"%PDF-1.4 secret bytes")
        assert isinstance(entry["duration_ms"], int)
        assert "secret" not in captured.err
        assert "1807333" not in captured.err

    def test_logs_the_error_code_for_failures(self, running_server, monkeypatch, capsys):
        def failing(req):
            raise DownloadError("LOGIN_WALL", "login form detected")

        monkeypatch.setattr(server, "download_attachment", failing)
        request(running_server, "POST", "/download", body=valid_body())
        entry = json.loads([line for line in capsys.readouterr().err.splitlines() if line.startswith("{")][0])
        assert entry["outcome"] == "LOGIN_WALL"
        assert entry["status"] == 403
        assert entry["byte_size"] == 0
