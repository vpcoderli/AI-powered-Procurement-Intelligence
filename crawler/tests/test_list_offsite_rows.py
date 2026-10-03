"""Off-site rows on a BidNet list page (2026-10-03).

The live trigger: three approved tenants failed every run with `Data too long for column 'id'`.
Their list page carries an agency announcement -- a link titled "How to use Bidnet Direct" that
points to an Outlook safelinks URL of ~500 characters. The Scrapling sidecar returns it as a list
row without a `source_bid_id`, so the URL itself became the bid id; the page's own reader reads no
row there, so the paged walk took its `unreadable_page` branch (which keeps sidecar rows) and the
bid reached the importer, where MySQL's VARCHAR(191) id rejected it and failed the whole run.

A sidecar row that the page's own reader never read AND that links to a different site than the
page is not a listing row. The walk discards it (`stats["discarded_offsite_rows"]` counts them),
before the empty-first-page check, the coverage comparison and the unique-count check.
"""

import io
import json
import re
from pathlib import Path

import pytest

from apsi_crawler import cli, list_extraction
from apsi_crawler.adapters import registry
from apsi_crawler.adapters.task import TaskSource
from apsi_crawler.errors import VerifiedEmptyListError
from apsi_crawler.list_extraction import (
    ListPageReadError,
    resolve_list_extraction_config,
    run_paginated_list_extraction,
)

FIXTURES = Path(__file__).parent / "fixtures"
OPEN = (FIXTURES / "bidnet_denver_open_bids_2026_09_24.html").read_text(encoding="utf-8")
CLOSED = (FIXTURES / "bidnet_denver_closed_bids_2026_09_24.html").read_text(encoding="utf-8")
ERIE = (FIXTURES / "bidnet_erie_no_open_bids.html").read_text(encoding="utf-8")

BIDNET = "https://www.bidnetdirect.com"
DENVER = BIDNET + "/colorado/city-and-county-of-denver-general-services-purchasing"
DENVER_LABEL = "City and County of Denver General Services Purchasing (BidNet)"
DENVER_TITLE = "City and County of Denver General Services Purchasing - Bid Opportunities | BidNet Direct"
PAGE_ONE = DENVER + "/solicitations/closed-bids?selectedContent=BUYER"
PAGE_TWO = DENVER + "/solicitations/closed-bids?pageNumber=2&selectedContent=BUYER"
ERIE_LABEL = "Erie County, NY (BidNet)"
ERIE_URL = BIDNET + "/new-york/erie-county/solicitations/open-bids"
ERIE_GROUP_ROOT = BIDNET + "/new-york/erie-county"  # BidNet serves one tenant at /<group>/<slug>/...
ERIE_ALIAS_ROOT = BIDNET + "/erie-county"  # ... and at the root alias /<slug>/...

# A synthetic stand-in for the announcement link seen live: an Outlook safelinks URL. Real ones
# carry the recipient's address in `data=`; this one carries filler only. It is off the portal's
# site and, once it becomes a bid id ("<source>:<url>"), far past the 191-character id column.
SAFELINKS_URL = (
    "https://synthetic01.safelinks.protection.outlook.com/?url="
    "https%3A%2F%2Fexample.invalid%2Fhow-to-use-bidnet-direct%2Fannouncement%3Fsource%3Dsynthetic"
    "&data=" + "SYNTHETICDATA" * 24 + "&sdata=" + "SYNTHETICSIG" * 8 + "&reserved=0"
)

# Reader finds no row at all; the page is not an empty list either (no "no open bids" copy).
NO_ROWS_FOR_THE_READER = "<html><head><title>{0}</title></head><body>No table rows here.</body></html>".format(
    DENVER_TITLE
)

# A layout break, not an empty list: no rows for the reader, but a positive printed total next to
# a (newly visible) "no open bids" phrase.
FALSE_EMPTY_WITH_POSITIVE_TOTAL = (
    "<html><head><title>{0}</title></head><body>"
    '<span class="simpleResultsNumResults">16 Open Solicitations</span>'
    "<p>There are no open bids at this time.</p>"
    "</body></html>"
).format(DENVER_TITLE)


