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
    ListPageReadError,
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
DENVER_TITLE = "City and County of Denver General Services Purchasing - Bid Opportunities | BidNet Direct"

# A blank/interstitial page: no rows at all, but (dangerously) its own next link -- proving the
# walk must stop here rather than trust it as "the last page" and quietly follow it anyway.
BLANK_INTERSTITIAL = (
    "<html><head><title>{0}</title></head><body>"
    '<div class="mets-page-navigation-next"><a href="/colorado/city-and-county-of-denver-general-'
    'services-purchasing/solicitations/closed-bids?pageNumber=3&selectedContent=BUYER">Next</a>'
    "</div></body></html>"
).format(DENVER_TITLE)

# One real row plus a next link that loops back to page 1's own URL.
LOOPING_PAGE = (
    "<html><head><title>{0}</title></head><body>"
    '<span class="simpleResultsNumResults">1 Closed Solicitations</span>'
    '<table><tr class="mets-table-row"><td><a href="/colorado/city-and-county-of-denver-general-'
    'services-purchasing/1112223?x">Loop bid</a></td>'
    '<td><span class="date-value">09/01/2026</span></td>'
    '<td><span class="date-value">09/20/2026</span></td></tr></table>'
    '<div class="mets-page-navigation-next"><a href="/colorado/city-and-county-of-denver-general-'
    'services-purchasing/solicitations/closed-bids?selectedContent=BUYER">Next</a></div>'
    "</body></html>"
).format(DENVER_TITLE)

# Sidecar finds a row; the reader finds none at all (a layout change the reader's regex missed).
NO_ROWS_FOR_THE_READER = "<html><head><title>{0}</title></head><body>No table rows here.</body></html>".format(
    DENVER_TITLE
)

# Same, but with its own (dangerous) next link -- proving an unreadable page 2 never gets followed
# even while its sidecar rows are kept.
NO_ROWS_FOR_THE_READER_WITH_NEXT_LINK = (
    "<html><head><title>{0}</title></head><body>No table rows here."
    '<div class="mets-page-navigation-next"><a href="/colorado/city-and-county-of-denver-general-'
    'services-purchasing/solicitations/closed-bids?pageNumber=3&selectedContent=BUYER">Next</a></div>'
    "</body></html>"
).format(DENVER_TITLE)

# A layout break, not an empty list: the reader finds zero rows, but the page still prints a
# positive total and a (newly-visible) "no open bids" phrase -- round-2 finding #1's repro.
FALSE_EMPTY_WITH_POSITIVE_TOTAL = (
    "<html><head><title>{0}</title></head><body>"
    '<span class="simpleResultsNumResults">16 Open Solicitations</span>'
    "<p>There are no open bids at this time.</p>"
    "</body></html>"
).format(DENVER_TITLE)

# Same shape, but BidNet's own zero-total case: still a genuine verified-empty list.
FALSE_EMPTY_WITH_ZERO_TOTAL = (
    "<html><head><title>{0}</title></head><body>"
    '<span class="simpleResultsNumResults">0 Open Solicitations</span>'
    "<p>There are no open bids at this time.</p>"
    "</body></html>"
).format(DENVER_TITLE)


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


def _with_total(html, total):
    """Rewrite the page's own printed results-total to `total`.

    The real Denver fixtures each describe their own true single page ("6 Open Solicitations",
    "2,191 Closed Solicitations"...); a synthetic two-page walk built by reusing two of them is
    not a real list and its fixtures' real totals do not agree with each other or with the walk's
    actual unique-row count. Tests that need a `complete: True` two-page walk rewrite both served
    pages to consistently report the walk's real unique count instead.
    """
    return re.sub(r'(class="simpleResultsNumResults">\s*)[\d,]+', r"\g<1>{0}".format(total), html, count=1)


def _closed_two_pages(total=None):
    # Page 2 is the saved open page: it has no next link, so it is the last page.
    closed_html = CLOSED if total is None else _with_total(CLOSED, total)
    open_html = OPEN if total is None else _with_total(OPEN, total)
    return PagedFetcher({DENVER + "/solicitations/closed-bids?selectedContent=BUYER": closed_html, PAGE_TWO: open_html})


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
    fetcher = _closed_two_pages(total=31)

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


def test_limit_stops_the_walk_early_and_reports_where_to_resume():
    fetcher = _closed_two_pages()

    bids, _stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _adapter_config(), _request(), limit=10
    )

    assert len(fetcher.urls) == 1
    assert len(bids) == 10
    assert (pagination["stopped_reason"], pagination["next_page"], pagination["complete"]) == ("limit", 2, False)


