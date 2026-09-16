"""Offline regressions spanning list normalization and detail merge."""

from copy import deepcopy
from pathlib import Path

import pytest

from apsi_crawler.content_quality import is_login_html
from apsi_crawler.enrichment import (
    ExtractorError,
    detect_off_target_redirect,
    enrich_bids,
    merge_enrichment,
    resolve_attachment_url,
)
from apsi_crawler.spiders.il_bidbuy import fetch_il_bidbuy_opportunities
from test_enrichment import FakeExtractor, FakeResponse, FakeSession, _bid, _source


def run_detail(bid, result, fields=None, html="<html>detail</html>"):
    extractor = FakeExtractor(result=result)
    session = FakeSession({bid["source_url"]: FakeResponse(html)})
    out, stats = enrich_bids(
        [bid], _source(), {"enrichment": {"enabled": True, "min_interval_seconds": 0, "fields": fields or ["description"]}},
        extractor=extractor, session=session,
    )
    return out[0], stats, extractor


def test_il_list_fixture_short_detail_replaces_title_without_hidden_long_placeholder():
    bid = fetch_il_bidbuy_opportunities(_source(), fixture_html=Path(__file__).parent / "fixtures/il_bidbuy_open_bids.html")[0]
    assert bid["title"] == "Enterprise data integration services"
    assert bid["full_description"] is None
    result = {"fields": {"description": "Integrate enterprise systems with secure data pipelines."}, "diagnostics": {"description": "heuristic"}}
    bid, stats, _ = run_detail(bid, result)
    assert stats["enriched"] == 1
    assert bid["description"] == result["fields"]["description"]
    assert bid["full_description"] is None
    assert bid["raw_payload"]["enrichment"]["applied_fields"] == ["description"]


@pytest.mark.parametrize("full", ["  ROAD  repair ", "A list summary"])
def test_legacy_placeholder_full_is_replaced_by_actual_body(full):
    body = "This project repairs bridge decks using reinforced concrete and includes traffic management. " * 10
    bid = _bid(description="A list summary", full_description=full)
    result = {"fields": {"description": body[:180], "full_description": body}, "diagnostics": {"description": "heuristic"}}
    bid, stats, _ = run_detail(bid, result)
    assert stats["enriched"] == 1
    assert bid["full_description"] == body
    assert bid["description"] == body[:180]
    assert bid["raw_payload"]["enrichment"]["applied_fields"] == ["description", "full_description"]


def test_case_and_whitespace_title_echo_is_replaceable():
    bid = _bid(description="  ROAD\n repair ", full_description="road    REPAIR")
    merge_enrichment(bid, {"fields": {"description": "Install traffic signals."}}, None)
    assert bid["description"] == "Install traffic signals."
    assert bid["full_description"] is None


def test_existing_useful_full_body_and_contact_are_preserved():
    full = "Existing reviewed scope including delivery milestones and acceptance criteria."
    bid = _bid(description="Existing summary", full_description=full, contact_name="Existing buyer")
    result = {"fields": {"description": "Guessed new summary", "full_description": "Guessed full body", "contact_name": "Guess", "contact_email": "buyer@example.gov"}}
    merge_enrichment(bid, result, None)
    assert bid["description"] == "Existing summary"
    assert bid["full_description"] == full
    assert bid["contact_name"] == "Existing buyer"
    assert bid["contact_email"] == "buyer@example.gov"
    assert bid["raw_payload"]["enrichment"]["applied_fields"] == ["contact_email"]


def test_contact_name_alone_does_not_skip_missing_email_and_phone():
    bid = _bid(contact_name="Jane")
    bid, stats, _ = run_detail(bid, {"fields": {"contact_name": "Guess", "contact_email": "jane@example.gov", "contact_phone": "217-555-0100"}}, ["contact"])
    assert stats["attempted"] == 1
    assert bid["contact_name"] == "Jane"
    assert bid["contact_email"] == "jane@example.gov"
    assert bid["raw_payload"]["enrichment"]["applied_fields"] == ["contact_email", "contact_phone"]


