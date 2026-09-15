import pathlib

import pytest

pytest.importorskip("scrapling")

from extractors import SUPPORTED_FIELDS, ExtractError, extract  # noqa: E402

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
URL = "https://example.gov/bids/26-101"


def _html():
    return (FIXTURES / "synthetic_detail.html").read_text(encoding="utf-8")


def test_supported_fields_are_the_spec_list():
    assert SUPPORTED_FIELDS == ("description", "attachments", "category", "contact", "published_date")


def test_heuristics_extract_every_field_from_label_table():
    result = extract(_html(), URL, list(SUPPORTED_FIELDS))
    fields = result["fields"]
    assert fields["description"].startswith("The Department seeks a contractor")
    assert fields["full_description"] == fields["description"]
    assert fields["original_category"] == "Construction Services"
    assert fields["contact_name"] == "Jane Buyer"
    assert fields["contact_email"] == "jane.buyer@example.gov"
    assert fields["contact_phone"] == "555-0100"
    assert fields["published_date"] == "08/14/2026"
    assert result["diagnostics"]["description"] == "heuristic"


def test_attachments_resolve_absolute_urls_and_keep_javascript_links_raw():
    result = extract(_html(), URL, ["attachments"])
    attachments = result["attachments"]
    assert attachments == [
        {
            "name": "Specification.pdf",
            "url": "https://example.gov/docs/rfq-26-101-spec.pdf",
            "raw_href": "/docs/rfq-26-101-spec.pdf",
            "size_label": None,
            "mime_type": "application/pdf",
            "sort_order": 0,
        },
        {
            "name": "Drawings.zip",
            "url": None,
            "raw_href": "javascript:downloadFile('998877')",
            "size_label": None,
            "mime_type": "application/zip",
            "sort_order": 1,
        },
    ]


def test_explicit_selector_wins_over_heuristic():
    result = extract(_html(), URL, ["description"], selectors={"description": "h1"})
    assert result["fields"]["description"] == "RFQ 26-101 Bridge Deck Repair"
    assert result["diagnostics"]["description"] == "selector"


def test_xpath_selector_is_detected_by_leading_slash():
    result = extract(_html(), URL, ["category"], selectors={"category": "//tr[td='NAICS']/td[2]"})
    assert result["fields"]["original_category"] == "237310"


def test_missing_field_is_reported_not_found():
    result = extract("<html><body><p>nothing here</p></body></html>", URL, ["published_date"])
    assert result["fields"]["published_date"] is None
    assert result["diagnostics"]["published_date"] == "not_found"


def test_unknown_field_raises():
    with pytest.raises(ExtractError):
        extract(_html(), URL, ["price"])


def test_description_falls_back_to_largest_text_block_without_label():
    html = "<html><body><nav>menu</nav><div id='body'>" + ("Scope of work sentence. " * 30) + "</div><footer>foot</footer></body></html>"
    result = extract(html, URL, ["description"])
    assert result["fields"]["description"].startswith("Scope of work sentence.")
