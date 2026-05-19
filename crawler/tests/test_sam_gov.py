from pathlib import Path

from apsi_crawler.spiders.sam_gov import load_fixture_opportunities


def test_load_fixture_opportunities():
    fixture = Path(__file__).parent / "fixtures" / "sam_gov_opportunities.json"
    bids = load_fixture_opportunities(fixture)

    assert len(bids) == 2
    assert bids[0]["source"] == "SAM.gov"
    assert bids[1]["source_bid_id"] == "def-456"