def _source(label=DENVER_LABEL, base_url=DENVER + "/solicitations/open-bids", source_id="bidnet_co_denver"):
    return TaskSource(
        id=source_id, name=label, source_label=label, jurisdiction="county",
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
    """Rewrite the page's own printed results-total (the real fixtures each describe their own page)."""
    return re.sub(r'(class="simpleResultsNumResults">\s*)[\d,]+', r"\g<1>{0}".format(total), html, count=1)


def _closed_two_pages(total):
    """A consistent two-page closed walk of 31 unique rows (25 + 6) whose printed total is `total`."""
    return PagedFetcher({PAGE_ONE: _with_total(CLOSED, total), PAGE_TWO: _with_total(OPEN, total)})


def _scrapling_config():
    return resolve_list_extraction_config({}, "http://extractor.test", True)


def _adapter_config():
    return resolve_list_extraction_config({}, "", True)


def _request(**overrides):
    request = {"list_kind": "closed", "start_page": 1, "max_pages": 4, "stop_before": None}
    request.update(overrides)
    return request


class Extractor:
    def __init__(self, items_for):
        self.items_for = items_for

    def extract_list(self, html, url, item_selector=None, selectors=None, max_items=200, timeout=None):
        return {"items": self.items_for(html), "diagnostics": {"title": "heuristic"}, "empty_state": {"detected": False, "marker": None}}


def _sidecar_items(html):
    items = []
    for match in re.finditer(r'href="([^"]*/(\d{7,})\?[^"]*)"[^>]*>(.*?)</a>', html, re.S):
        items.append({"title": re.sub(r"<[^>]+>", "", match.group(3)).strip(), "url": BIDNET + match.group(1).replace("&amp;", "&"),
                      "published_date": None, "deadline_date": None, "source_bid_id": match.group(2), "issuer_name": None})
    return items


def _offsite_item(url=SAFELINKS_URL):
    """What the sidecar returned for the announcement link: no `source_bid_id`, the URL is the only id."""
    return {"title": "How to use Bidnet Direct", "url": url, "published_date": None, "deadline_date": None,
            "source_bid_id": None, "issuer_name": None}


def _ghost_item(url="https://www.bidnetdirect.com/colorado/9999999?x"):
    """A sidecar-only row (the reader never read it) on the portal's own site."""
    return {"title": "Ghost row", "url": url, "published_date": None, "deadline_date": None,
            "source_bid_id": "9999999", "issuer_name": None}


def _tab_items(root):
    """BidNet's own list tabs as the sidecar returned them live (2026-10-03, bay-county1 and
    city-of-taylor1): no `source_bid_id`, so each tab's URL is its only identity."""
    return [
        {"title": "{0} Solicitations".format(label), "url": "{0}/solicitations/{1}-bids?selectedContent=BUYER".format(root, kind),
         "published_date": None, "deadline_date": None, "source_bid_id": None, "issuer_name": None}
        for kind, label in (("open", "Open"), ("closed", "Closed"), ("awarded", "Awarded"))
    ]


def _real_rows_plus_offsite_on(page_html):
    """Every real row of every page, plus the announcement link on the one page whose HTML is `page_html`."""
    return lambda html: _sidecar_items(html) + ([_offsite_item()] if html == page_html else [])


# --- the live failure: an empty tenant page -------------------------------------------------


def test_an_off_site_link_on_an_empty_tenant_page_leaves_a_verified_empty_list():
    # The Erie-shaped page has no listing row and says "no open bids"; the only thing the sidecar
    # returns is the announcement link. Before the fix that link survived as the page's only row.
    assert len(SAFELINKS_URL) > 191
    fetcher = PagedFetcher({ERIE_URL: ERIE})

    with pytest.raises(VerifiedEmptyListError) as error:
        run_paginated_list_extraction(
            _source(ERIE_LABEL, ERIE_URL, "bidnet_ny_erie"), fetcher.adapter(), _scrapling_config(),
            _request(list_kind="open"), extractor=Extractor(lambda html: [_offsite_item()]),
        )

    assert error.value.tenant_confirmed is True
    assert error.value.method == "scrapling"
    assert error.value.pagination["complete"] is True
    assert error.value.discarded_offsite_rows == 1


def test_a_positive_printed_total_still_stops_an_off_site_only_page_from_being_called_empty():
    # Discarding cannot turn a page that prints "16 Open Solicitations" into an empty list: the
    # empty-first-page rule refuses a positive total outright, so a real row hidden behind an
    # off-site link would fail the run loudly instead of delisting the whole source.
    fetcher = PagedFetcher({DENVER + "/solicitations/open-bids": FALSE_EMPTY_WITH_POSITIVE_TOTAL})

    with pytest.raises(ListPageReadError) as error:
        run_paginated_list_extraction(
            _source(), fetcher.adapter(), _scrapling_config(), _request(list_kind="open"),
            extractor=Extractor(lambda html: [_offsite_item()]),
        )

    assert "16" in str(error.value)


def test_verified_empty_error_carries_the_discard_counts_outside_its_metadata():
    default = VerifiedEmptyListError("There are no open bids at this time.", True)
    counted = VerifiedEmptyListError(
        "There are no open bids at this time.", True, discarded_offsite_rows=2, discarded_navigation_rows=3
    )

    assert (default.discarded_offsite_rows, default.discarded_navigation_rows) == (0, 0)
    assert (counted.discarded_offsite_rows, counted.discarded_navigation_rows) == (2, 3)
    assert default.as_metadata() == counted.as_metadata() == {
        "verified": True, "marker": "There are no open bids at this time.", "tenant_confirmed": True, "method": "adapter",
    }


# --- a tenant that also lists real bids -----------------------------------------------------


def test_an_off_site_row_beside_real_rows_is_discarded_and_the_walk_stays_complete():
    fetcher = _closed_two_pages(total=31)

    bids, stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _scrapling_config(), _request(),
        extractor=Extractor(_real_rows_plus_offsite_on(fetcher.pages[PAGE_ONE])),
    )

    assert len(bids) == 31
    assert SAFELINKS_URL not in [bid["source_bid_id"] for bid in bids]
    assert all("safelinks" not in bid["source_url"] for bid in bids)
    assert all(len(bid["id"]) <= 191 for bid in bids)
    assert stats["discarded_offsite_rows"] == 1
    assert stats["method"] == "scrapling"  # the page still had sidecar rows: no fallback to the reader
    assert stats["fallback_reason"] is None
    assert pagination["complete"] is True


