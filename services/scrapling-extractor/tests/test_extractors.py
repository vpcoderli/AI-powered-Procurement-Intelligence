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


def test_adaptive_store_is_written_under_the_requested_storage_dir(tmp_path):
    storage_dir = tmp_path / "scrapling"
    storage_dir.mkdir()
    extract(_html(), URL, ["description"], storage_dir=str(storage_dir))
    assert (storage_dir / "elements_storage.db").exists()


def test_selector_that_matches_nothing_is_not_reported_as_selector():
    result = extract(
        _html(),
        URL,
        ["attachments", "contact"],
        selectors={"attachments": ".no-such-block a", "contact": ".no-such-block"},
    )
    assert result["attachments"] == []
    assert result["diagnostics"]["attachments"] == "not_found"
    assert result["fields"]["contact_name"] is None
    assert result["diagnostics"]["contact"] == "not_found"


def test_matching_selector_is_reported_as_selector_for_attachments_and_contact():
    result = extract(
        _html(),
        URL,
        ["attachments", "contact"],
        selectors={"attachments": "tr:last-child a", "contact": "//tr[td='Contact']/td[2]"},
    )
    assert result["diagnostics"]["attachments"] == "selector"
    assert result["diagnostics"]["contact"] == "selector"


CONTACT_BLOCK_HTML = """<html><body><main>
<div class="buyer-card"><span class="who">Jane Buyer</span>
<a href="mailto:jane.buyer@example.gov">Email this buyer</a>
<a href="tel:555-0100">Call</a></div>
</main></body></html>"""


def test_contact_selector_reads_email_and_phone_from_anchor_hrefs(monkeypatch):
    import extractors

    calls = []
    original = extractors._select

    def counting_select(page, selector):
        calls.append(selector)
        return original(page, selector)

    monkeypatch.setattr(extractors, "_select", counting_select)
    result = extract(CONTACT_BLOCK_HTML, URL, ["contact"], selectors={"contact": ".buyer-card"})

    assert result["fields"]["contact_email"] == "jane.buyer@example.gov"
    assert result["fields"]["contact_phone"] == "555-0100"
    assert "Jane Buyer" in result["fields"]["contact_name"]
    assert calls == [".buyer-card"], "the contact selector must be evaluated exactly once"
