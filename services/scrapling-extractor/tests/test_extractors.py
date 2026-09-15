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
    # Short text lives in `description` alone; `full_description` stays None rather than
    # repeating the same bytes (see test_short_description_is_not_duplicated_into_full_description).
    assert fields["full_description"] is None
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


def test_short_description_is_not_duplicated_into_full_description():
    """A description that already fits in one field must not be stored twice: the pair is
    serialized to fetch-task's stdout and written to two DB columns."""
    result = extract(_html(), URL, ["description"])
    assert result["fields"]["description"].startswith("The Department seeks a contractor")
    assert result["fields"]["full_description"] is None


def test_long_description_keeps_the_full_text_and_a_short_summary():
    body = "The Department seeks a contractor for deck repair on Bridge 41. " * 20
    html = (
        "<html><body><main><table>"
        f"<tr><td class='label'>Description</td><td>{body}</td></tr>"
        "</table></main></body></html>"
    )
    fields = extract(html, URL, ["description"])["fields"]
    assert len(fields["full_description"]) > 500
    assert fields["full_description"].startswith("The Department seeks a contractor")
    assert fields["description"] != fields["full_description"]
    assert len(fields["description"]) <= 500
    assert fields["description"].startswith(
        "The Department seeks a contractor for deck repair on Bridge 41."
    )


def test_fallback_skips_blocks_nested_inside_navigation_chrome():
    """The NY login-page regression: a `div` inside `<nav>` is still navigation text, and the
    old `element.tag in _NOISE_TAGS` guard could never see it (the CSS selector never returns
    a nav/header/footer element itself)."""
    menu = "Find Bids Advertise Bids Business Registry Help Contact Us Sign In " * 5
    html = (
        f"<html><body><nav><div class='menu'>{menu}</div></nav>"
        "<main><p>Short.</p></main></body></html>"
    )
    result = extract(html, URL, ["description"])
    assert result["fields"]["description"] is None
    assert result["fields"]["full_description"] is None
    assert result["diagnostics"]["description"] == "not_found"


def test_fallback_rejects_a_block_below_the_quality_floor():
    html = "<html><body><div id='body'>Bids close soon.</div></body></html>"
    result = extract(html, URL, ["description"])
    assert result["fields"]["description"] is None
    assert result["diagnostics"]["description"] == "not_found"


def test_fallback_rejects_a_long_block_without_any_sentence_feature():
    # Over the 150-character floor, but no sentence punctuation and well under 25 words —
    # a breadcrumb/menu strip, not prose.
    html = "<html><body><div id='body'>" + ("Solicitation-Registration " * 8) + "</div></body></html>"
    result = extract(html, URL, ["description"])
    assert result["fields"]["description"] is None
    assert result["diagnostics"]["description"] == "not_found"


def test_fallback_still_extracts_a_real_paragraph_inside_main():
    paragraph = "The county will award a contract for snow removal services at twelve facilities. " * 3
    html = (
        "<html><body><nav><div>Home Bids Help Contact Register</div></nav>"
        f"<main><p>{paragraph}</p></main></body></html>"
    )
    result = extract(html, URL, ["description"])
    assert result["fields"]["description"].startswith("The county will award a contract")
    assert result["diagnostics"]["description"] == "heuristic"


def test_fallback_reaches_a_paragraph_wrapped_in_a_page_level_form():
    """BuySpeed / ASP.NET WebForms portals wrap the entire body in one <form> (viewstate
    postback). Treating `form` as chrome the same as nav/header/footer/aside made the
    largest-text-block fallback unreachable on those portals: everything on the page,
    including the real bid description, is nested inside that page-level form."""
    paragraph = "The county will award a contract for snow removal services at twelve facilities. " * 3
    html = f"<html><body><form><div>{paragraph}</div></form></body></html>"
    result = extract(html, URL, ["description"])
    assert result["fields"]["description"].startswith("The county will award a contract")
    assert result["diagnostics"]["description"] == "heuristic"