def test_incremental_attachments_are_discovered_and_existing_metadata_preserved():
    old = {"name": "Saved.pdf", "url": "https://x/a.pdf", "storage_path": "archive/a.pdf", "sort_order": 0}
    bid = _bid(attachments=[old])
    bid, stats, _ = run_detail(bid, {"fields": {}, "attachments": [{"name": "A.pdf", "url": "https://x/a.pdf"}, {"name": "B.pdf", "url": "https://x/b.pdf"}, {"name": "B.pdf", "url": "https://x/b.pdf"}]}, ["attachments"])
    assert stats["attempted"] == 1
    assert bid["attachments"][0] == old
    assert [item["url"] for item in bid["attachments"]] == ["https://x/a.pdf", "https://x/b.pdf"]
    assert bid["raw_payload"]["enrichment"]["applied_fields"] == ["attachments"]


def test_enriched_two_digit_date_keeps_evidence():
    bid = _bid()
    merge_enrichment(bid, {"fields": {"published_date": "09/14/26"}}, None)
    assert bid["published_date"] == "2026-09-14"
    assert bid["raw_payload"]["enrichment"]["original_values"]["published_date"] == "09/14/26"


@pytest.mark.parametrize("final", ["https://x.gov/detail?tab=docs", "https://x.gov/detail?docId=999"])
def test_lost_or_changed_query_detail_id_is_off_target(final):
    assert detect_off_target_redirect("https://x.gov/detail?docId=123", final, True)


def test_same_id_with_reordered_query_and_new_tab_is_on_target():
    assert detect_off_target_redirect("https://x.gov/detail?docId=123&tab=1", "https://x.gov/detail?tab=2&docId=123", True) is None


def test_redirect_changed_path_id_that_contains_original_is_off_target():
    assert detect_off_target_redirect("https://x.gov/bids/123", "https://x.gov/bids/1234", True)


def test_same_url_login_html_never_reaches_extractor():
    login = '<html><title>Vendor Sign In</title><main><form action="/account/login"><label>Email</label><input name="email"><input type="password"><button>Sign in</button></form></main></html>'
    bid, stats, extractor = run_detail(_bid(), {"fields": {"description": "Please sign in to view bids."}}, html=login)
    assert stats["failed"] == 1
    assert extractor.calls == []
    assert "detail_fetched_at" not in bid


def test_legitimate_bid_body_in_form_with_optional_login_is_accepted():
    html = '<html><title>Bid Details</title><form><h1>Road Repair</h1><table><tr><td>Description</td><td>Replace pavement and road signs.</td></tr></table><aside><form action="/login"><input type="password"><button>Sign In</button></form></aside></form></html>'
    _, stats, extractor = run_detail(_bid(), {"fields": {"description": "Replace pavement and road signs."}}, html=html)
    assert stats["enriched"] == 1
    assert len(extractor.calls) == 1


@pytest.mark.parametrize("result", [
    {"fields": {"description": "Good scope", "contact_email": {"bad": "value"}}},
    {"fields": {"description": "Good scope"}, "attachments": [None]},
    {"fields": {"description": "Good scope"}, "attachments": [{"url": 123}]},
    {"fields": {"description": "Good scope"}, "diagnostics": ["description"]},
    {"fields": {"description": "Good scope"}, "attachments": "bad"},
    {"fields": {"description": ["bad"]}},
])
def test_malformed_response_fails_open_without_any_partial_mutation(result):
    bid = _bid(raw_payload={"list": "evidence"})
    before = deepcopy(bid)
    out, stats, _ = run_detail(bid, result)
    assert stats["failed"] == 1
    assert out == before


def test_direct_merge_rejects_invalid_attachment_before_writing_description():
    bid = _bid()
    before = deepcopy(bid)
    with pytest.raises(ExtractorError):
        merge_enrichment(bid, {"fields": {"description": "Good scope"}, "attachments": [None]}, None)
    assert bid == before


