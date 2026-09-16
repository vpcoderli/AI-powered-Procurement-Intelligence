"""HTTP surface of `POST /extract-list` (contract C2): envelope, caps and validation."""

import http.client
import json
import pathlib
import threading
import urllib.error
import urllib.request

import pytest

pytest.importorskip("scrapling")

from server import MAX_HTML_BYTES, create_server  # noqa: E402

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
IL_URL = "https://www.bidbuy.illinois.gov/bso/external/publicBids.sdo"
ERIE_URL = "https://www.bidnetdirect.com/erie-county-ny/solicitations/open-bids"


@pytest.fixture(scope="module")
def storage_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("list-route-storage")


@pytest.fixture(scope="module")
def base_url(storage_dir):
    server = create_server(0, storage_dir=str(storage_dir))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def post(base_url, body, raw=None, path="/extract-list"):
    data = raw if raw is not None else json.dumps(body).encode()
    request = urllib.request.Request(
        f"{base_url}{path}", data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def read(name, directory="list"):
    return (FIXTURES / directory / name).read_text(encoding="utf-8")


class TestExtractListRoute:
    def test_returns_items_diagnostics_and_empty_state(self, base_url):
        status, body = post(
            base_url, {"url": IL_URL, "html": read("il_bidbuy_open_bids.html"), "auto_save": True}
        )
        assert status == 200
        assert set(body) == {"items", "diagnostics", "item_selector_used", "empty_state"}
        assert len(body["items"]) == 1
        assert body["items"][0]["title"] == "Enterprise data integration services"
        assert body["items"][0]["url"].startswith("https://www.bidbuy.illinois.gov/")
        assert body["items"][0]["source_bid_id"] == "IL-BIDBUY-2026-001"
        assert body["diagnostics"]["title"] == "heuristic"
        assert body["empty_state"] == {"detected": False, "marker": None}

    def test_empty_state_page_returns_zero_items(self, base_url):
        status, body = post(
            base_url, {"url": ERIE_URL, "html": read("bidnet_erie_no_open_bids.html", "live")}
        )
        assert status == 200
        assert body["items"] == []
        assert body["empty_state"]["detected"] is True
        assert "no open bids" in body["empty_state"]["marker"].lower()

    def test_item_selector_and_max_items_are_honoured(self, base_url):
        status, body = post(
            base_url,
            {
                "url": "https://procurement.example.gov/solicitations",
                "html": read("synthetic_cards.html"),
                "item_selector": "article.bid-card",
                "max_items": 1,
                "fields": ["title", "url"],
            },
        )
        assert status == 200
        assert body["item_selector_used"] == "article.bid-card"
        assert len(body["items"]) == 1
        assert set(body["items"][0]) == {"title", "url"}

    def test_the_extract_route_still_works(self, base_url):
        status, body = post(
            base_url,
            {
                "url": "https://example.gov/bids/26-101",
                "html": (FIXTURES / "synthetic_detail.html").read_text(encoding="utf-8"),
                "fields": ["description"],
            },
            path="/extract",
        )
        assert status == 200
        assert body["fields"]["description"].startswith("The Department seeks")


class TestExtractListValidation:
    @pytest.mark.parametrize(
        "updates",
        [
            {"html": None},
            {"url": None},
            {"url": "javascript:alert(1)"},
            {"fields": ["price"]},
            {"fields": "title"},
            {"selectors": "title"},
            {"selectors": {"title": 5}},
            {"selectors": {"unknown": "p"}},
            {"item_selector": ""},
            {"item_selector": 7},
            {"max_items": 0},
            {"max_items": 501},
            {"max_items": "10"},
            {"auto_save": "yes"},
        ],
    )
    def test_invalid_requests_are_400(self, base_url, updates):
        payload = {"url": IL_URL, "html": "<table><tr><td><a href='/b/1234'>x</a></td></tr></table>"}
        payload.update(updates)
        status, body = post(base_url, payload)
        assert status == 400
        assert body["error"]["code"] == "INVALID_REQUEST"

    def test_invalid_json_is_400(self, base_url):
        status, body = post(base_url, None, raw=b"{not json")
        assert status == 400
        assert body["error"]["code"] == "INVALID_REQUEST"

    def test_non_object_body_is_400(self, base_url):
        status, body = post(base_url, ["nope"])
        assert status == 400
        assert body["error"]["code"] == "INVALID_REQUEST"

    def test_oversized_html_is_413(self, base_url):
        status, body = post(base_url, {"url": IL_URL, "html": "x" * (MAX_HTML_BYTES + 1)})
        assert status == 413
        assert body["error"]["code"] == "INVALID_REQUEST"

    @pytest.mark.parametrize("length", ["bogus", "-1"])
    def test_invalid_content_length_is_400(self, base_url, length):
        connection = http.client.HTTPConnection(base_url.removeprefix("http://"), timeout=5)
        try:
            connection.request("POST", "/extract-list", body=b"{}", headers={"Content-Length": length})
            response = connection.getresponse()
            assert response.status == 400
            assert json.loads(response.read())["error"]["code"] == "INVALID_REQUEST"
        finally:
            connection.close()

    def test_unknown_post_route_is_404(self, base_url):
        status, body = post(base_url, {}, path="/extract-everything")
        assert status == 404
        assert body["error"]["code"] == "NOT_FOUND"

    def test_defaults_need_neither_fields_nor_selectors(self, base_url):
        status, body = post(base_url, {"url": IL_URL, "html": read("il_bidbuy_open_bids.html")})
        assert status == 200
        assert set(body["items"][0]) == {
            "title", "url", "published_date", "deadline_date", "source_bid_id", "issuer_name",
        }