def test_scrapling_rows_get_the_reader_number_and_lifecycle():
    bids, stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages(total=31).adapter(), _scrapling_config(), _request(), extractor=Extractor(_sidecar_items)
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


def test_a_sidecar_only_row_on_a_closed_walk_is_stored_closed_and_incomplete():
    extra = {
        "title": "Ghost row", "url": "https://www.bidnetdirect.com/colorado/9999999?x",
        "published_date": None, "deadline_date": "10/01/2026", "source_bid_id": "9999999", "issuer_name": None,
    }
    extractor = Extractor(lambda html: _sidecar_items(html) + [extra])

    bids, _stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages(total=31).adapter(), _scrapling_config(), _request(), extractor=extractor
    )

    ghost = next(bid for bid in bids if bid["source_bid_id"] == "9999999")
    assert (ghost["lifecycle_status"], ghost["raw_payload"]["list_kind"]) == ("closed", "closed")
    assert ghost["deadline_date"] == "10/01/2026"  # not an awarded list: the sidecar's own date stands
    assert pagination["complete"] is False


def test_a_sidecar_only_row_on_an_awarded_walk_gets_the_award_date_not_a_deadline():
    extra = {
        "title": "Ghost award", "url": "https://www.bidnetdirect.com/colorado/8888888?x",
        "published_date": None, "deadline_date": "07/09/2026", "source_bid_id": "8888888", "issuer_name": None,
    }
    fetcher = PagedFetcher({DENVER + "/solicitations/awarded-bids?selectedContent=BUYER": OPEN})
    extractor = Extractor(lambda html: _sidecar_items(html) + [extra])

    bids, _stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _scrapling_config(), _request(list_kind="awarded"), extractor=extractor
    )

    ghost = next(bid for bid in bids if bid["source_bid_id"] == "8888888")
    assert (ghost["lifecycle_status"], ghost["raw_payload"]["list_kind"]) == ("awarded", "awarded")
    assert (ghost["awarded_date"], ghost["deadline_date"]) == ("07/09/2026", None)
    assert pagination["complete"] is False


def test_sidecar_failure_falls_back_to_the_reader_rows_per_page():
    bids, stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages(total=31).adapter(), _scrapling_config(), _request(),
        extractor=Extractor(error=ListExtractionError("extractor request failed: refused")),
    )
    assert stats["method"] == "adapter_fallback"
    assert stats["fallback_reason"].startswith("extractor_unreachable")
    assert len(bids) == 31 and pagination["complete"] is True


def test_reader_finds_nothing_but_the_sidecar_does_keeps_the_sidecar_rows_and_stops():
    # Scrapling is the main list-extraction path (CLAUDE.md): a row the reader could not
    # corroborate is still kept, not thrown away -- it just cannot make the walk "complete", and
    # the walk still stops here rather than trust a page it could not itself read.
    fetcher = PagedFetcher({DENVER + "/solicitations/closed-bids?selectedContent=BUYER": NO_ROWS_FOR_THE_READER})
    extractor = Extractor(lambda html: [{
        "title": "Ghost row", "url": "https://www.bidnetdirect.com/colorado/9999999?x",
        "published_date": None, "deadline_date": None, "source_bid_id": "9999999", "issuer_name": None,
    }])

    bids, _stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _scrapling_config(), _request(), extractor=extractor
    )

    assert len(bids) == 1
    ghost = bids[0]
    assert ghost["source_bid_id"] == "9999999"
    assert (ghost["lifecycle_status"], ghost["raw_payload"]["list_kind"]) == ("closed", "closed")
    assert pagination["stopped_reason"] == "unreadable_page"
    assert pagination["complete"] is False


