"""Scrapling list extraction as the main list path (contracts C1/C2/C3).

Invariants under test:
  * exactly ONE list HTTP request per run (the fallback re-parses the same HTML);
  * a verified empty page short-circuits before the sidecar is ever called;
  * sidecar unreachable / invalid response / zero items all fall back to the adapter parser.
"""

from pathlib import Path

import pytest
import requests

from apsi_crawler.adapters import registry
from apsi_crawler.adapters.task import TaskSource
from apsi_crawler.errors import VerifiedEmptyListError
from apsi_crawler.list_extraction import (
    DEFAULT_MAX_ITEMS,
    LIST_FIELDS,
    ListExtractionError,
    ListExtractorClient,
    ListRenderError,
    resolve_list_extraction_config,
    run_list_extraction,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures"
ERIE_FIXTURE = FIXTURES_DIR / "bidnet_erie_no_open_bids.html"

BIDNET_ROW_HTML = """
<html><head><title>Aurora - Bid Opportunities | BidNet Direct</title></head><body>
<table>
<tr class="mets-table-row"><td><a href="/private/supplier/solicitations/4512345/detail">Street sweeping services</a></td>
<td><span class="date-value">09/01/2026</span></td><td><span class="date-value">09/30/2026</span></td></tr>
</table></body></html>
"""


def _source(**fetch_config):
    fetch_config.setdefault("base_url", "https://www.bidnetdirect.com/colorado/city-of-aurora/solicitations/open-bids")
    return TaskSource(
        id="bidnet_co_city_aurora",
        name="City of Aurora, CO (BidNet)",
        source_label="City of Aurora, CO (BidNet)",
        jurisdiction="city",
        state_code="CO",
        base_url=fetch_config["base_url"],
        fetch_config=fetch_config,
    )


class FakeListAdapter:
    """Stands in for a registry ListHtmlAdapter and counts its list requests."""

    def __init__(self, html=BIDNET_ROW_HTML, parsed=None, parse_error=None):
        self.html = html
        self.parsed = parsed if parsed is not None else [{"id": "parsed-1", "title": "Street sweeping services"}]
        self.parse_error = parse_error
        self.fetch_calls = []
        self.parse_calls = []

    def list_url(self, source):
        return source.fetch_config["base_url"]

    def fetch_list_html(self, source, url, session=None, timeout=30):
        self.fetch_calls.append({"url": url, "timeout": timeout})
        return self.html, url, 200

    def parse_list_html(self, source, html, query=None, limit=25):
        self.parse_calls.append({"html": html, "query": query, "limit": limit})
        if self.parse_error:
            raise self.parse_error
        return list(self.parsed)


class FakeListExtractor:
    def __init__(self, payload=None, error=None):
        self.payload = payload
        self.error = error
        self.calls = []

    def extract_list(self, html, url, item_selector=None, selectors=None, max_items=DEFAULT_MAX_ITEMS, timeout=None):
        self.calls.append(
            {
                "html": html,
                "url": url,
                "item_selector": item_selector,
                "selectors": selectors,
                "max_items": max_items,
            }
        )
        if self.error:
            raise self.error
        return self.payload


SIDECAR_ITEMS = {
    "items": [
        {
            "title": "Street sweeping services",
            "url": "https://www.bidnetdirect.com/private/supplier/solicitations/4512345/detail",
            "published_date": "09/01/2026",
            "deadline_date": "09/30/2026",
            "source_bid_id": "4512345",
            "issuer_name": None,
        },
        {
            "title": "Snow removal",
            "url": "https://www.bidnetdirect.com/private/supplier/solicitations/4512399/detail",
            "published_date": None,
            "deadline_date": None,
            "source_bid_id": "4512399",
            "issuer_name": "City of Aurora",
        },
    ],
    "diagnostics": {"title": "heuristic", "url": "heuristic", "source_bid_id": "heuristic"},
    "item_selector_used": "tr.mets-table-row",
    "empty_state": {"detected": False, "marker": None},
}


# --- resolve_list_extraction_config -------------------------------------------------------


def test_defaults_to_scrapling_when_the_sidecar_and_a_list_fetcher_exist():
    config = resolve_list_extraction_config({}, "http://extractor:8000/", True)

    assert config["mode"] == "scrapling"
    assert config["render"] is False
    assert config["item_selector"] is None
    assert config["max_items"] == DEFAULT_MAX_ITEMS
    assert config["selectors"] == {}
    assert config["extractor_url"] == "http://extractor:8000"


def test_defaults_to_adapter_without_an_extractor_url_or_without_html_support():
    assert resolve_list_extraction_config({}, "", True)["mode"] == "adapter"
    assert resolve_list_extraction_config({}, "http://extractor:8000", False)["mode"] == "adapter"


def test_explicit_scrapling_mode_degrades_to_adapter_when_it_cannot_run():
    config = resolve_list_extraction_config({"list_extraction": {"mode": "scrapling"}}, "", True)
    assert config["mode"] == "adapter"


def test_reads_selectors_render_and_max_items_from_fetch_config():
    config = resolve_list_extraction_config(
        {
            "list_extraction": {
                "mode": "scrapling",
                "render": True,
                "item_selector": " tr.mets-table-row ",
                "max_items": 900,
                "selectors": {"title": "a.solicitation", "url": " ", "bogus": "x", "deadline_date": 7},
            }
        },
        "http://extractor:8000",
        True,
    )

    assert config["render"] is True
    assert config["item_selector"] == "tr.mets-table-row"
    assert config["max_items"] == 500  # clamped to the contract ceiling
    assert config["selectors"] == {"title": "a.solicitation"}


# --- scrapling main path ------------------------------------------------------------------


def test_scrapling_path_normalizes_items_and_reports_metadata():
    adapter = FakeListAdapter()
    extractor = FakeListExtractor(payload=SIDECAR_ITEMS)
    config = resolve_list_extraction_config(
        {"list_extraction": {"item_selector": "tr.mets-table-row"}}, "http://extractor:8000", True
    )

    bids, stats = run_list_extraction(_source(), adapter, config, limit=25, extractor=extractor)

    assert [bid["source_bid_id"] for bid in bids] == ["4512345", "4512399"]
    assert bids[0]["source_url"].endswith("/4512345/detail")
    assert bids[0]["dedupe_key"] == "bidnet_co_city_aurora:4512345"
    assert bids[0]["issuer_name"] == "City of Aurora, CO (BidNet)"  # defaults to the source label
    assert bids[1]["issuer_name"] == "City of Aurora"
    assert stats == {
        "method": "scrapling",
        "items": 2,
        "diagnostics": {"title": "heuristic", "url": "heuristic", "source_bid_id": "heuristic"},
        "rendered": False,
        "extractor": "http://extractor:8000",
        "fallback_reason": None,
    }
    assert len(adapter.fetch_calls) == 1
    assert adapter.parse_calls == []


def test_scrapling_path_sends_the_contract_request_body():
    adapter = FakeListAdapter()
    extractor = FakeListExtractor(payload=SIDECAR_ITEMS)
    config = resolve_list_extraction_config(
        {"list_extraction": {"item_selector": "tr.mets-table-row", "max_items": 50, "selectors": {"title": "a"}}},
        "http://extractor:8000",
        True,
    )

    run_list_extraction(_source(), adapter, config, limit=25, extractor=extractor)

    call = extractor.calls[0]
    assert call["html"] == BIDNET_ROW_HTML
    assert call["url"] == _source().fetch_config["base_url"]
    assert call["item_selector"] == "tr.mets-table-row"
    assert call["selectors"] == {"title": "a"}
    assert call["max_items"] == 50


def test_query_and_limit_are_applied_to_sidecar_items():
    adapter = FakeListAdapter()
    extractor = FakeListExtractor(payload=SIDECAR_ITEMS)
    config = resolve_list_extraction_config({}, "http://extractor:8000", True)

    bids, stats = run_list_extraction(_source(), adapter, config, query="snow", limit=25, extractor=extractor)

    assert [bid["source_bid_id"] for bid in bids] == ["4512399"]
    assert stats["items"] == 1

    bids, _ = run_list_extraction(_source(), adapter, config, limit=1, extractor=extractor)
    assert len(bids) == 1


def test_verified_empty_page_is_decided_after_the_sidecar_and_adapter_both_find_no_rows():
    """Empty state is a conclusion drawn from zero parsed rows + visible copy, never a pre-check.

    A hidden template row saying "no open bids" must not short-circuit a page that lists real
    rows, so the sidecar always runs first; only when it AND the adapter parser find nothing does
    the adapter's own empty-state verdict surface, re-labelled with the scrapling method.
    """
    empty_payload = {"items": [], "diagnostics": {}, "item_selector_used": None, "empty_state": {"detected": True, "marker": "There are no open bids at this time."}}
    adapter = FakeListAdapter(
        html=ERIE_FIXTURE.read_text(encoding="utf-8"),
        parse_error=VerifiedEmptyListError("There are no open bids at this time.", True, method="adapter"),
    )
    extractor = FakeListExtractor(payload=empty_payload)
    source = TaskSource(
        id="bidnet_ny_erie",
        name="Erie County, NY (BidNet)",
        source_label="Erie County, NY (BidNet)",
        jurisdiction="county",
        state_code="NY",
        base_url="https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids",
        fetch_config={"base_url": "https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids"},
    )
    config = resolve_list_extraction_config({}, "http://extractor:8000", True)

    with pytest.raises(VerifiedEmptyListError) as error:
        run_list_extraction(source, adapter, config, extractor=extractor)

    assert error.value.tenant_confirmed is True
    assert error.value.method == "scrapling"
    assert len(extractor.calls) == 1
    assert len(adapter.parse_calls) == 1
    assert len(adapter.fetch_calls) == 1


def test_sidecar_rows_win_over_a_hidden_empty_state_template_row():
    """Real Aurora page: 16 open rows plus an aria-hidden 'no open bids' row."""
    from pathlib import Path

    html = (Path(__file__).parent / "fixtures" / "bidnet_aurora_open_bids_with_hidden_empty_row.html").read_text(encoding="utf-8", errors="ignore")
    adapter = FakeListAdapter(html=html)
    extractor = FakeListExtractor(payload=SIDECAR_ITEMS)
    source = TaskSource(
        id="bidnet_co_city_aurora",
        name="City of Aurora, CO (BidNet)",
        source_label="City of Aurora, CO (BidNet)",
        jurisdiction="city",
        state_code="CO",
        base_url="https://www.bidnetdirect.com/city-of-aurora/solicitations/open-bids",
        fetch_config={"base_url": "https://www.bidnetdirect.com/city-of-aurora/solicitations/open-bids"},
    )
    config = resolve_list_extraction_config({}, "http://extractor:8000", True)
    bids, stats = run_list_extraction(source, adapter, config, extractor=extractor)
    assert stats["method"] == "scrapling"
    assert len(bids) >= 1



@pytest.mark.parametrize(
    "extractor,expected_prefix",
    [
        (FakeListExtractor(error=ListExtractionError("extractor request failed: connection refused")), "extractor_unreachable"),
        (FakeListExtractor(payload={"items": "nope"}), "invalid_response"),
        (FakeListExtractor(payload={"items": [], "diagnostics": {}}), "no_items"),
    ],
)
def test_falls_back_to_the_adapter_parser_on_the_same_html(extractor, expected_prefix):
    adapter = FakeListAdapter()
    config = resolve_list_extraction_config({}, "http://extractor:8000", True)

    bids, stats = run_list_extraction(_source(), adapter, config, limit=25, extractor=extractor)

    assert [bid["id"] for bid in bids] == ["parsed-1"]
    assert stats["method"] == "adapter_fallback"
    assert stats["items"] == 1
    assert stats["fallback_reason"].startswith(expected_prefix)
    assert stats["extractor"] == "http://extractor:8000"
    # The whole point of the fallback: the SAME HTML is re-parsed, no second portal request.
    assert len(adapter.fetch_calls) == 1
    assert adapter.parse_calls[0]["html"] == BIDNET_ROW_HTML


def test_adapter_fallback_propagates_the_adapter_failure():
    adapter = FakeListAdapter(parse_error=ValueError("page did not contain open solicitations"))
    extractor = FakeListExtractor(payload={"items": [], "diagnostics": {}})
    config = resolve_list_extraction_config({}, "http://extractor:8000", True)

    with pytest.raises(ValueError):
        run_list_extraction(_source(), adapter, config, extractor=extractor)


# --- render (C3) --------------------------------------------------------------------------


class FakeRenderer:
    def __init__(self, html=BIDNET_ROW_HTML, error=None):
        self.html = html
        self.error = error
        self.calls = []

    def render(self, page_url, allowed_hosts=None, timeout_seconds=30, wait_for=None):
        self.calls.append({"page_url": page_url, "allowed_hosts": allowed_hosts, "wait_for": wait_for})
        if self.error:
            raise self.error
        return self.html, page_url, 200


def test_render_mode_uses_the_browser_sidecar_instead_of_a_plain_fetch():
    adapter = FakeListAdapter()
    extractor = FakeListExtractor(payload=SIDECAR_ITEMS)
    renderer = FakeRenderer()
    config = resolve_list_extraction_config(
        {"list_extraction": {"render": True, "item_selector": "tr.mets-table-row"}}, "http://extractor:8000", True
    )

    bids, stats = run_list_extraction(_source(), adapter, config, extractor=extractor, renderer=renderer)

    assert len(bids) == 2
    assert stats["rendered"] is True
    assert adapter.fetch_calls == []
    assert renderer.calls[0]["allowed_hosts"] == ["www.bidnetdirect.com"]
    assert renderer.calls[0]["wait_for"] == {"selector": "tr.mets-table-row", "network_idle": True}


def test_render_guard_failures_surface_as_run_errors():
    adapter = FakeListAdapter()
    renderer = FakeRenderer(error=ListRenderError("browser downloader 422 OFF_HOST: left the allowed hosts"))
    config = resolve_list_extraction_config({"list_extraction": {"render": True}}, "http://extractor:8000", True)

    with pytest.raises(ListRenderError):
        run_list_extraction(_source(), adapter, config, extractor=FakeListExtractor(payload=SIDECAR_ITEMS), renderer=renderer)

    assert adapter.fetch_calls == []


def test_render_without_a_configured_browser_sidecar_is_an_error(monkeypatch):
    monkeypatch.delenv("BROWSER_DOWNLOADER_URL", raising=False)
    adapter = FakeListAdapter()
    config = resolve_list_extraction_config({"list_extraction": {"render": True}}, "http://extractor:8000", True)

    with pytest.raises(ListRenderError):
        run_list_extraction(_source(), adapter, config, extractor=FakeListExtractor(payload=SIDECAR_ITEMS))


# --- sidecar client -----------------------------------------------------------------------


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FakePostSession:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def post(self, url, json=None, timeout=None):
        self.calls.append({"url": url, "json": json, "timeout": timeout})
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def test_client_posts_the_c2_body_to_extract_list():
    session = FakePostSession(FakeResponse(SIDECAR_ITEMS))
    client = ListExtractorClient("http://extractor:8000/", session=session)

    payload = client.extract_list(
        "<html></html>", "https://portal.example.gov/list", item_selector="tr", selectors={"title": "a"}, max_items=10
    )

    assert payload == SIDECAR_ITEMS
    assert session.calls[0]["url"] == "http://extractor:8000/extract-list"
    assert session.calls[0]["json"] == {
        "url": "https://portal.example.gov/list",
        "html": "<html></html>",
        "item_selector": "tr",
        "selectors": {"title": "a"},
        "fields": list(LIST_FIELDS),
        "max_items": 10,
        "auto_save": True,
    }


def test_client_maps_transport_and_protocol_problems_to_list_extraction_errors():
    with pytest.raises(ListExtractionError):
        ListExtractorClient("http://x", session=FakePostSession(requests.ConnectionError("refused"))).extract_list("<html></html>", "u")

    with pytest.raises(ListExtractionError):
        ListExtractorClient("http://x", session=FakePostSession(FakeResponse(ValueError("not json")))).extract_list("<html></html>", "u")

    with pytest.raises(ListExtractionError):
        ListExtractorClient(
            "http://x", session=FakePostSession(FakeResponse({"error": {"code": "INVALID_REQUEST", "message": "bad"}}, status_code=400))
        ).extract_list("<html></html>", "u")


# --- registry -----------------------------------------------------------------------------


def test_registry_exposes_list_html_fetchers_for_bidnet_and_generic():
    bidnet = registry.resolve_list_html_adapter("bidnet_ny_erie", "bidnet")
    generic = registry.resolve_list_html_adapter("xx_state_procurement", "generic")

    assert bidnet is not None and generic is not None
    assert bidnet.list_url(_source()) == _source().fetch_config["base_url"]
    assert registry.resolve_list_html_adapter("il_bidbuy", "state_portal") is None


class FakeHtmlResponse:
    def __init__(self, status_code=200, text=BIDNET_ROW_HTML, url=None):
        self.status_code = status_code
        self.text = text
        self.headers = {"Content-Type": "text/html"}
        self.url = url
        self.history = []


class FakeGetSession:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(url)
        return self.response


def test_bidnet_list_html_fetcher_surfaces_the_waf_challenge():
    from apsi_crawler.spiders import co_bidnet

    session = FakeGetSession(FakeHtmlResponse(status_code=202, text="challenge"))
    co_bidnet._last_live_request_at = 0.0

    with pytest.raises(co_bidnet.BidNetChallengeError):
        co_bidnet.fetch_bidnet_list_html(_source(), _source().fetch_config["base_url"], session=session, timeout=5)

    assert len(session.calls) == 1


def test_bidnet_list_html_fetcher_returns_html_final_url_and_status():
    from apsi_crawler.spiders import co_bidnet

    url = _source().fetch_config["base_url"]
    session = FakeGetSession(FakeHtmlResponse(url=url))
    co_bidnet._last_live_request_at = 0.0

    html, final_url, status = co_bidnet.fetch_bidnet_list_html(_source(), url, session=session, timeout=5)

    assert html == BIDNET_ROW_HTML
    assert final_url == url
    assert status == 200
