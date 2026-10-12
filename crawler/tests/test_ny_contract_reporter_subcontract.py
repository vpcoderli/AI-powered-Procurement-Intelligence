"""NY Contract Reporter subcontracting cards.

A subcontracting card names the contractor ("Company:") instead of an agency and carries an
unlabelled sentence between its title and its CR#. The spider did not know that label, so the
company was folded into the CR# value (a malformed id) and the sentence into the title, and the
issuer fell back to "Unknown state agency", which the publication gate hides.

Everything goes through the public fetch entry point, the way test_state_live_sources.py does.
"""

from html import escape
from pathlib import Path

import pytest

from apsi_crawler.data_quality import core_issues
from apsi_crawler.sources.registry import get_source
from apsi_crawler.spiders.ny_contract_reporter import fetch_ny_contract_reporter_opportunities

FIXTURES_DIR = Path(__file__).parent / "fixtures"
SUBCONTRACT_FIXTURE = "ny_ads_search_subcontract.html"
LEGACY_FIXTURE = "ny_ads_search_live_response.html"

MARKER = "This is a subcontracting opportunity"
PIKE = "Pike Construction Services, Inc."
HOWELL = "E.W. Howell Co., LLC."
CONSTRUCTION_CATEGORY = "Construction Vertical: Building Construction; Rehabilitation & New Construction"

CLOCK_FIELDS = ("first_seen_at", "last_seen_at", "created_at", "updated_at")


class FakeResponse:
    status_code = 200
    headers = {"Content-Type": "text/html; charset=utf-8"}

    def __init__(self, text):
        self.text = text


class FakeSession:
    def __init__(self, response):
        self.response = response

    def get(self, url, params=None, headers=None, timeout=None):
        return self.response

    def close(self):
        pass


def fetch_html(html):
    return fetch_ny_contract_reporter_opportunities(
        get_source("ny_contract_reporter"),
        query="records",
        limit=5,
        session=FakeSession(FakeResponse(html)),
        timeout=10,
    )


def fetch_fixture(name):
    return fetch_html((FIXTURES_DIR / name).read_text(encoding="utf-8"))


def page(*cards):
    return "<html><body><div class='opportunity-list'>" + "".join(cards) + "</div></body></html>"


def card(ad_id, *texts):
    """One listing card; every text becomes its own element, which is its own parsed chunk."""
    rows = "".join(f"<div>{escape(text)}</div>" for text in texts)
    return f'<div class="opp-list-item" data-ad-id="{ad_id}">{rows}</div>'


def fetch_card(ad_id, *texts):
    bids = fetch_html(page(card(ad_id, *texts)))
    assert len(bids) == 1
    return bids[0]


def without_clock(bid):
    return {key: value for key, value in bid.items() if key not in CLOCK_FIELDS}


# --- the two subcontracting cards of the fixture ---------------------------------------------


def test_subcontracting_card_gets_a_clean_id_and_the_contractor_as_issuer():
    bid = fetch_fixture(SUBCONTRACT_FIXTURE)[0]

    assert bid["id"] == "ny_contract_reporter:2138281"
    assert bid["source_bid_id"] == "2138281"
    assert bid["dedupe_key"] == bid["id"]
    assert bid["title"] == "PIKE CS - NYS OGS Empire State Plaza Decarb Plan"
    assert bid["description"] == bid["title"]
    assert bid["issuer_name"] == PIKE
    assert bid["raw_payload"]["contractor_company"] == PIKE
    assert bid["raw_payload"]["subcontracting"] is True
    assert bid["published_date"] == "8/20/2026"
    assert bid["deadline_date"] == "9/8/2026"
    assert bid["original_category"] == CONSTRUCTION_CATEGORY
    assert bid["source_url"].endswith("/Ads/Details/2138281")


def test_cr_number_and_company_in_one_text_node_are_split_apart():
    bid = fetch_fixture(SUBCONTRACT_FIXTURE)[1]

    assert bid["id"] == "ny_contract_reporter:2138289"
    assert bid["source_bid_id"] == "2138289"
    assert bid["dedupe_key"] == bid["id"]
    assert bid["title"] == "CUNY Queens College - Razran Hall & Science Laboratory Renovation"
    assert bid["issuer_name"] == HOWELL
    assert bid["raw_payload"]["contractor_company"] == HOWELL
    assert bid["raw_payload"]["subcontracting"] is True
    assert bid["deadline_date"] == "9/9/2026"
    assert bid["source_url"].endswith("/Ads/Details/2138289")


@pytest.mark.parametrize("index", [0, 1], ids=["card-2138281", "card-2138289"])
def test_subcontracting_cards_pass_the_issuer_publication_gate(index):
    bid = fetch_fixture(SUBCONTRACT_FIXTURE)[index]

    assert "invalid_issuer" not in core_issues(bid)


