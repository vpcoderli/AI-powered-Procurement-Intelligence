"""Independent acceptance tests for NY Contract Reporter subcontracting cards (plan Task 2).

The HTML below is written here from the requirement text and the public markup shape of the live search page
(the element structure, classes and ``data-ad-id`` attribute of ``ny_ads_search_live_response.html``). It never
loads the implementers' fixture file. Expected values come from the plan and the requirements digest only.
"""

import json

from apsi_crawler.data_quality import core_issues
from apsi_crawler.sources.registry import get_source
from apsi_crawler.spiders.ny_contract_reporter import fetch_ny_contract_reporter_opportunities

MARKER = "This is a subcontracting opportunity"


class _FakeResponse:
    def __init__(self, text):
        self.status_code = 200
        self.text = text
        self.headers = {"Content-Type": "text/html; charset=utf-8"}

    def json(self):  # pragma: no cover - the spider must not need JSON for an HTML page
        raise ValueError("not json")


class _FakeSession:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append({"url": url, "params": params, "headers": headers, "timeout": timeout})
        return self.response

    def close(self):
        pass


def _row(label, value):
    return (
        '<div class="d-flex">'
        f'<div class="w-exact-8 px-2 flex-shrink-0 text-end bg-light fw-bold">{label}</div>'
        f'<div class="px-2">{value}</div>'
        "</div>"
    )


def _note_row(text):
    """The warning-note shape the live page uses for single-source notices."""
    return (
        '<div class="d-flex">'
        '<div class="d-flex align-items-center justify-content-end w-exact-8 px-2 flex-shrink-0 text-end bg-light fw-bold">Note:</div>'
        f'<div class="px-2 py-2 flex-fill"><div class="small alert alert-warning py-1 px-2 mb-0">{text}</div></div>'
        "</div>"
    )


def _card(ad_id, title, body_rows, standalone=None):
    standalone_html = f'<div class="px-2 small text-muted">{standalone}</div>' if standalone else ""
    return (
        f'<div class="opp-list-item d-flex gap-1 mb-3" data-ad-id="{ad_id}">'
        '<div class="flex-shrink-0 d-flex align-items-center bg-ny-secondary-alt text-white px-2"><h6 class="mb-0 d-none d-lg-block">01</h6></div>'
        '<div class="flex-fill min-w-0 border-lg-dark-subtle">'
        '<div class="d-flex">'
        '<div class="d-none d-lg-block w-exact-8 px-2 py-1 flex-shrink-0 bg-dark text-light text-end fs-5">Title:</div>'
        f'<div class="flex-fill min-w-0 px-2 py-1 bg-primary text-light fs-5 text-lg-truncate" title="Full Title: {title}">{title}</div>'
        "</div>"
        f"{standalone_html}"
        '<div class="d-block d-lg-flex justify-content-between gap-1"><div class="flex-fill pt-1 pt-lg-0">'
        + "".join(body_rows)
        + "</div>"
        '<div class="w-lg-25 flex-shrink-0 pt-1 p-lg-1 ps-0"><div class="d-flex flex-column h-100">'
        '<a class="ad-action-link d-flex justify-content-between gap-1 align-items-center px-2 py-2 mb-lg-1 bg-ny-secondary text-white text-decoration-none fw-bold lh-1" href="/Account/Login">'
        "<span>Log in or sign up to view this opportunity</span><i class=\"fa-solid fa-lg fa-chevron-right\"></i></a>"
        '<div class="bg-action-links-placeholder flex-fill" role="presentation"></div>'
        "</div></div></div></div></div>"
    )


# Card A: the marker is its own element; CR# and Company: are separate rows; "Due date:" is the deadline label.
CARD_SEPARATE_MARKER = _card(
    "2138281",
    "PIKE CS - NYS OGS Empire State Plaza Decarb Plan",
    [
        _row("CR#:", "2138281"),
        _row("Company:", "Pike Construction Services, Inc."),
        _row("Issue date:", "8/20/2026"),
        _row("Due date:", "9/8/2026"),
        _row("Category:", "Construction Vertical: Building Construction; Rehabilitation &amp; New Construction"),
    ],
    standalone=f"{MARKER}.",
)

