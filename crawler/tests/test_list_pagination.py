"""Paged list stage (spec 2026-09-24 §5.2/§5.3): one fetch per page, Scrapling main path."""

import re
from datetime import date
from pathlib import Path

import pytest

from apsi_crawler.adapters import registry
from apsi_crawler.adapters.task import TaskSource
from apsi_crawler.errors import VerifiedEmptyListError
from apsi_crawler.list_extraction import (
    ListExtractionError,
    resolve_list_extraction_config,
    resolve_pagination_request,
    run_paginated_list_extraction,
)

FIXTURES = Path(__file__).parent / "fixtures"
OPEN = (FIXTURES / "bidnet_denver_open_bids_2026_09_24.html").read_text(encoding="utf-8")
CLOSED = (FIXTURES / "bidnet_denver_closed_bids_2026_09_24.html").read_text(encoding="utf-8")
ERIE = (FIXTURES / "bidnet_erie_no_open_bids.html").read_text(encoding="utf-8")
DENVER = "https://www.bidnetdirect.com/colorado/city-and-county-of-denver-general-services-purchasing"
PAGE_TWO = DENVER + "/solicitations/closed-bids?pageNumber=2&selectedContent=BUYER"


def _source(label="City and County of Denver General Services Purchasing (BidNet)", base_url=DENVER + "/solicitations/open-bids"):
    return TaskSource(
        id="bidnet_co_denver", name=label, source_label=label, jurisdiction="county",
        state_code="CO", base_url=base_url, fetch_config={"base_url": base_url},
    )


class PagedFetcher:
    """Serves saved pages by URL through the real BidNet list adapter and records every request."""

    def __init__(self, pages):
        self.pages = pages
        self.urls = []

    def adapter(self):
        return registry.BIDNET_LIST_HTML_ADAPTER._replace(fetch_list_html=self.fetch)

    def fetch(self, source, url, session=None, timeout=30):
        self.urls.append(url)
        return self.pages[url], url, 200


def _closed_two_pages():
    # Page 2 is the saved open page: it has no next link, so it is the last page.
    return PagedFetcher({DENVER + "/solicitations/closed-bids?selectedContent=BUYER": CLOSED, PAGE_TWO: OPEN})


def _adapter_config():
    return resolve_list_extraction_config({}, "", True)


def _scrapling_config():
    return resolve_list_extraction_config({}, "http://extractor.test", True)


def _request(**overrides):
    request = {"list_kind": "closed", "start_page": 1, "max_pages": 4, "stop_before": None}
    request.update(overrides)
    return request


class Extractor:
    def __init__(self, items_for=None, error=None):
        self.items_for = items_for
        self.error = error

    def extract_list(self, html, url, item_selector=None, selectors=None, max_items=200, timeout=None):
        if self.error:
            raise self.error
        return {"items": self.items_for(html), "diagnostics": {"title": "heuristic"}, "empty_state": {"detected": False, "marker": None}}


def _sidecar_items(html, drop=()):
    items = []
    for match in re.finditer(r'href="([^"]*/(\d{7,})\?[^"]*)"[^>]*>(.*?)</a>', html, re.S):
        if match.group(2) in drop:
            continue
        items.append({"title": re.sub(r"<[^>]+>", "", match.group(3)).strip(), "url": "https://www.bidnetdirect.com" + match.group(1).replace("&amp;", "&"),
                      "published_date": None, "deadline_date": None, "source_bid_id": match.group(2), "issuer_name": None})
    return items


def test_follows_next_links_until_the_last_page():
    fetcher = _closed_two_pages()

    bids, stats, pagination = run_paginated_list_extraction(_source(), fetcher.adapter(), _adapter_config(), _request())

    assert fetcher.urls == [DENVER + "/solicitations/closed-bids?selectedContent=BUYER", PAGE_TWO]
    assert len(bids) == 31
    assert stats == {"method": "adapter", "items": 31, "diagnostics": {}, "rendered": False, "extractor": None, "fallback_reason": None}
    assert pagination == {
        "list_kind": "closed", "start_page": 1, "pages_fetched": 2, "next_page": None,
        "stopped_reason": "exhausted", "requests_made": 2, "complete": True,
    }
    assert bids[0]["solicitation_number"] == "0147A_2026"
    assert bids[0]["lifecycle_status"] == "closed"


