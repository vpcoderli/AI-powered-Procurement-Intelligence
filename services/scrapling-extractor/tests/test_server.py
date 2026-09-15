import json
import pathlib
import threading
import urllib.error
import urllib.request

import pytest

pytest.importorskip("scrapling")

from server import MAX_HTML_BYTES, create_server  # noqa: E402

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def base_url():
    server = create_server(0)
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