def test_an_unreadable_page_two_keeps_its_sidecar_rows_but_never_follows_its_next_link():
    fetcher = PagedFetcher({
        DENVER + "/solicitations/closed-bids?selectedContent=BUYER": CLOSED,
        PAGE_TWO: NO_ROWS_FOR_THE_READER_WITH_NEXT_LINK,
    })

    def items_for(html):
        # Page 1's real rows for the real fixture; page 2 has none for this regex to find, so it
        # falls back to one ghost row standing in for "the sidecar still saw something here".
        found = _sidecar_items(html)
        return found if found else [{
            "title": "Ghost row", "url": "https://www.bidnetdirect.com/colorado/9999999?x",
            "published_date": None, "deadline_date": None, "source_bid_id": "9999999", "issuer_name": None,
        }]

    bids, _stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _scrapling_config(), _request(), extractor=Extractor(items_for)
    )

    assert fetcher.urls == [DENVER + "/solicitations/closed-bids?selectedContent=BUYER", PAGE_TWO]  # page 3 never fetched
    assert len(bids) == 26  # page 1's 25 real rows plus page 2's one uncorroborated sidecar row
    ghost = next(bid for bid in bids if bid["source_bid_id"] == "9999999")
    assert (ghost["lifecycle_status"], ghost["raw_payload"]["list_kind"]) == ("closed", "closed")
    assert pagination["stopped_reason"] == "unreadable_page"
    assert pagination["complete"] is False


def test_a_blank_page_mid_walk_stops_without_following_its_own_next_link():
    fetcher = PagedFetcher({
        DENVER + "/solicitations/closed-bids?selectedContent=BUYER": CLOSED,
        PAGE_TWO: BLANK_INTERSTITIAL,
    })

    bids, _stats, pagination = run_paginated_list_extraction(_source(), fetcher.adapter(), _adapter_config(), _request())

    assert fetcher.urls == [DENVER + "/solicitations/closed-bids?selectedContent=BUYER", PAGE_TWO]  # page 3 never fetched
    assert len(bids) == 25  # page 1's real rows are kept; the blank page contributes nothing
    assert pagination["stopped_reason"] == "unreadable_page"
    assert pagination["complete"] is False


def test_a_next_link_back_to_an_already_fetched_page_stops_the_walk():
    fetcher = PagedFetcher({DENVER + "/solicitations/closed-bids?selectedContent=BUYER": LOOPING_PAGE})

    bids, _stats, pagination = run_paginated_list_extraction(_source(), fetcher.adapter(), _adapter_config(), _request())

    assert fetcher.urls == [DENVER + "/solicitations/closed-bids?selectedContent=BUYER"]  # not fetched twice
    assert len(bids) == 1  # no duplicate of the one real row
    assert pagination["stopped_reason"] == "repeated_page"
    assert pagination["complete"] is False


def test_starting_past_page_one_is_never_complete():
    fetcher = _closed_two_pages()

    _bids, _stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _adapter_config(), _request(start_page=2)
    )

    # Page 2's URL happens to be the saved "open" fixture: a real, self-contained single page,
    # so every other completeness check would pass -- only the start_page gate must catch this.
    assert pagination == {
        "list_kind": "closed", "start_page": 2, "pages_fetched": 1, "next_page": None,
        "stopped_reason": "exhausted", "requests_made": 1, "complete": False,
    }


def test_a_total_that_does_not_match_the_rows_collected_is_incomplete():
    fetcher = PagedFetcher({
        DENVER + "/solicitations/closed-bids?selectedContent=BUYER": _with_total(CLOSED, 40),
        PAGE_TWO: _with_total(OPEN, 40),
    })

    bids, _stats, pagination = run_paginated_list_extraction(_source(), fetcher.adapter(), _adapter_config(), _request())

    assert len(bids) == 31
    assert pagination["stopped_reason"] == "exhausted"
    assert pagination["complete"] is False


def test_a_title_that_does_not_name_the_tenant_is_incomplete():
    # Every other completeness signal is made to agree (consistent 31 total, full coverage) so
    # only the tenant-title mismatch is left to explain `complete: False`.
    fetcher = PagedFetcher({
        DENVER + "/solicitations/closed-bids?selectedContent=BUYER": _with_total(CLOSED, 31),
        PAGE_TWO: _with_total(OPEN, 31),
    })
    mismatched_source = _source("Erie County, NY (BidNet)", DENVER + "/solicitations/open-bids")

    _bids, _stats, pagination = run_paginated_list_extraction(
        mismatched_source, fetcher.adapter(), _adapter_config(), _request()
    )

    assert pagination["stopped_reason"] == "exhausted"
    assert pagination["complete"] is False


def _with_title(html, tenant_name):
    return re.sub(
        r"<title>.*?</title>",
        "<title>{0} - Bid Opportunities | BidNet Direct</title>".format(tenant_name),
        html,
        count=1,
        flags=re.S,
    )