# --- the two cards that existed before the subcontracting fix --------------------------------

LEGACY_COMMON = {
    "admin_review_status": "unreviewed",
    "amount": None,
    "amount_max": None,
    "amount_min": None,
    "attachments": [],
    "awarded_date": None,
    "contact_email": None,
    "contact_name": None,
    "contact_phone": None,
    "currency": "USD",
    "detail_archive_path": None,
    "detail_archive_status": "not_archived",
    "detail_checksum_sha256": None,
    "detail_fetched_at": None,
    "full_description": None,
    "is_active": 1,
    "issuer_type": "state",
    "lifecycle_status": "open",
    "published_date": "8/20/2026",
    "quality_flags_json": [],
    "solicitation_number": None,
    "source": "New York State Contract Reporter",
    "source_confidence": "medium",
    "state_code": "NY",
}

# What these two cards normalized to before the fix, minus the four wall-clock fields.
LEGACY_BIDS_BEFORE = [
    {
        **LEGACY_COMMON,
        "id": "ny_contract_reporter:2137788",
        "dedupe_key": "ny_contract_reporter:2137788",
        "source_bid_id": "2137788",
        "title": "ABB Supplies & Repair of Parts",
        "description": "ABB Supplies & Repair of Parts",
        "original_category": "Transportation, Bus, Rail, Marine & Aviation",
        "deadline_date": "9/10/2026",
        "issuer_name": "MTA - Metro-North Railroad",
        "source_url": "https://www.nyscr.ny.gov/Ads/Details/2137788",
        "raw_payload": {
            "source_bid_id": "2137788",
            "title": "ABB Supplies & Repair of Parts",
            "description": None,
            "original_category": "Transportation, Bus, Rail, Marine & Aviation",
            "published_date": "8/20/2026",
            "deadline_date": "9/10/2026",
            "issuer_name": "MTA - Metro-North Railroad",
            "source_url": "https://www.nyscr.ny.gov/Ads/Details/2137788",
        },
    },
    {
        **LEGACY_COMMON,
        "id": "ny_contract_reporter:2137875",
        "dedupe_key": "ny_contract_reporter:2137875",
        "source_bid_id": "2137875",
        "title": "C501242-Woodhaven",
        "description": "This is a single source contract notification. This is not a procurement opportunity.",
        "original_category": "Miscellaneous",
        "deadline_date": "9/2/2026",
        "issuer_name": "Unified Court System, NYS",
        "source_url": "https://www.nyscr.ny.gov/Ads/Details/2137875",
        "raw_payload": {
            "source_bid_id": "2137875",
            "title": "C501242-Woodhaven",
            "description": "This is a single source contract notification. This is not a procurement opportunity.",
            "original_category": "Miscellaneous",
            "published_date": "8/20/2026",
            "deadline_date": "9/2/2026",
            "issuer_name": "Unified Court System, NYS",
            "source_url": "https://www.nyscr.ny.gov/Ads/Details/2137875",
        },
    },
]


def test_existing_cards_are_unchanged_apart_from_the_two_new_raw_payload_keys():
    bids = fetch_fixture(LEGACY_FIXTURE)

    assert len(bids) == len(LEGACY_BIDS_BEFORE)
    for bid, before in zip(bids, LEGACY_BIDS_BEFORE):
        expected = {
            **before,
            "raw_payload": {**before["raw_payload"], "contractor_company": None, "subcontracting": False},
        }
        assert without_clock(bid) == expected


# --- shapes the live markup may take ---------------------------------------------------------


@pytest.mark.parametrize(
    "cr_and_company",
    [
        ["CR#:", "2138289", "Company:", HOWELL],
        ["CR#:", f"2138289 Company: {HOWELL}"],
        ["CR#:", "2138289", f"Company: {HOWELL}"],
        ["CR#:", "2138289 Company:", HOWELL],
    ],
    ids=["own-elements", "one-text-node", "label-and-value-together", "label-trails-cr-number"],
)
def test_company_never_stays_in_the_cr_number_however_the_markup_splits_the_text(cr_and_company):
    bid = fetch_card("2138289", "Title:", "CUNY Queens College", *cr_and_company, "Issue date:", "8/20/2026")

    assert bid["id"] == "ny_contract_reporter:2138289"
    assert bid["source_bid_id"] == "2138289"
    assert bid["issuer_name"] == HOWELL
    assert bid["raw_payload"]["contractor_company"] == HOWELL
    assert bid["published_date"] == "8/20/2026"


