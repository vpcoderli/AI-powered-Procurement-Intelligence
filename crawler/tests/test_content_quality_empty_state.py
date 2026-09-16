"""Verified empty-list detection (contract C1).

A county portal that legitimately has nothing open today must not be reported as a parser
failure. Detection needs BOTH an explicit empty-list phrase and proof that we are looking at
the right tenant page — otherwise a generic "no results found" chrome string on a wrong/404
page would silently turn a broken source into a healthy one.
"""

from pathlib import Path

import pytest

from apsi_crawler.adapters.task import TaskSource
from apsi_crawler.content_quality import detect_empty_list, label_tokens
from apsi_crawler.errors import VerifiedEmptyListError
from apsi_crawler.spiders.co_bidnet import CoBidnetError, fetch_bidnet_opportunities
from apsi_crawler.spiders.generic_state import fetch_generic_state_opportunities


FIXTURES_DIR = Path(__file__).parent / "fixtures"
ERIE_FIXTURE = FIXTURES_DIR / "bidnet_erie_no_open_bids.html"


def _erie_html():
    return ERIE_FIXTURE.read_text(encoding="utf-8")


def _source(source_id, label, state_code="NY", base_url="https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids"):
    return TaskSource(
        id=source_id,
        name=label,
        source_label=label,
        jurisdiction="county",
        state_code=state_code,
        base_url=base_url,
        fetch_config={"base_url": base_url},
    )


def test_label_tokens_drops_stop_words_and_state_codes():
    assert label_tokens("Erie County, NY (BidNet)") == ["Erie"]
    assert label_tokens("City of Aurora, CO (BidNet)") == ["Aurora"]
    assert label_tokens("Washtenaw County, MI (BidNet)") == ["Washtenaw"]
    # Nothing distinctive left -> callers cannot confirm the tenant.
    assert label_tokens("County of the State") == []


def test_detects_erie_empty_state_and_confirms_the_tenant():
    result = detect_empty_list(_erie_html(), "Erie County, NY (BidNet)")

    assert result["detected"] is True
    assert result["marker"] == "There are no open bids at this time."
    assert result["tenant_confirmed"] is True


def test_erie_page_is_not_tenant_confirmed_for_a_different_county():
    result = detect_empty_list(_erie_html(), "Boulder County, CO (BidNet)")

    assert result["detected"] is True
    assert result["marker"] == "There are no open bids at this time."
    assert result["tenant_confirmed"] is False


def test_page_without_an_empty_phrase_is_not_an_empty_state():
    html = "<html><head><title>Erie County</title></head><body><table><tr><td>Road repair</td></tr></table></body></html>"

    assert detect_empty_list(html, "Erie County, NY (BidNet)") == {
        "detected": False,
        "marker": None,
        "tenant_confirmed": False,
    }


@pytest.mark.parametrize(
    "phrase",
    [
        "There are no open bids at this time.",
        "There are no open solicitations posted.",
        "No solicitations are currently available.",
        "No solicitations available.",
        "No results found.",
        "There are currently no open opportunities.",
    ],
)
def test_recognizes_every_contract_phrase(phrase):
    html = "<html><head><title>Erie County</title></head><body><p>{0}</p></body></html>".format(phrase)

    result = detect_empty_list(html, "Erie County, NY (BidNet)")
    assert result["detected"] is True
    assert result["marker"] == phrase
    assert result["tenant_confirmed"] is True


def test_script_and_style_text_never_counts_as_page_copy():
    html = (
        "<html><head><title>Erie County</title>"
        "<script>var msg = 'There are no open bids at this time.';</script></head>"
        "<body><table><tr><td>Road repair</td></tr></table></body></html>"
    )

    assert detect_empty_list(html, "Erie County, NY (BidNet)")["detected"] is False


def test_bidnet_adapter_raises_verified_empty_for_the_erie_page():
    with pytest.raises(VerifiedEmptyListError) as error:
        fetch_bidnet_opportunities(
            _source("bidnet_ny_erie", "Erie County, NY (BidNet)"),
            url="https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids",
            fixture_html=str(ERIE_FIXTURE),
        )

    assert error.value.tenant_confirmed is True
    assert error.value.marker == "There are no open bids at this time."
    assert error.value.method == "adapter"


def test_bidnet_adapter_reports_an_unconfirmed_empty_page_without_tenant_confirmation():
    with pytest.raises(VerifiedEmptyListError) as error:
        fetch_bidnet_opportunities(
            _source("bidnet_co_boulder", "Boulder County, CO (BidNet)", state_code="CO"),
            url="https://www.bidnetdirect.com/colorado/boulder-county/solicitations/open-bids",
            fixture_html=str(ERIE_FIXTURE),
        )

    assert error.value.tenant_confirmed is False


def test_bidnet_adapter_still_fails_loudly_when_the_page_has_no_empty_marker(tmp_path):
    fixture = tmp_path / "broken.html"
    fixture.write_text("<html><body><p>Something else entirely</p></body></html>", encoding="utf-8")

    with pytest.raises(CoBidnetError) as error:
        fetch_bidnet_opportunities(
            _source("bidnet_ny_erie", "Erie County, NY (BidNet)"),
            url="https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids",
            fixture_html=str(fixture),
        )

    assert "did not contain open solicitations" in str(error.value)


def test_generic_state_adapter_raises_verified_empty_when_the_page_says_so(tmp_path):
    fixture = tmp_path / "empty.html"
    fixture.write_text(
        "<html><head><title>Alabama State Procurement</title></head>"
        "<body><p>No results found.</p></body></html>",
        encoding="utf-8",
    )

    source = _source(
        "al_state_procurement",
        "Alabama State Procurement",
        state_code="AL",
        base_url="https://purchasing.alabama.gov/bids",
    )
    with pytest.raises(VerifiedEmptyListError) as error:
        fetch_generic_state_opportunities(source, fixture_html=str(fixture))

    assert error.value.tenant_confirmed is True


def test_hidden_empty_state_template_row_does_not_make_a_page_with_rows_empty():
    """BidNet renders an aria-hidden 'There are no open bids' row above the real rows."""
    from pathlib import Path

    from apsi_crawler.content_quality import detect_empty_list

    html = (Path(__file__).parent / "fixtures" / "bidnet_aurora_open_bids_with_hidden_empty_row.html").read_text(encoding="utf-8", errors="ignore")
    assert 'class="mets-table-row-empty" aria-hidden="true"' in html
    result = detect_empty_list(html, "City of Aurora, CO (BidNet)")
    assert result["detected"] is False


def test_display_none_and_hidden_attribute_markers_are_ignored():
    from apsi_crawler.content_quality import detect_empty_list

    html = (
        '<html><title>Erie County - Bids</title><body>'
        '<div style="display: none">There are no open bids at this time.</div>'
        '<p hidden>No open solicitations</p>'
        '<table><tr><td><a href="/solicitations/1234567">Road salt</a></td></tr></table>'
        '</body></html>'
    )
    assert detect_empty_list(html, "Erie County, NY (BidNet)")["detected"] is False
    visible = html.replace(' style="display: none"', "")
    assert detect_empty_list(visible, "Erie County, NY (BidNet)")["detected"] is True