def test_discarded_rows_are_counted_over_the_whole_walk():
    fetcher = _closed_two_pages(total=31)

    bids, stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _scrapling_config(), _request(),
        extractor=Extractor(lambda html: _sidecar_items(html) + [_offsite_item()]),  # on both pages
    )

    assert len(bids) == 31
    assert stats["discarded_offsite_rows"] == 2
    assert pagination["complete"] is True


def test_a_walk_with_nothing_to_discard_reports_no_discard_key():
    # The key is absent, not zero, so every existing exact-dict assertion on these stats holds.
    bids, stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages(total=31).adapter(), _scrapling_config(), _request(),
        extractor=Extractor(_sidecar_items),
    )

    assert len(bids) == 31
    assert stats["method"] == "scrapling"  # the sidecar path ran, so "no key" is not just adapter mode
    assert "discarded_offsite_rows" not in stats
    assert pagination["complete"] is True


def test_a_discarded_row_the_printed_total_still_counts_keeps_the_walk_incomplete():
    # If the off-site row WERE a real listing row the reader missed, page 1's printed total would
    # count it: 32 printed against 31 collected rows must not read as a complete walk.
    fetcher = _closed_two_pages(total=32)

    bids, stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _scrapling_config(), _request(),
        extractor=Extractor(_real_rows_plus_offsite_on(fetcher.pages[PAGE_ONE])),
    )

    assert len(bids) == 31
    assert stats["discarded_offsite_rows"] == 1
    assert pagination["stopped_reason"] == "exhausted"
    assert pagination["complete"] is False


def test_an_unreadable_page_keeps_its_on_site_sidecar_row_while_the_off_site_link_goes():
    # The reader reads nothing on this page, so the walk still stops at `unreadable_page` and still
    # keeps the sidecar row on the portal's own site -- only the link to another site goes.
    fetcher = PagedFetcher({PAGE_ONE: NO_ROWS_FOR_THE_READER})

    bids, stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _scrapling_config(), _request(),
        extractor=Extractor(lambda html: [_ghost_item(), _offsite_item()]),
    )

    assert [bid["source_bid_id"] for bid in bids] == ["9999999"]
    assert stats["discarded_offsite_rows"] == 1
    assert pagination["stopped_reason"] == "unreadable_page"
    assert pagination["complete"] is False


# --- the discard empties a page the reader did read ----------------------------------------


def test_a_page_the_discard_leaves_empty_falls_back_to_the_rows_the_reader_read():
    # Page 1's sidecar returns nothing but the announcement link, yet the reader read all 25 rows
    # there. Discarding the link must not cost the page its rows: it falls back to the reader's, as
    # it does when the sidecar returns nothing usable at all.
    fetcher = _closed_two_pages(total=31)
    page_one = fetcher.pages[PAGE_ONE]

    def items_for(html):
        return [_offsite_item()] if html == page_one else _sidecar_items(html)

    bids, stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _scrapling_config(), _request(), extractor=Extractor(items_for)
    )

    adapter_bids, _stats, _pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages(total=31).adapter(), _adapter_config(), _request()
    )
    assert [bid["source_bid_id"] for bid in bids] == [bid["source_bid_id"] for bid in adapter_bids]
    assert len(bids) == 31
    assert SAFELINKS_URL not in [bid["source_bid_id"] for bid in bids]
    first = next(bid for bid in bids if bid["source_bid_id"] == "0000436158")  # a page-1 row, from the reader
    assert (first["solicitation_number"], first["lifecycle_status"]) == ("0147A_2026", "closed")
    assert stats["method"] == "adapter_fallback"
    assert "off-site" in stats["fallback_reason"]
    assert stats["discarded_offsite_rows"] == 1  # the discarded link still counts
    assert pagination["complete"] is True  # the same rules as any adapter-fallback page