def test_glued_company_is_split_before_the_url_falls_back_to_the_cr_number():
    bid = fetch_card("", "Title:", "CUNY Queens College", "CR#:", f"2138289 Company: {HOWELL}")

    assert bid["id"] == "ny_contract_reporter:2138289"
    assert bid["source_url"] == "https://www.nyscr.ny.gov/Ads/Details/2138289"


def test_cr_number_is_the_preferred_id_and_the_ad_id_the_fallback():
    with_cr_number = fetch_card("9001", "Title:", "Roof repair", "CR#:", "2138281", "Company:", PIKE)
    without_cr_number = fetch_card("9001", "Title:", "Roof repair", "Company:", PIKE)

    assert with_cr_number["id"] == "ny_contract_reporter:2138281"
    assert with_cr_number["source_url"].endswith("/Ads/Details/9001")
    assert without_cr_number["id"] == "ny_contract_reporter:9001"
    assert without_cr_number["issuer_name"] == PIKE


def test_a_separate_company_field_is_never_overwritten_by_a_glued_one():
    # Only the company is the contract here: the glued split applies solely when no real
    # Company: field exists, so the CR# text is deliberately left as the page wrote it.
    bid = fetch_card("2138289", "Title:", "Roof repair", "CR#:", "2138289 Company: Glued Co", "Company:", HOWELL)

    assert bid["raw_payload"]["contractor_company"] == HOWELL
    assert bid["issuer_name"] == HOWELL


def test_agency_stays_the_issuer_when_the_card_also_names_a_company():
    bid = fetch_card(
        "2138281", "Title:", "Roof repair", "CR#:", "2138281", "Agency:", "Office of General Services, NYS",
        "Company:", PIKE,
    )

    assert bid["issuer_name"] == "Office of General Services, NYS"
    assert bid["raw_payload"]["contractor_company"] == PIKE


def test_card_naming_neither_agency_nor_company_keeps_the_unknown_issuer_default():
    # The fix lives in the spider; the normalizer's default must stay so that a card with no
    # issuer information at all is still held back by the publication gate.
    bid = fetch_card("2138281", "Title:", "Roof repair", "CR#:", "2138281")

    assert bid["issuer_name"] == "Unknown state agency"
    assert "invalid_issuer" in core_issues(bid)
    assert bid["raw_payload"]["contractor_company"] is None
    assert bid["raw_payload"]["subcontracting"] is False


# --- the unlabelled marker sentence ----------------------------------------------------------

MARKER_VARIANTS = [MARKER, f"{MARKER}.", MARKER.upper(), f"{MARKER.lower()}."]
MARKER_VARIANT_IDS = ["as-written", "trailing-period", "upper-case", "lower-case-trailing-period"]


@pytest.mark.parametrize("sentence", MARKER_VARIANTS, ids=MARKER_VARIANT_IDS)
@pytest.mark.parametrize("after", ["Title:", "CR#:", "Company:", "Category:"])
def test_marker_sentence_in_its_own_element_never_leaks_into_a_field(after, sentence):
    fields = [
        ("Title:", "PIKE CS - Plan"),
        ("CR#:", "2138281"),
        ("Company:", PIKE),
        ("Category:", "Construction"),
    ]
    texts = []
    for label, value in fields:
        texts += [label, value]
        if label == after:
            texts.append(sentence)

    bid = fetch_card("2138281", *texts)

    assert bid["title"] == "PIKE CS - Plan"
    assert bid["description"] == "PIKE CS - Plan"
    assert bid["id"] == "ny_contract_reporter:2138281"
    assert bid["issuer_name"] == PIKE
    assert bid["raw_payload"]["contractor_company"] == PIKE
    assert bid["original_category"] == "Construction"
    assert bid["raw_payload"]["subcontracting"] is True


@pytest.mark.parametrize("sentence", MARKER_VARIANTS, ids=MARKER_VARIANT_IDS)
def test_marker_sentence_glued_to_the_title_is_stripped_and_flags_the_record(sentence):
    bid = fetch_card(
        "2138281", "Title:", f"PIKE CS - Plan {sentence}", "CR#:", "2138281", "Company:", PIKE,
    )

    assert bid["title"] == "PIKE CS - Plan"
    assert bid["description"] == "PIKE CS - Plan"
    assert bid["raw_payload"]["title"] == "PIKE CS - Plan"
    assert bid["raw_payload"]["subcontracting"] is True


def test_a_note_that_merely_contains_the_sentence_is_kept_verbatim():
    note = f"{MARKER} for plumbing and electrical trades; see the agency website."

    bid = fetch_card("2138281", "Title:", "Roof repair", "CR#:", "2138281", "Note:", note)

    assert bid["description"] == note
    assert bid["raw_payload"]["description"] == note
