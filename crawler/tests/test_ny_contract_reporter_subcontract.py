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


def assert_company_without_marker(bid, company):
    """The pinned rule: a Company: row with no marker sentence names the contractor, nothing more."""
    assert bid["raw_payload"]["contractor_company"] == company
    assert bid["raw_payload"]["subcontracting"] is False


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
    assert_company_without_marker(bid, HOWELL)
    assert bid["published_date"] == "8/20/2026"


def test_glued_company_is_split_before_the_url_falls_back_to_the_cr_number():
    bid = fetch_card("", "Title:", "CUNY Queens College", "CR#:", f"2138289 Company: {HOWELL}")

    assert bid["id"] == "ny_contract_reporter:2138289"
    assert bid["source_url"] == "https://www.nyscr.ny.gov/Ads/Details/2138289"
    assert_company_without_marker(bid, HOWELL)


def test_cr_number_is_the_preferred_id_and_the_ad_id_the_fallback():
    with_cr_number = fetch_card("9001", "Title:", "Roof repair", "CR#:", "2138281", "Company:", PIKE)
    without_cr_number = fetch_card("9001", "Title:", "Roof repair", "Company:", PIKE)

    assert with_cr_number["id"] == "ny_contract_reporter:2138281"
    assert with_cr_number["source_url"].endswith("/Ads/Details/9001")
    assert without_cr_number["id"] == "ny_contract_reporter:9001"
    assert without_cr_number["issuer_name"] == PIKE
    assert_company_without_marker(with_cr_number, PIKE)
    assert_company_without_marker(without_cr_number, PIKE)


def test_a_separate_company_field_wins_over_a_glued_one_and_the_id_is_still_clean():
    # Both a company folded into the CR# text and a real Company: row: the real row names the
    # contractor, but the id must lose the folded-in text either way.
    bid = fetch_card("2138289", "Title:", "Roof repair", "CR#:", "2138289 Company: Glued Co", "Company:", HOWELL)

    assert bid["id"] == "ny_contract_reporter:2138289"
    assert bid["source_bid_id"] == "2138289"
    assert bid["issuer_name"] == HOWELL
    assert_company_without_marker(bid, HOWELL)


@pytest.mark.parametrize(
    ("agency", "issuer"),
    [
        (None, "Unknown state agency"),
        ("Office of General Services, NYS", "Office of General Services, NYS"),
    ],
    ids=["no-agency-falls-back-to-the-default", "agency-is-the-issuer"],
)
def test_a_glued_company_label_naming_nobody_still_leaves_a_clean_id(agency, issuer):
    # "2138289 Company:" in one text node, with no company after it. The id must not keep the
    # label, and the issuer is whatever the existing rules give: the Agency, else the default.
    texts = ["Title:", "Roof repair", "CR#:", "2138289 Company:"]
    if agency:
        texts += ["Agency:", agency]

    bid = fetch_card("2138289", *texts)

    assert bid["id"] == "ny_contract_reporter:2138289"
    assert bid["source_bid_id"] == "2138289"
    assert bid["issuer_name"] == issuer
    assert bid["raw_payload"]["contractor_company"] is None
    assert bid["raw_payload"]["subcontracting"] is False


def test_agency_stays_the_issuer_when_the_card_also_names_a_company():
    bid = fetch_card(
        "2138281", "Title:", "Roof repair", "CR#:", "2138281", "Agency:", "Office of General Services, NYS",
        "Company:", PIKE,
    )

    assert bid["issuer_name"] == "Office of General Services, NYS"
    assert_company_without_marker(bid, PIKE)


def test_card_naming_neither_agency_nor_company_keeps_the_unknown_issuer_default():
    # The fix lives in the spider; the normalizer's default must stay so that a card with no
    # issuer information at all is still held back by the publication gate.
    bid = fetch_card("2138281", "Title:", "Roof repair", "CR#:", "2138281")

    assert bid["issuer_name"] == "Unknown state agency"
    assert "invalid_issuer" in core_issues(bid)
    assert bid["raw_payload"]["contractor_company"] is None
    assert bid["raw_payload"]["subcontracting"] is False


# --- the unlabelled marker sentence ----------------------------------------------------------

# The sentence may be followed by any mix of "." / "!" / whitespace and be in any case. The same
# list drives the standalone-element test and the glued-onto-the-title test, so both checks must
# accept exactly the same spellings.
MARKER_VARIANTS = [
    MARKER,
    f"{MARKER}.",
    f"{MARKER}!",
    f"{MARKER}..",
    f"{MARKER} . !",
    MARKER.upper(),
    f"{MARKER.lower()}.",
]
MARKER_VARIANT_IDS = [
    "as-written",
    "period",
    "exclamation",
    "double-period",
    "mixed-punctuation",
    "upper-case",
    "lower-case-period",
]

# Not markers: a longer sentence, a second sentence, other punctuation, another phrase.
NOT_MARKERS = [
    f"{MARKER} for plumbing and electrical trades",
    f"{MARKER}. See the agency website.",
    f"{MARKER}?",
    "This is a subcontract opportunity",
]
NOT_MARKER_IDS = ["longer-sentence", "second-sentence", "other-punctuation", "other-phrase"]


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


@pytest.mark.parametrize("text", NOT_MARKERS, ids=NOT_MARKER_IDS)
def test_only_the_marker_sentence_itself_is_a_marker(text):
    # Such text is ordinary title content: as an element of its own it is appended to the title,
    # and glued onto the title it stays there. Neither strips it nor flags the record.
    own_element = fetch_card("2138281", "Title:", "PIKE CS - Plan", text, "CR#:", "2138281", "Company:", PIKE)
    glued = fetch_card("2138281", "Title:", f"PIKE CS - Plan {text}", "CR#:", "2138281", "Company:", PIKE)

    for bid in (own_element, glued):
        assert bid["title"] == f"PIKE CS - Plan {text}"
        assert bid["raw_payload"]["subcontracting"] is False


def test_a_note_that_merely_contains_the_sentence_is_kept_verbatim():
    note = f"{MARKER} for plumbing and electrical trades; see the agency website."

    bid = fetch_card("2138281", "Title:", "Roof repair", "CR#:", "2138281", "Note:", note)

    assert bid["description"] == note
    assert bid["raw_payload"]["description"] == note
