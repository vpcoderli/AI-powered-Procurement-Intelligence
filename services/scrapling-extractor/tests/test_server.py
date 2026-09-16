import json
import http.client
import os
import pathlib
import threading
import urllib.error
import urllib.request

import pytest

pytest.importorskip("scrapling")

from server import (  # noqa: E402
    MAX_HTML_BYTES,
    REQUEST_TIMEOUT_SECONDS,
    ExtractorHandler,
    create_server,
    resolve_storage_dir,
)

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def storage_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("scrapling-storage")


@pytest.fixture(scope="module")
def base_url(storage_dir):
    server = create_server(0, storage_dir=str(storage_dir))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def _post(base_url, body, raw=None):
    data = raw if raw is not None else json.dumps(body).encode()
    request = urllib.request.Request(
        f"{base_url}/extract",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def test_health_reports_scrapling_version(base_url):
    with urllib.request.urlopen(f"{base_url}/health", timeout=5) as response:
        body = json.loads(response.read())
    assert response.status == 200
    assert body["ok"] is True
    assert body["scrapling"] == "0.4.15"


def test_extract_returns_fields_and_attachments(base_url):
    html = (FIXTURES / "synthetic_detail.html").read_text(encoding="utf-8")
    status, body = _post(
        base_url,
        {
            "url": "https://example.gov/bids/26-101",
            "html": html,
            "fields": ["description", "attachments"],
            "selectors": None,
        },
    )
    assert status == 200
    assert body["fields"]["description"].startswith("The Department seeks")
    assert body["attachments"][0]["url"] == "https://example.gov/docs/rfq-26-101-spec.pdf"
    assert body["diagnostics"]["description"] == "heuristic"


def test_invalid_json_is_400(base_url):
    status, body = _post(base_url, None, raw=b"{not json")
    assert status == 400
    assert body["error"]["code"] == "INVALID_REQUEST"


def test_unknown_field_is_400(base_url):
    status, body = _post(
        base_url,
        {"url": "https://example.gov", "html": "<p>x</p>", "fields": ["price"]},
    )
    assert status == 400
    assert body["error"]["code"] == "INVALID_REQUEST"
    assert "unsupported fields" in body["error"]["message"]


def test_oversized_html_is_413(base_url):
    status, body = _post(
        base_url,
        {
            "url": "https://example.gov",
            "html": "x" * (MAX_HTML_BYTES + 1),
            "fields": ["description"],
        },
    )
    assert status == 413
    assert body["error"]["code"] == "INVALID_REQUEST"


def test_unknown_path_is_404(base_url):
    try:
        urllib.request.urlopen(f"{base_url}/nope", timeout=5)
        assert False, "expected 404"
    except urllib.error.HTTPError as error:
        assert error.code == 404


def test_handler_has_a_connection_timeout():
    # Without a timeout a half-sent request pins a worker thread on rfile.read() indefinitely.
    assert ExtractorHandler.timeout == REQUEST_TIMEOUT_SECONDS
    assert REQUEST_TIMEOUT_SECONDS > 0


def test_extract_writes_the_adaptive_store_into_the_server_storage_dir(base_url, storage_dir):
    html = (FIXTURES / "synthetic_detail.html").read_text(encoding="utf-8")
    status, _ = _post(
        base_url,
        {"url": "https://example.gov/bids/26-101", "html": html, "fields": ["description"]},
    )
    assert status == 200
    assert (storage_dir / "elements_storage.db").exists()


def test_resolve_storage_dir_prefers_the_env_var(tmp_path, monkeypatch):
    target = tmp_path / "nested" / "scrapling"
    monkeypatch.setenv("SCRAPLING_STORAGE_DIR", str(target))
    assert resolve_storage_dir() == str(target)
    assert target.is_dir()


def test_resolve_storage_dir_falls_back_when_the_target_is_unusable(monkeypatch):
    monkeypatch.setenv("SCRAPLING_STORAGE_DIR", "/proc/definitely-not-creatable/scrapling")
    assert resolve_storage_dir() == os.getcwd()


def test_server_defaults_to_loopback(storage_dir, monkeypatch):
    monkeypatch.delenv("EXTRACTOR_HOST", raising=False)
    server = create_server(0, storage_dir=str(storage_dir))
    try:
        assert server.server_address[0] == "127.0.0.1"
    finally:
        server.server_close()


@pytest.mark.parametrize("updates", [
    {"fields": [{"field": "description"}]},
    {"selectors": {"description": 123}},
    {"selectors": {"unknown": "p"}},
    {"url": "javascript:alert(1)"},
])
def test_invalid_request_schema_is_400(base_url, updates):
    payload = {"url": "https://example.gov/bid/1", "html": "<p>Scope</p>", "fields": ["description"]}
    payload.update(updates)
    status, body = _post(base_url, payload)
    assert status == 400
    assert body["error"]["code"] == "INVALID_REQUEST"


@pytest.mark.parametrize("length", ["bogus", "-1"])
def test_invalid_content_length_is_400(base_url, length):
    connection = http.client.HTTPConnection(base_url.removeprefix("http://"), timeout=2)
    try:
        connection.request("POST", "/extract", body=b"{}", headers={"Content-Length": length})
        response = connection.getresponse()
        assert response.status == 400
        assert json.loads(response.read())["error"]["code"] == "INVALID_REQUEST"
    finally:
        connection.close()