def test_a_page_the_reader_read_nothing_on_has_no_rows_to_fall_back_to():
    # Page 2 is one the reader cannot read, and the sidecar returns only the announcement link
    # there: nothing to fall back to, so the page contributes nothing and the walk stops as before.
    fetcher = PagedFetcher({PAGE_ONE: _with_total(CLOSED, 25), PAGE_TWO: NO_ROWS_FOR_THE_READER})

    def items_for(html):
        return [_offsite_item()] if html == NO_ROWS_FOR_THE_READER else _sidecar_items(html)

    bids, stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _scrapling_config(), _request(), extractor=Extractor(items_for)
    )

    assert len(bids) == 25
    assert stats["method"] == "scrapling"
    assert stats["fallback_reason"] is None
    assert stats["discarded_offsite_rows"] == 1
    assert pagination["stopped_reason"] == "unreadable_page"
    assert pagination["complete"] is False


# --- the tenant's own list tabs --------------------------------------------------------------
#
# On a tenant whose slug carries a digit the sidecar's detail-link test accepts BidNet's own
# "Open / Closed / Awarded Solicitations" tabs as rows. They are on the portal's site, so the
# off-site rule keeps them; the reader reads no row there, so they used to be stored as `open`
# bids that no walk can ever delist.


def _run_erie(base_root, items):
    """The Erie empty page, stored at `base_root`, with a sidecar that returns `items`."""
    base_url = base_root + "/solicitations/open-bids"
    return run_paginated_list_extraction(
        _source(ERIE_LABEL, base_url, "bidnet_ny_erie"), PagedFetcher({base_url: ERIE}).adapter(),
        _scrapling_config(), _request(list_kind="open"), extractor=Extractor(lambda html: items),
    )


def test_the_tenants_own_list_tabs_on_an_empty_page_leave_a_verified_empty_list():
    with pytest.raises(VerifiedEmptyListError) as error:
        _run_erie(ERIE_GROUP_ROOT, _tab_items(ERIE_GROUP_ROOT))

    assert error.value.tenant_confirmed is True
    assert error.value.method == "scrapling"
    assert error.value.pagination["complete"] is True
    assert error.value.discarded_navigation_rows == 3
    assert error.value.discarded_offsite_rows == 0


@pytest.mark.parametrize(
    ("base_root", "tab_root"),
    [
        (ERIE_GROUP_ROOT, ERIE_ALIAS_ROOT),  # stored in the group form, tabs in the root-alias form
        (ERIE_ALIAS_ROOT, ERIE_GROUP_ROOT),  # stored in the root-alias form, tabs in the group form
        (ERIE_ALIAS_ROOT, ERIE_ALIAS_ROOT),
    ],
)
def test_the_tabs_are_discarded_in_either_url_form_of_the_tenant(base_root, tab_root):
    with pytest.raises(VerifiedEmptyListError) as error:
        _run_erie(base_root, _tab_items(tab_root))

    assert error.value.discarded_navigation_rows == 3
    assert error.value.pagination["complete"] is True


def test_the_two_kinds_of_discarded_row_are_counted_separately():
    with pytest.raises(VerifiedEmptyListError) as error:
        _run_erie(ERIE_GROUP_ROOT, [_offsite_item()] + _tab_items(ERIE_GROUP_ROOT))

    assert error.value.discarded_offsite_rows == 1
    assert error.value.discarded_navigation_rows == 3


def test_a_row_that_is_both_off_site_and_a_list_path_counts_as_off_site():
    elsewhere = "https://synthetic03.example.invalid/new-york/erie-county/solicitations/open-bids?selectedContent=BUYER"

    with pytest.raises(VerifiedEmptyListError) as error:
        _run_erie(ERIE_GROUP_ROOT, [_offsite_item(elsewhere)])

    assert error.value.discarded_offsite_rows == 1
    assert error.value.discarded_navigation_rows == 0


def test_another_tenants_list_tab_is_not_this_sources_own_list_page():
    # Only the source's own list pages are navigation. A list link of some other tenant stays
    # exactly what it was: a sidecar-only row on the portal's site that the reader never read.
    bids, stats, pagination = _run_erie(ERIE_GROUP_ROOT, _tab_items(BIDNET + "/new-york/monroe-county")[:1])

    assert len(bids) == 1
    assert "discarded_navigation_rows" not in stats
    assert pagination["stopped_reason"] == "unreadable_page"
    assert pagination["complete"] is False


