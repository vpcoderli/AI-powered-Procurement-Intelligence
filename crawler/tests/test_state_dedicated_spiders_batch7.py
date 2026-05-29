from pathlib import Path

from apsi_crawler.sources.registry import get_source
from apsi_crawler.spiders.de_bids import fetch_de_bids_opportunities
from apsi_crawler.spiders.ri_ocean_state_procures import fetch_ri_ocean_state_procures_opportunities
from apsi_crawler.spiders.tn_edison import fetch_tn_edison_opportunities


FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_de_bids_json_fixture_extracts_open_contracts():
    bids = fetch_de_bids_opportunities(
        get_source("de_state_procurement"),
        query="dental",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "de_bids_open_response.json"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "DHR26011-DENTAL"
    assert bid["title"] == "State of Delaware's Group Dental Insurance"
    assert bid["issuer_name"] == "DHR"
    assert bid["published_date"] == "2026-05-28"
    assert bid["deadline_date"] == "2026-07-13"
    assert bid["contact_email"] == "pamela.barr@delaware.gov"
    assert bid["original_category"] == "8413"
    assert bid["source_url"] == "https://contracts.delaware.gov/Bids"


def test_ri_ocean_state_procures_json_fixture_extracts_open_solicitations():
    bids = fetch_ri_ocean_state_procures_opportunities(
        get_source("ri_state_procurement"),
        query="construction",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "ri_ocean_state_procures_response.json"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "OEV25004804"
    assert bid["title"] == "MPA 52 OE Construction Renovations Minor"
    assert bid["issuer_name"] == "State of Rhode Island"
    assert bid["original_category"] == "Open Enrollment Vendor Assessment"
    assert bid["source_url"] == (
        "https://webprocure.proactiscloud.com/wp-web-public/en/#/bidboard/bid/129259"
        "?customerid=46&oid=120002"
    )


def test_tn_edison_html_fixture_extracts_public_events():
    bids = fetch_tn_edison_opportunities(
        get_source("tn_state_procurement"),
        query="halm",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "tn_edison_open_events.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "0000013926"
    assert bid["title"] == "ITB 32101-13926 Halm Envelope Press"
    assert bid["issuer_name"] == "General Services"
    assert bid["published_date"] == "05/20/2026 01:31 PM CST"
    assert bid["deadline_date"] == "06/26/2026 02:00 PM CST"
    assert bid["original_category"] == "RFx"
    assert bid["source_url"].startswith("https://hub.edison.tn.gov/psc/fsprd/SUPPLIER/ERP/")