# Card B: CR# and the company fold into ONE text node, and the marker is folded into the title with a "!!" tail.
CARD_FOLDED = _card(
    "2138289",
    f"CUNY Queens College - Razran Hall &amp; Science Laboratory Renovation {MARKER}!!",
    [
        _row("CR#:", "2138289 Company: E.W. Howell Co., LLC."),
        _row("Issue date:", "8/21/2026"),
        _row("Ad end date:", "9/12/2026"),
        _row("Category:", "Construction"),
    ],
)

# Card C: the CR# carries a fold AND a real Company: row exists; the real row must win.
CARD_FOLD_AND_REAL_COMPANY = _card(
    "2138290",
    "Bridge Deck Rehabilitation Subcontract",
    [
        _row("CR#:", "2138290 Company: Folded Name LLC"),
        _row("Company:", "Real Winner Corp."),
        _row("Issue date:", "8/22/2026"),
        _row("Ad end date:", "9/15/2026"),
    ],
    standalone=f"{MARKER} ! . ",
)

# Card D: both an Agency: and a Company: row.
CARD_AGENCY_AND_COMPANY = _card(
    "2138291",
    "Electrical Subcontract for Albany Campus",
    [
        _row("CR#:", "2138291"),
        _row("Agency:", "NYS Office of General Services"),
        _row("Company:", "Some Sub LLC"),
        _row("Issue date:", "8/23/2026"),
        _row("Ad end date:", "9/16/2026"),
    ],
    standalone=MARKER,
)

# Card E: an ordinary agency card, untouched by the new rules.
CARD_PLAIN = _card(
    "2138292",
    "ABB Supplies &amp; Repair of Parts",
    [
        _row("CR#:", "2138292"),
        _row("Agency:", "MTA - Metro-North Railroad"),
        _row("Division:", "Procurement and Material Management"),
        _row("Issue date:", "8/20/2026"),
        _row("Ad end date:", "9/10/2026"),
        _row("Category:", "Transportation, Bus, Rail, Marine &amp; Aviation"),
    ],
)

# Card F: the marker sits in the page's warning-note shape, with a "." tail.
CARD_NOTE_MARKER = _card(
    "2138293",
    "HVAC Subcontract - Rochester Psychiatric Center",
    [
        _note_row(f"{MARKER}."),
        _row("CR#:", "2138293"),
        _row("Company:", "Northeast Mechanical Partners"),
        _row("Issue date:", "8/24/2026"),
        _row("Ad end date:", "9/20/2026"),
    ],
)

PAGE = (
    "<html><body><div class=\"opportunity-list\">"
    + CARD_SEPARATE_MARKER
    + CARD_FOLDED
    + CARD_FOLD_AND_REAL_COMPANY
    + CARD_AGENCY_AND_COMPANY
    + CARD_PLAIN
    + CARD_NOTE_MARKER
    + "</div></body></html>"
)


def _fetch():
    session = _FakeSession(_FakeResponse(PAGE))
    bids = fetch_ny_contract_reporter_opportunities(
        get_source("ny_contract_reporter"),
        limit=10,
        session=session,
        timeout=10,
    )
    return {bid["dedupe_key"]: bid for bid in bids}


def _raw(bid):
    raw = bid["raw_payload"]
    if isinstance(raw, str):
        raw = json.loads(raw)
    return raw


def test_every_card_is_included_with_a_clean_id():
    bids = _fetch()
    assert sorted(bids) == [
        "ny_contract_reporter:2138281",
        "ny_contract_reporter:2138289",
        "ny_contract_reporter:2138290",
        "ny_contract_reporter:2138291",
        "ny_contract_reporter:2138292",
        "ny_contract_reporter:2138293",
    ]
    for key, bid in bids.items():
        assert bid["id"] == key
        assert bid["dedupe_key"] == key
        assert "Company:" not in bid["id"]
        assert "Company:" not in bid["source_bid_id"]
        assert bid["source_url"].endswith("/Ads/Details/" + bid["source_bid_id"])
        assert MARKER.lower() not in bid["title"].lower()
        assert "invalid_issuer" not in core_issues(bid)