def test_tabs_beside_real_rows_are_discarded_and_the_walk_stays_complete():
    fetcher = _closed_two_pages(total=31)
    page_one = fetcher.pages[PAGE_ONE]

    def items_for(html):
        return _sidecar_items(html) + (_tab_items(DENVER) if html == page_one else [])

    bids, stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _scrapling_config(), _request(), extractor=Extractor(items_for)
    )

    assert len(bids) == 31
    assert not [bid for bid in bids if "-bids?selectedContent=BUYER" in bid["source_bid_id"]]
    assert all(len(bid["id"]) <= 191 for bid in bids)
    assert stats["discarded_navigation_rows"] == 3
    assert "discarded_offsite_rows" not in stats
    assert stats["method"] == "scrapling"
    assert pagination["complete"] is True


def test_a_page_whose_sidecar_rows_are_all_tabs_falls_back_to_the_rows_the_reader_read():
    fetcher = _closed_two_pages(total=31)
    page_one = fetcher.pages[PAGE_ONE]

    def items_for(html):
        return _tab_items(DENVER) if html == page_one else _sidecar_items(html)

    bids, stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _scrapling_config(), _request(), extractor=Extractor(items_for)
    )

    adapter_bids, _stats, _pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages(total=31).adapter(), _adapter_config(), _request()
    )
    assert [bid["source_bid_id"] for bid in bids] == [bid["source_bid_id"] for bid in adapter_bids]
    assert stats["method"] == "adapter_fallback"
    assert stats["fallback_reason"] == "no_items: extractor returned only off-site or navigation rows"
    assert stats["discarded_navigation_rows"] == 3
    assert pagination["complete"] is True


# --- rows that must be kept -----------------------------------------------------------------


def test_a_row_the_reader_read_is_kept_wherever_it_links():
    elsewhere = "https://synthetic02.example.invalid/detail/0000436158"

    def items_for(html):
        return [
            dict(item, url=elsewhere) if item["source_bid_id"] == "0000436158" else item
            for item in _sidecar_items(html)
        ]

    bids, stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages(total=31).adapter(), _scrapling_config(), _request(), extractor=Extractor(items_for)
    )

    kept = next(bid for bid in bids if bid["source_bid_id"] == "0000436158")
    assert kept["source_url"] == elsewhere  # the sidecar's own URL stands; the reader only corroborates the id
    assert len(bids) == 31
    assert "discarded_offsite_rows" not in stats
    assert pagination["complete"] is True


def test_a_sidecar_only_row_on_the_portals_own_site_is_kept_even_without_www_and_blocks_complete():
    # `bidnetdirect.com` and `www.bidnetdirect.com` are one site: a sidecar-only row there is today's
    # "uncorroborated" row, kept, and (as today) it keeps the walk from being complete.
    ghost = _ghost_item("https://bidnetdirect.com/colorado/9999999?x")

    bids, stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages(total=31).adapter(), _scrapling_config(), _request(),
        extractor=Extractor(lambda html: _sidecar_items(html) + [ghost]),
    )

    assert "9999999" in [bid["source_bid_id"] for bid in bids]
    assert "discarded_offsite_rows" not in stats
    assert pagination["complete"] is False


def test_a_row_the_reader_read_is_kept_even_when_its_url_is_a_list_page():
    closed_tab = DENVER + "/solicitations/closed-bids?selectedContent=BUYER"

    def items_for(html):
        return [
            dict(item, url=closed_tab) if item["source_bid_id"] == "0000436158" else item
            for item in _sidecar_items(html)
        ]

    bids, stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages(total=31).adapter(), _scrapling_config(), _request(), extractor=Extractor(items_for)
    )

    kept = next(bid for bid in bids if bid["source_bid_id"] == "0000436158")
    assert kept["source_url"] == closed_tab
    assert len(bids) == 31
    assert "discarded_navigation_rows" not in stats
    assert pagination["complete"] is True


def test_a_detail_link_below_a_list_path_is_not_a_list_page_and_keeps_the_walk_incomplete():
    detail = _ghost_item(DENVER + "/solicitations/open-bids/Road-Repair-Services/9999999?purchasingGroupId=1")

    bids, stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages(total=31).adapter(), _scrapling_config(), _request(),
        extractor=Extractor(lambda html: _sidecar_items(html) + [detail]),
    )

    assert "9999999" in [bid["source_bid_id"] for bid in bids]  # kept, as every sidecar-only row on the site is
    assert "discarded_navigation_rows" not in stats
    assert pagination["complete"] is False


# --- the host comparison --------------------------------------------------------------------

PAGE = BIDNET + "/colorado/city-of-aurora/solicitations/open-bids"


