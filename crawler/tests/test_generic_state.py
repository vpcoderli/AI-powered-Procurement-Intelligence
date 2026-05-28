from pathlib import Path

from apsi_crawler.sources.registry import get_source
from apsi_crawler.spiders.generic_state import fetch_generic_state_opportunities


FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_generic_state_fetcher_extracts_public_procurement_table_fixture():
    bids = fetch_generic_state_opportunities(
        get_source("al_state_procurement"),
        query="cabling",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "generic_state_procurement.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source"] == "Alabama State Procurement"
    assert bid["source_bid_id"] == "AL-2026-001"
    assert bid["dedupe_key"] == "al_state_procurement:AL-2026-001"
    assert bid["title"] == "Data center cabling services"
    assert bid["issuer_name"] == "Alabama Department of Finance"
    assert bid["state_code"] == "AL"
    assert bid["source_url"] == "https://purchasing.alabama.gov/bids/AL-2026-001"


def test_generic_state_fetcher_returns_zero_rows_when_fixture_has_no_matching_table(tmp_path):
    fixture = tmp_path / "empty.html"
    fixture.write_text("<html><body>No open bids</body></html>", encoding="utf-8")

    bids = fetch_generic_state_opportunities(
        get_source("wa_state_procurement"),
        query=None,
        limit=5,
        fixture_html=str(fixture),
    )

    assert bids == []