def test_a_tenant_whose_own_name_carries_a_state_suffix_can_still_be_complete():
    # Discovery labels a tenant by its directory name, and some agencies' own BidNet name ends in
    # ", XX" (2026-09-21 directory: "Madison County, AL", "Town of Dover, NY", ...). Their page
    # title keeps that suffix, so the tenant check must accept the label with it — otherwise such
    # a tenant is never complete and its delisted bids never close.
    fetcher = PagedFetcher({
        DENVER + "/solicitations/closed-bids?selectedContent=BUYER": _with_title(_with_total(CLOSED, 31), "Madison County, AL"),
        PAGE_TWO: _with_title(_with_total(OPEN, 31), "Madison County, AL"),
    })
    suffixed_source = _source("Madison County, AL (BidNet)", DENVER + "/solicitations/open-bids")

    _bids, _stats, pagination = run_paginated_list_extraction(
        suffixed_source, fetcher.adapter(), _adapter_config(), _request()
    )

    assert pagination["stopped_reason"] == "exhausted"
    assert pagination["complete"] is True


def test_the_state_suffix_alone_never_confirms_a_different_tenant():
    # Accepting the suffixed form must not loosen the whole-string comparison: a page titled for
    # another agency in the same state still fails the tenant check.
    fetcher = PagedFetcher({
        DENVER + "/solicitations/closed-bids?selectedContent=BUYER": _with_title(_with_total(CLOSED, 31), "Morgan County, AL"),
        PAGE_TWO: _with_title(_with_total(OPEN, 31), "Morgan County, AL"),
    })
    suffixed_source = _source("Madison County, AL (BidNet)", DENVER + "/solicitations/open-bids")

    _bids, _stats, pagination = run_paginated_list_extraction(
        suffixed_source, fetcher.adapter(), _adapter_config(), _request()
    )

    assert pagination["complete"] is False


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


def test_a_positive_total_on_a_verified_empty_looking_page_is_never_trusted_as_empty():
    # BidNet never prints a total on a genuinely empty list (Erie's own empty page has none at
    # all): a page that looks empty to both the reader and the empty-marker check, yet still
    # prints "16 Open Solicitations", is a layout break, not a verified empty tenant.
    fetcher = PagedFetcher({DENVER + "/solicitations/open-bids": FALSE_EMPTY_WITH_POSITIVE_TOTAL})

    with pytest.raises(ListPageReadError) as error:
        run_paginated_list_extraction(_source(), fetcher.adapter(), _adapter_config(), _request(list_kind="open"))

    assert "bidnet_co_denver" in str(error.value)
    assert "16" in str(error.value)


def test_a_zero_total_is_still_a_verified_empty_list():
    fetcher = PagedFetcher({DENVER + "/solicitations/open-bids": FALSE_EMPTY_WITH_ZERO_TOTAL})

    with pytest.raises(VerifiedEmptyListError) as error:
        run_paginated_list_extraction(_source(), fetcher.adapter(), _adapter_config(), _request(list_kind="open"))

    assert error.value.tenant_confirmed is True
    assert error.value.pagination["complete"] is True


def test_an_empty_page_confirming_the_wrong_tenant_is_incomplete():
    # Erie's own empty page genuinely satisfies `tenant_is_confirmed` against a Denver label (a
    # generic word match, per the 2026-09-24 review) -- the stricter title check must still catch it.
    fetcher = PagedFetcher({DENVER + "/solicitations/open-bids": ERIE})
    denver_source = _source("City and County of Denver General Services Purchasing (BidNet)", DENVER + "/solicitations/open-bids")

    with pytest.raises(VerifiedEmptyListError) as error:
        run_paginated_list_extraction(denver_source, fetcher.adapter(), _adapter_config(), _request(list_kind="open"))

    assert error.value.tenant_confirmed is True  # the weak check alone would have said "confirmed"
    assert error.value.pagination["complete"] is False


def test_an_empty_page_at_start_page_two_is_incomplete():
    label = "Erie County, NY (BidNet)"
    erie_base = "https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids"
    page_two_url = erie_base + "?pageNumber=2&selectedContent=BUYER"
    fetcher = PagedFetcher({page_two_url: ERIE})

    with pytest.raises(VerifiedEmptyListError) as error:
        run_paginated_list_extraction(
            _source(label, erie_base), fetcher.adapter(), _adapter_config(), _request(list_kind="open", start_page=2)
        )

    assert error.value.pagination["start_page"] == 2
    assert error.value.pagination["complete"] is False


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