@pytest.mark.parametrize(
    "url",
    [
        BIDNET + "/colorado/city-of-aurora/123",                 # equal hosts
        "https://bidnetdirect.com/colorado/city-of-aurora/123",   # `www.` only on the page
        "https://WWW.BidNetDirect.com/colorado/city-of-aurora/123",  # case never matters
        "https://app.bidnetdirect.com/x",                         # a subdomain of the page's site
        "https://a.b.bidnetdirect.com/x",                         # a deeper subdomain
        "/colorado/city-of-aurora/123",                           # relative: no host to compare
        "",                                                       # empty
        None,                                                     # missing
        "https://[unterminated/x",                                # unparseable
        "mailto:buyer@example.invalid",                           # no host
    ],
)
def test_links_on_the_pages_own_site_or_without_a_host_are_never_off_site(url):
    assert list_extraction._links_off_site(url, PAGE) is False


@pytest.mark.parametrize(
    "url",
    [
        SAFELINKS_URL,
        "https://example.invalid/announcement",
        "https://notbidnetdirect.com/x",               # shares a suffix, not a subdomain boundary
        "https://bidnetdirect.com.example.invalid/x",  # starts like the portal, belongs to someone else
        "https://other.example.invalid/x",
    ],
)
def test_links_to_a_different_site_are_off_site(url):
    assert list_extraction._links_off_site(url, PAGE) is True


def test_a_www_prefix_on_the_row_alone_is_ignored():
    # `www.bidnetdirect.com` and `app.bidnetdirect.com` are siblings: neither is a subdomain of the
    # other, so they are one site only because the ROW's own `www.` is stripped before comparing.
    assert list_extraction._links_off_site(BIDNET + "/x", "https://app.bidnetdirect.com/page") is False
    assert list_extraction._links_off_site("https://www.example.invalid/x", "https://app.bidnetdirect.com/page") is True


def test_a_www_prefix_on_the_page_alone_is_ignored():
    # The mirror image: here only the PAGE's `www.` makes the two hosts siblings.
    assert list_extraction._links_off_site("https://app.bidnetdirect.com/x", BIDNET + "/page") is False
    assert list_extraction._links_off_site("https://example.invalid/x", BIDNET + "/page") is True


def test_the_subdomain_relation_holds_in_both_directions():
    assert list_extraction._links_off_site("https://bidnetdirect.com/x", "https://app.bidnetdirect.com/page") is False  # the page is the subdomain
    assert list_extraction._links_off_site("https://app.bidnetdirect.com/x", "https://bidnetdirect.com/page") is False  # the row is the subdomain
    assert list_extraction._links_off_site("https://example.invalid/x", "https://app.bidnetdirect.com/page") is True


def test_a_page_without_a_host_never_marks_anything_off_site():
    assert list_extraction._links_off_site(SAFELINKS_URL, "") is False
    assert list_extraction._links_off_site(SAFELINKS_URL, None) is False


# --- the list-path comparison ---------------------------------------------------------------

BAY_BASE = BIDNET + "/florida/bay-county1/solicitations/open-bids"
BAY_PATHS = {
    "/florida/bay-county1/solicitations/open-bids",
    "/florida/bay-county1/solicitations/closed-bids",
    "/florida/bay-county1/solicitations/awarded-bids",
}


def test_a_sources_own_list_paths_are_page_one_of_every_list_kind_and_the_fetched_page():
    source = _source("Bay County, FL (BidNet)", BAY_BASE, "bidnet_fl_bay")

    assert list_extraction._own_list_paths(source, registry.BIDNET_LIST_HTML_ADAPTER, BAY_BASE) == BAY_PATHS
    redirected = BIDNET + "/Florida/Bay-County1/Welcome/?x=1"
    assert list_extraction._own_list_paths(source, registry.BIDNET_LIST_HTML_ADAPTER, redirected) == BAY_PATHS | {
        "/florida/bay-county1/welcome"
    }


def test_a_list_kind_whose_page_url_raises_is_skipped():
    def page_url(source, list_kind, page):
        if list_kind == "awarded":
            raise ValueError("no such list")
        return registry.BIDNET_LIST_HTML_ADAPTER.page_url(source, list_kind, page)

    source = _source("Bay County, FL (BidNet)", BAY_BASE, "bidnet_fl_bay")
    adapter = registry.BIDNET_LIST_HTML_ADAPTER._replace(page_url=page_url)

    assert list_extraction._own_list_paths(source, adapter, BAY_BASE) == {
        "/florida/bay-county1/solicitations/open-bids",
        "/florida/bay-county1/solicitations/closed-bids",
    }