def test_medium_list_summary_does_not_prevent_full_body_discovery():
    summary = "The department seeks bridge repairs and traffic management services. " * 4
    body = summary + "Detailed contractor requirements and acceptance criteria. " * 20
    bid = _bid(description=summary)
    out, stats, _ = run_detail(bid, {"fields": {"description": summary, "full_description": body}})
    assert stats["attempted"] == 1
    assert out["description"] == summary
    assert out["full_description"] == body


def test_real_pa_sid_is_a_detail_identity():
    assert detect_off_target_redirect("https://x.gov/Solicitations.aspx?SID=6100066394-1", "https://x.gov/Solicitations.aspx", True)


def test_unrequested_fields_cannot_be_applied_by_misbehaving_parser():
    bid, stats, _ = run_detail(_bid(), {"fields": {"description": "Actual detail scope", "contact_name": "Wrong unexpected contact"}}, ["description"])
    assert stats["enriched"] == 1
    assert bid["contact_name"] is None
    assert bid["raw_payload"]["enrichment"]["applied_fields"] == ["description"]


def test_authoritative_short_detail_explicitly_clears_a_previously_stored_full_body():
    # The fresh normalized list record cannot see the previous full body in the database.
    # A short parser response therefore needs to carry an explicit clear to both importers.
    bid = _bid(full_description=None)
    merge_enrichment(bid, {"fields": {"description": "Updated short scope.", "full_description": None}}, None)
    assert bid["full_description"] is None
    assert bid["raw_payload"]["enrichment"]["applied_fields"] == ["description", "full_description"]


def test_partial_extraction_without_new_description_does_not_clear_full_body():
    full = "The existing authoritative statement of work."
    bid = _bid(description="Summary", full_description=full)
    merge_enrichment(bid, {"fields": {"full_description": None, "contact_email": "buyer@example.gov"}}, None)
    assert bid["full_description"] == full
    assert bid["raw_payload"]["enrichment"]["applied_fields"] == ["contact_email"]


def test_richer_selector_short_detail_replaces_an_incomplete_prose_list_summary():
    summary = "The department is requesting roadway maintenance services for several local routes. Work will include regular inspection, reporting and scheduled repairs."
    detail = "The selected contractor shall inspect the roadway each week and repair all reported potholes within two working days. The project includes fifteen local roads and requires monthly reports, traffic controls and documented quality inspections."
    bid, stats, _ = run_detail(_bid(description=summary), {
        "fields": {"description": detail, "full_description": None},
        "diagnostics": {"description": "selector"},
    })
    assert stats["enriched"] == 1
    assert bid["description"] == detail
    assert bid["full_description"] is None
    assert bid["raw_payload"]["enrichment"]["applied_fields"] == ["description", "full_description"]


def test_short_selector_does_not_replace_an_existing_complete_body():
    body = "Existing reviewed requirements and delivery milestones. " * 20
    bid = _bid(description=body)
    changed = merge_enrichment(bid, {
        "fields": {"description": "New guessed short scope.", "full_description": None},
        "diagnostics": {"description": "selector"},
    }, None)
    assert changed is False
    assert bid["description"] == body


def test_heuristic_short_text_does_not_overwrite_existing_prose_summary():
    summary = "Existing requirements and delivery milestones for pavement repairs. " * 3
    guessed = summary + "More page navigation and unrelated bid descriptions."
    bid = _bid(description=summary)
    changed = merge_enrichment(bid, {
        "fields": {"description": guessed, "full_description": None},
        "diagnostics": {"description": "heuristic"},
    }, None)
    assert changed is False
    assert bid["description"] == summary


def test_login_instructions_mentioning_bid_description_are_rejected_before_parse():
    fixture = Path(__file__).resolve().parents[2] / "services/scrapling-extractor/tests/fixtures/login_wall.html"
    bid, stats, extractor = run_detail(_bid(), {"fields": {"description": "Please log in to see the bid description and attachments."}}, html=fixture.read_text())
    assert stats["failed"] == 1
    assert extractor.calls == []
    assert "detail_fetched_at" not in bid