def test_stops_at_max_pages_and_reports_where_to_resume():
    fetcher = _closed_two_pages()

    bids, _stats, pagination = run_paginated_list_extraction(_source(), fetcher.adapter(), _adapter_config(), _request(max_pages=1))

    assert len(fetcher.urls) == 1 and len(bids) == 25
    assert (pagination["stopped_reason"], pagination["next_page"], pagination["complete"]) == ("max_pages", 2, False)


def test_stop_before_ends_the_walk_once_a_whole_page_is_older():
    fetcher = _closed_two_pages()
    _bids, _stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _adapter_config(), _request(stop_before=date(2026, 10, 1))
    )
    assert (pagination["stopped_reason"], pagination["pages_fetched"], pagination["complete"]) == ("window", 1, False)

    fetcher = _closed_two_pages()
    _bids, _stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _adapter_config(), _request(stop_before=date(2026, 1, 1))
    )
    assert (pagination["stopped_reason"], pagination["pages_fetched"]) == ("exhausted", 2)


@pytest.mark.parametrize(("query", "limit"), [(None, 10), ("guardrails", None)])
def test_limit_or_query_makes_the_run_incomplete(query, limit):
    bids, _stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages().adapter(), _adapter_config(), _request(), query=query, limit=limit
    )
    assert pagination["complete"] is False
    assert len(bids) == (10 if limit else 1)


def test_scrapling_rows_get_the_reader_number_and_lifecycle():
    bids, stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages().adapter(), _scrapling_config(), _request(), extractor=Extractor(_sidecar_items)
    )

    assert stats["method"] == "scrapling" and stats["extractor"] == "http://extractor.test"
    assert pagination["complete"] is True
    first = next(bid for bid in bids if bid["source_bid_id"] == "0000436158")
    assert (first["solicitation_number"], first["lifecycle_status"], first["deadline_date"]) == ("0147A_2026", "closed", "09/23/2026")


def test_a_sidecar_that_misses_a_row_makes_the_run_incomplete():
    extractor = Extractor(lambda html: _sidecar_items(html, drop=("0000436158",)))

    _bids, _stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages().adapter(), _scrapling_config(), _request(), extractor=extractor
    )
    assert pagination["complete"] is False


def test_sidecar_failure_falls_back_to_the_reader_rows_per_page():
    bids, stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages().adapter(), _scrapling_config(), _request(),
        extractor=Extractor(error=ListExtractionError("extractor request failed: refused")),
    )
    assert stats["method"] == "adapter_fallback"
    assert stats["fallback_reason"].startswith("extractor_unreachable")
    assert len(bids) == 31 and pagination["complete"] is True


def test_an_empty_first_page_is_a_verified_empty_list_with_complete_pagination():
    label = "Erie County, NY (BidNet)"
    fetcher = PagedFetcher({"https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids": ERIE})

    with pytest.raises(VerifiedEmptyListError) as error:
        run_paginated_list_extraction(
            _source(label, "https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids"),
            fetcher.adapter(), _adapter_config(), _request(list_kind="open"),
        )

    assert error.value.tenant_confirmed is True
    assert error.value.method == "adapter"
    assert error.value.pagination == {
        "list_kind": "open", "start_page": 1, "pages_fetched": 1, "next_page": None,
        "stopped_reason": "exhausted", "requests_made": 1, "complete": True,
    }


def test_resolve_pagination_request_defaults_clamps_and_rejects():
    assert resolve_pagination_request({}) == {"list_kind": "open", "start_page": 1, "max_pages": 4, "stop_before": None}
    assert resolve_pagination_request({"max_pages": 999, "start_page": 0})["max_pages"] == 50
    assert resolve_pagination_request({"start_page": 0})["start_page"] == 1
    assert resolve_pagination_request({"stop_before": "2024-09-24"})["stop_before"] == date(2024, 9, 24)
    with pytest.raises(ValueError):
        resolve_pagination_request({"list_kind": "pending"})
    with pytest.raises(ValueError):
        resolve_pagination_request({"stop_before": "09/24/2024"})


def test_only_the_bidnet_list_adapter_is_paginated():
    assert registry.BIDNET_LIST_HTML_ADAPTER.page_reader is not None
    assert registry.GENERIC_LIST_HTML_ADAPTER.page_reader is None