@pytest.mark.parametrize(
    "url",
    [
        BIDNET + "/florida/bay-county1/solicitations/open-bids?selectedContent=BUYER",    # the live shapes
        BIDNET + "/florida/bay-county1/solicitations/closed-bids?selectedContent=BUYER",
        BIDNET + "/florida/bay-county1/solicitations/awarded-bids?selectedContent=BUYER",
        "https://WWW.BidNetDirect.com/Florida/Bay-County1/Solicitations/CLOSED-BIDS",     # case never matters
        BIDNET + "/florida/bay-county1/solicitations/closed-bids/",                       # trailing slash
        BIDNET + "/florida/bay-county1/solicitations/closed-bids/?pageNumber=2#top",      # query and fragment
        BIDNET + "/bay-county1/solicitations/closed-bids?selectedContent=BUYER",          # the root alias: a tail of the group form
        "/florida/bay-county1/solicitations/closed-bids",                                 # root-relative
    ],
)
def test_links_to_the_sources_own_list_pages_are_navigation(url):
    assert list_extraction._links_to_list_page(url, BAY_PATHS) is True


def test_the_group_form_of_a_root_alias_list_path_is_navigation_too():
    alias_paths = {"/bay-county1/solicitations/open-bids"}

    assert list_extraction._links_to_list_page(BAY_BASE, alias_paths) is True


@pytest.mark.parametrize(
    "url",
    [
        BIDNET + "/florida/bay-county1/solicitations/open-bids/Road-Repair/0000123456?purchasingGroupId=1",  # a detail link
        BIDNET + "/florida/bay-county1/solicitations/Road-Repair/0000123456",
        BIDNET + "/florida/bay-county1",                                          # the tenant's home
        BIDNET + "/florida/other-county/solicitations/open-bids",                 # another tenant's list
        BIDNET + "/other-county/solicitations/open-bids",
        BIDNET + "/florida/bay-county1/solicitations/x-open-bids",                # `-open-bids` is not `/open-bids`
        BIDNET + "/florida/xbay-county1/solicitations/open-bids",                 # a tail that starts mid-segment
        BIDNET + "/",                                                             # no path at all
        BIDNET,
        "solicitations/open-bids",                                                # a relative path has no segment boundary to anchor on
        "",
        None,
        "https://[unterminated/x",
    ],
)
def test_other_links_are_not_navigation(url):
    assert list_extraction._links_to_list_page(url, BAY_PATHS) is False


def test_a_url_that_only_ends_like_a_list_path_is_not_navigation():
    # `/x-open-bids` ends in `open-bids` but not in `/open-bids`: a tail has to start at a `/`.
    assert list_extraction._links_to_list_page(BIDNET + "/x-open-bids", {"/open-bids"}) is False
    assert list_extraction._links_to_list_page(BIDNET + "/open-bids", {"/x-open-bids"}) is False
    assert list_extraction._links_to_list_page(BIDNET + "/a/open-bids", {"/open-bids"}) is True


def test_a_tail_matches_only_from_a_segment_boundary():
    same_path = list_extraction._same_path

    assert same_path("/a/open-bids", "/open-bids") is True
    assert same_path("/open-bids", "/a/open-bids") is True
    assert same_path("/open-bids", "/open-bids") is True
    assert same_path("/x-open-bids", "/open-bids") is False
    assert same_path("/open-bids", "/x-open-bids") is False
    assert same_path("/a/xopen-bids", "/open-bids") is False
    assert same_path("", "/open-bids") is False
    assert same_path("/open-bids", "") is False


def test_a_url_path_is_lower_case_without_trailing_slash_query_or_fragment():
    assert list_extraction._url_path("https://X.com/A/B/?q=1#f") == "/a/b"
    assert list_extraction._url_path("https://x.com/") == ""
    assert list_extraction._url_path("relative/path") == ""
    assert list_extraction._url_path(None) == ""


# --- fetch-task: what the run reports -------------------------------------------------------