def test_same_document_is_not_appended_twice_when_the_detail_url_only_differs_cosmetically():
    existing = {"name": "A.pdf", "url": "https://Portal.Example.gov/docs/a.pdf", "sort_order": 0}
    bid = _bid(attachments=[existing])
    changed = merge_enrichment(bid, {"fields": {}, "attachments": [
        {"name": "A.pdf", "url": "https://portal.example.gov/docs/a.pdf"},
        {"name": "A.pdf", "url": "https://portal.example.gov:443/docs/a.pdf"},
        {"name": "A.pdf", "url": "https://portal.example.gov/docs/a.pdf#page=2"},
        {"name": "B.pdf", "url": "https://portal.example.gov/docs/b.pdf"},
    ]}, None, ["attachments"])
    assert changed is True
    assert [item["url"] for item in bid["attachments"]] == [existing["url"], "https://portal.example.gov/docs/b.pdf"]


@pytest.mark.parametrize("final", [
    "https://www.x.gov/bid/1",
    "https://x.gov:443/bid/1",
    "https://X.GOV/bid/1",
])
def test_cosmetic_host_redirects_stay_on_target(final):
    assert detect_off_target_redirect("https://x.gov/bid/1", final, True) is None


def test_a_genuinely_different_host_is_still_off_target():
    assert detect_off_target_redirect("https://x.gov/bid/1", "https://evil.example.com/bid/1", True)
    assert detect_off_target_redirect("https://x.gov/bid/1", "https://other.x.gov/bid/1", True)


def test_attachment_template_percent_encodes_the_portal_supplied_id():
    template = "https://x.gov/file?nbr={id}&doc={source_bid_id}"
    assert resolve_attachment_url("javascript:dl('998877')", "RFP 26-101&mode=admin", template) == (
        "https://x.gov/file?nbr=998877&doc=RFP%2026-101%26mode%3Dadmin"
    )


def test_public_bid_page_with_a_site_wide_login_widget_is_not_a_login_wall():
    html = (
        '<html><title>Solicitation Details</title>'
        '<header><form action="/vendor/login"><input name="user"><input type="password"><button>Log In</button></form></header>'
        '<main><h1>RFP 26-101</h1><table><tr><td>Solicitation Description:</td>'
        '<td>Repair bridge decks on twelve county routes.</td></tr></table></main></html>'
    )
    assert is_login_html(html) is False


def test_login_wall_fixture_is_still_detected():
    fixture = Path(__file__).resolve().parents[2] / "services/scrapling-extractor/tests/fixtures/login_wall.html"
    assert is_login_html(fixture.read_text()) is True


def test_punctuation_only_title_echo_is_replaced_by_a_shorter_real_detail_summary():
    bid = _bid(description="Road Repair!")
    changed = merge_enrichment(bid, {"fields": {"description": "Signals."}}, None, ["description"])
    assert changed is True
    assert bid["description"] == "Signals."


@pytest.mark.parametrize("label", ["Description of Services:", "Bulletin Desc:", "Project Summary"])
def test_qualified_description_labels_keep_a_public_page_out_of_the_login_gate(label):
    html = (
        '<html><title>Solicitation Details</title>'
        '<form action="/portal/login"><input type="password" name="pw"><button>Sign In</button></form>'
        f'<table><tr><td>{label}</td><td>Repair bridge decks on twelve county routes.</td></tr></table></html>'
    )
    assert is_login_html(html) is False


def test_a_login_wall_whose_only_description_text_is_an_instruction_is_still_a_login_wall():
    html = (
        '<html><title>Sign In</title><form action="/login"><input type="password">'
        '<table><tr><td>Bid Description:</td><td>Please sign in to view this description.</td></tr></table>'
        '</form></html>'
    )
    assert is_login_html(html) is True
