"""BidNet list-page reader (spec 2026-09-24 §5.2) against pages captured on 2026-09-24."""

import re
from pathlib import Path

import pytest

from apsi_crawler.adapters.task import TaskSource
from apsi_crawler.spiders.co_bidnet import (
    BIDNET_DETAIL_ACCESS,
    bidnet_list_url,
    bidnet_next_page,
    parse_bidnet_list_html,
    read_bidnet_list_page,
)

FIXTURES = Path(__file__).parent / "fixtures"
OPEN = (FIXTURES / "bidnet_denver_open_bids_2026_09_24.html").read_text(encoding="utf-8")
CLOSED = (FIXTURES / "bidnet_denver_closed_bids_2026_09_24.html").read_text(encoding="utf-8")
AWARDED = (FIXTURES / "bidnet_denver_awarded_bids_2026_09_24.html").read_text(encoding="utf-8")
DENVER_URL = (
    "https://www.bidnetdirect.com/colorado/city-and-county-of-denver-general-services-purchasing"
    "/solicitations/open-bids"
)


def _denver():
    label = "City and County of Denver General Services Purchasing (BidNet)"
    return TaskSource(
        id="bidnet_co_denver",
        name=label,
        source_label=label,
        jurisdiction="county",
        state_code="CO",
        base_url=DENVER_URL,
        fetch_config={"base_url": DENVER_URL},
    )


def _without_next_link(html):
    """The last page keeps the next-page wrapper but empties it."""
    return re.sub(
        r"(mets-page-navigation-next[^>]*>).*?(</div>)", r"\1\2", html, count=1, flags=re.S
    )


def test_open_list_rows_carry_number_region_dates_and_the_members_only_marker():
    page = read_bidnet_list_page(_denver(), OPEN, "open")

    assert len(page.records) == 6
    first = page.records[0]
    assert first["source_bid_id"] == "0000437489"
    assert first["solicitation_number"] == "11205A"
    assert first["title"] == "Green Infrastructure Custom Stormwater Inlets, Covers & Associated Frames (DOTI"
    assert first["region"] == "Colorado"
    assert first["published_date"] == "09/22/2026"
    assert first["deadline_date"] == "10/13/2026"
    assert first["awarded_date"] is None
    assert first["lifecycle_status"] == "open"
    assert first["list_kind"] == "open"
    assert first["detail_access"] == BIDNET_DETAIL_ACCESS
    assert first["source_url"].startswith("https://www.bidnetdirect.com/colorado/solicitations/open-bids/")
    assert page.next_url is None and page.next_page is None


def test_closed_list_rows_are_closed_and_an_awarded_row_is_awarded():
    page = read_bidnet_list_page(_denver(), CLOSED, "closed")

    assert len(page.records) == 25
    first = page.records[0]
    assert (first["source_bid_id"], first["solicitation_number"]) == ("0000436158", "0147A_2026")
    assert first["lifecycle_status"] == "closed"
    assert first["deadline_date"] == "09/23/2026"
    awarded = next(record for record in page.records if record["source_bid_id"] == "0000419153")
    assert awarded["lifecycle_status"] == "awarded"
    assert awarded["deadline_date"] == "05/08/2026"
    assert awarded["awarded_date"] == "07/09/2026"


def test_closed_list_links_the_next_page():
    assert bidnet_next_page(CLOSED) == (
        "https://www.bidnetdirect.com/colorado/city-and-county-of-denver-general-services-purchasing"
        "/solicitations/closed-bids?pageNumber=2&selectedContent=BUYER",
        2,
    )


def test_the_last_page_has_no_next_page():
    assert bidnet_next_page(_without_next_link(CLOSED)) == (None, None)


def test_a_group_list_next_link_with_a_path_page_number_is_followed():
    html = (
        '<div class="mets-page-navigation-control mets-page-navigation-next">'
        ' <a data-page-size="25" href="/colorado/solicitations/open-bids/page2" class="next">'
        "<span>Next</span></a></div>"
    )
    assert bidnet_next_page(html) == ("https://www.bidnetdirect.com/colorado/solicitations/open-bids/page2", 2)


def test_awarded_list_rows_carry_the_award_date_not_a_deadline():
    page = read_bidnet_list_page(_denver(), AWARDED, "awarded")

    first = page.records[0]
    assert (first["source_bid_id"], first["solicitation_number"]) == ("0000404383", "11189")
    assert first["lifecycle_status"] == "awarded"
    assert first["awarded_date"] == "09/15/2026"
    assert first["deadline_date"] is None
    assert first["published_date"] == "11/17/2025"


def test_markup_without_dated_span_classes_keeps_the_positional_dates():
    html = (
        '<table><tr class="mets-table-row"><td><a href="/private/supplier/solicitations/4512345/detail">'
        'Street sweeping</a></td><td><span class="date-value">09/01/2026</span></td>'
        '<td><span class="date-value">09/30/2026</span></td></tr></table>'
    )
    open_record = read_bidnet_list_page(_denver(), html, "open").records[0]
    awarded_record = read_bidnet_list_page(_denver(), html, "awarded").records[0]

    assert (open_record["published_date"], open_record["deadline_date"]) == ("09/01/2026", "09/30/2026")
    assert open_record["solicitation_number"] is None
    assert (awarded_record["deadline_date"], awarded_record["awarded_date"]) == (None, "09/30/2026")


@pytest.mark.parametrize(
    ("kind", "page", "expected"),
    [
        ("open", 1, DENVER_URL),
        (
            "closed",
            1,
            "https://www.bidnetdirect.com/colorado/city-and-county-of-denver-general-services-purchasing"
            "/solicitations/closed-bids?selectedContent=BUYER",
        ),
        (
            "awarded",
            3,
            "https://www.bidnetdirect.com/colorado/city-and-county-of-denver-general-services-purchasing"
            "/solicitations/awarded-bids?pageNumber=3&selectedContent=BUYER",
        ),
    ],
)
def test_list_url_for_each_kind_and_page(kind, page, expected):
    assert bidnet_list_url(DENVER_URL, kind, page) == expected


def test_list_url_from_a_root_alias_tenant():
    assert bidnet_list_url(
        "https://www.bidnetdirect.com/city-of-aurora/solicitations/open-bids", "closed", 2
    ) == "https://www.bidnetdirect.com/city-of-aurora/solicitations/closed-bids?pageNumber=2&selectedContent=BUYER"


@pytest.mark.parametrize(("kind", "page"), [("pending", 1), ("open", 0)])
def test_list_url_rejects_unknown_kinds_and_pages(kind, page):
    with pytest.raises(ValueError):
        bidnet_list_url(DENVER_URL, kind, page)


def test_parse_keeps_the_selected_list_kind_in_the_raw_payload():
    bids = parse_bidnet_list_html(_denver(), CLOSED, limit=100, list_kind="closed")

    assert len(bids) == 25
    assert bids[0]["raw_payload"]["lifecycle_status"] == "closed"
    assert bids[0]["raw_payload"]["solicitation_number"] == "0147A_2026"
    assert bids[0]["raw_payload"]["detail_access"] == BIDNET_DETAIL_ACCESS