def test_separate_marker_card_takes_the_contractor_from_company():
    bid = _fetch()["ny_contract_reporter:2138281"]
    assert bid["source_bid_id"] == "2138281"
    assert bid["title"] == "PIKE CS - NYS OGS Empire State Plaza Decarb Plan"
    assert bid["issuer_name"] == "Pike Construction Services, Inc."
    assert bid["deadline_date"] == "9/8/2026"
    assert bid["published_date"] == "8/20/2026"
    assert bid["source_url"].endswith("/Ads/Details/2138281")
    raw = _raw(bid)
    assert raw["contractor_company"] == "Pike Construction Services, Inc."
    assert raw["subcontracting"] is True


def test_company_fold_in_cr_number_is_peeled_off_and_title_marker_tail_is_stripped():
    bid = _fetch()["ny_contract_reporter:2138289"]
    assert bid["id"] == "ny_contract_reporter:2138289"
    assert bid["source_bid_id"] == "2138289"
    assert bid["issuer_name"] == "E.W. Howell Co., LLC."
    assert bid["title"] == "CUNY Queens College - Razran Hall & Science Laboratory Renovation"
    assert bid["deadline_date"] == "9/12/2026"
    raw = _raw(bid)
    assert raw["contractor_company"] == "E.W. Howell Co., LLC."
    assert raw["subcontracting"] is True


def test_a_real_company_row_wins_over_the_folded_name():
    bid = _fetch()["ny_contract_reporter:2138290"]
    assert bid["source_bid_id"] == "2138290"
    assert bid["issuer_name"] == "Real Winner Corp."
    assert bid["title"] == "Bridge Deck Rehabilitation Subcontract"
    raw = _raw(bid)
    assert raw["contractor_company"] == "Real Winner Corp."
    assert raw["subcontracting"] is True


def test_agency_stays_the_issuer_when_both_agency_and_company_are_present():
    bid = _fetch()["ny_contract_reporter:2138291"]
    assert bid["issuer_name"] == "NYS Office of General Services"
    assert bid["title"] == "Electrical Subcontract for Albany Campus"
    raw = _raw(bid)
    assert raw["contractor_company"] == "Some Sub LLC"
    assert raw["subcontracting"] is True


def test_plain_agency_card_is_unchanged_apart_from_the_two_new_keys():
    bid = _fetch()["ny_contract_reporter:2138292"]
    assert bid["source_bid_id"] == "2138292"
    assert bid["title"] == "ABB Supplies & Repair of Parts"
    assert bid["issuer_name"] == "MTA - Metro-North Railroad"
    assert bid["issuer_type"] == "state"
    assert bid["state_code"] == "NY"
    assert bid["published_date"] == "8/20/2026"
    assert bid["deadline_date"] == "9/10/2026"
    assert bid["original_category"] == "Transportation, Bus, Rail, Marine & Aviation"
    raw = _raw(bid)
    assert raw["subcontracting"] is False
    assert raw["contractor_company"] is None


def test_marker_inside_the_warning_note_shape_is_stripped_and_flagged():
    bid = _fetch()["ny_contract_reporter:2138293"]
    assert bid["source_bid_id"] == "2138293"
    assert bid["title"] == "HVAC Subcontract - Rochester Psychiatric Center"
    assert bid["issuer_name"] == "Northeast Mechanical Partners"
    raw = _raw(bid)
    assert raw["subcontracting"] is True
    assert raw["contractor_company"] == "Northeast Mechanical Partners"
    # The marker sentence must not leak into any field value.
    assert all(MARKER.lower() not in str(value).lower() for value in bid.values() if isinstance(value, str))