def _run(payload, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    exit_code = cli.main(["fetch-task"])
    return exit_code, json.loads(capsys.readouterr().out)


def _stub_bidnet_list_html(monkeypatch, html):
    """Serve one BidNet list page to the list stage without touching the network."""
    from apsi_crawler.spiders import co_bidnet

    monkeypatch.setitem(
        registry.LIST_HTML_FETCHERS,
        "bidnet",
        registry.BIDNET_LIST_HTML_ADAPTER._replace(
            fetch_list_html=lambda source, url, session=None, timeout=30: (html, url, 200)
        ),
    )
    monkeypatch.setitem(
        registry.PLATFORM_ADAPTERS,
        "bidnet",
        lambda source, query=None, limit=25, **kwargs: co_bidnet.parse_bidnet_list_html(
            source, html, query=query, limit=limit
        ),
    )


def _stub_sidecar(monkeypatch, items_for):
    monkeypatch.setenv("SCRAPLING_EXTRACTOR_URL", "http://extractor.test")
    extractor = Extractor(items_for)
    monkeypatch.setattr(list_extraction, "ListExtractorClient", lambda base_url, session=None: extractor)


ERIE_TASK = {
    "task_id": "tsk_offsite_1",
    "source_id": "bidnet_ny_erie",
    "label": ERIE_LABEL,
    "state_code": "NY",
    "provider_family": "bidnet",
    "fetch_config": {"base_url": ERIE_URL},
    "limit": 25,
}
DENVER_TASK = {
    "task_id": "tsk_offsite_2",
    "source_id": "bidnet_co_denver",
    "label": DENVER_LABEL,
    "state_code": "CO",
    "provider_family": "bidnet",
    "fetch_config": {"base_url": DENVER + "/solicitations/open-bids"},
    "limit": None,
}


def test_fetch_task_reports_the_discard_on_a_verified_empty_page(monkeypatch, capsys):
    _stub_bidnet_list_html(monkeypatch, ERIE)
    _stub_sidecar(monkeypatch, lambda html: [_offsite_item()])

    exit_code, result = _run(ERIE_TASK, monkeypatch, capsys)

    assert exit_code == 0
    assert result["status"] == "success"
    assert result["bids"] == []
    assert result["metadata"]["emptyState"]["verified"] is True
    assert result["metadata"]["listExtraction"]["method"] == "scrapling"
    assert result["metadata"]["listExtraction"]["discarded_offsite_rows"] == 1
    assert result["metadata"]["pagination"]["complete"] is True


def test_fetch_task_reports_the_discard_beside_real_bids(monkeypatch, capsys):
    _stub_bidnet_list_html(monkeypatch, OPEN)
    _stub_sidecar(monkeypatch, lambda html: _sidecar_items(html) + [_offsite_item()])

    exit_code, result = _run(DENVER_TASK, monkeypatch, capsys)

    assert exit_code == 0
    assert result["status"] == "success"
    assert len(result["bids"]) == 6
    assert all(len(bid["id"]) <= 191 for bid in result["bids"])
    assert result["metadata"]["listExtraction"]["discarded_offsite_rows"] == 1
    assert result["metadata"]["pagination"]["complete"] is True


def test_fetch_task_falls_back_to_the_reader_rows_when_the_sidecar_returns_only_off_site_links(monkeypatch, capsys):
    _stub_bidnet_list_html(monkeypatch, OPEN)
    _stub_sidecar(monkeypatch, lambda html: [_offsite_item()])

    exit_code, result = _run(DENVER_TASK, monkeypatch, capsys)

    assert exit_code == 0
    assert result["status"] == "success"
    assert len(result["bids"]) == 6  # the six rows the reader read, not the one link the sidecar saw
    assert all(len(bid["id"]) <= 191 for bid in result["bids"])
    assert result["metadata"]["listExtraction"]["method"] == "adapter_fallback"
    assert "off-site" in result["metadata"]["listExtraction"]["fallback_reason"]
    assert result["metadata"]["listExtraction"]["discarded_offsite_rows"] == 1
    assert result["metadata"]["pagination"]["complete"] is True


def test_fetch_task_reports_the_tenants_own_list_tabs_it_discarded_on_a_verified_empty_page(monkeypatch, capsys):
    _stub_bidnet_list_html(monkeypatch, ERIE)
    _stub_sidecar(monkeypatch, lambda html: _tab_items(ERIE_GROUP_ROOT))

    exit_code, result = _run(ERIE_TASK, monkeypatch, capsys)

    assert exit_code == 0
    assert result["status"] == "success"
    assert result["bids"] == []
    assert result["metadata"]["emptyState"]["verified"] is True
    assert result["metadata"]["listExtraction"]["method"] == "scrapling"
    assert result["metadata"]["listExtraction"]["discarded_navigation_rows"] == 3
    assert "discarded_offsite_rows" not in result["metadata"]["listExtraction"]
    assert result["metadata"]["pagination"]["complete"] is True


def test_fetch_task_leaves_the_discard_keys_out_of_a_verified_empty_page_that_discarded_nothing(monkeypatch, capsys):
    monkeypatch.delenv("SCRAPLING_EXTRACTOR_URL", raising=False)
    _stub_bidnet_list_html(monkeypatch, ERIE)

    exit_code, result = _run(ERIE_TASK, monkeypatch, capsys)

    assert exit_code == 0
    assert result["metadata"]["emptyState"]["verified"] is True
    assert result["metadata"]["listExtraction"]["method"] == "adapter"
    assert "discarded_offsite_rows" not in result["metadata"]["listExtraction"]
    assert "discarded_navigation_rows" not in result["metadata"]["listExtraction"]
