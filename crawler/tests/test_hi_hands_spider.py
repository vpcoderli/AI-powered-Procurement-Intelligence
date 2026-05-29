from pathlib import Path

from apsi_crawler.sources.registry import get_source
from apsi_crawler.spiders.hi_hands import fetch_hi_hands_opportunities


FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_hi_hands_fixture_extracts_official_posted_opportunities():
    bids = fetch_hi_hands_opportunities(
        get_source("hi_state_procurement"),
        query="ho'opono",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "hi_hands_opportunities.json"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "12-33-7805"
    assert bid["title"] == "HO'OPONO BUILDINGS A AND B"
    assert bid["issuer_name"] == "Accounting & General Services"
    assert bid["published_date"] == "05/28/2026"
    assert bid["deadline_date"] == "07/02/2026 02:00 PM"
    assert bid["original_category"] == "Construction"
    assert bid["source_url"] == "https://hands.ehawaii.gov/hands/opportunities/opportunity-details/27117"
    assert bid["raw_payload"]["division"] == "Public Works"
