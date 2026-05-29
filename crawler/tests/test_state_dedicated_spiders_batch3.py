from pathlib import Path

from apsi_crawler.sources.registry import get_source
from apsi_crawler.spiders.ga_procurement_registry import (
    fetch_ga_procurement_registry_opportunities,
)
from apsi_crawler.spiders.ia_bid_opportunities import (
    fetch_ia_bid_opportunities,
)
from apsi_crawler.spiders.me_rfps import fetch_me_rfp_opportunities
from apsi_crawler.spiders.mo_bid_listing import fetch_mo_bid_listing_opportunities
from apsi_crawler.spiders.nv_epro import fetch_nv_epro_opportunities


FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_ia_bid_opportunities_json_fixture_extracts_current_public_api_shape():
    bids = fetch_ia_bid_opportunities(
        get_source("ia_state_procurement"),
        query="traffic",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "ia_bid_opportunities_live_response.json"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "358"
    assert bid["title"] == "2026 Statewide On-Call Traffic Engineering Services"
    assert bid["issuer_name"] == "Transportation"
    assert bid["published_date"] == "2026-05-20"
    assert bid["deadline_date"] == "2026-06-17"
    assert bid["original_category"] == "Open"
    assert bid["contact_name"] == "Adam Haar"
    assert bid["contact_email"] == "adam.haar@iowadot.us"
    assert bid["source_url"] == (
        "https://bidopportunities.iowa.gov/Home/BidInfo?"
        "bidId=b6ba764c-efe5-4b24-be9f-0a805d2e0010"
    )


def test_ga_procurement_registry_json_fixture_extracts_event_search_shape():
    bids = fetch_ga_procurement_registry_opportunities(
        get_source("ga_state_procurement"),
        query="hauling",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "ga_procurement_registry_live_response.json"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "PE-65600-NONST-2027-000000233"
    assert bid["title"] == "26138-A Annual Hauling"
    assert bid["issuer_name"] == "Fayette County Board Of Commissioners"
    assert bid["published_date"] == "May 18, 2026 @ 01:54 PM"
    assert bid["deadline_date"] == "May 29, 2026 @ 08:00 AM"
    assert bid["original_category"] == "Non-State Agency"
    assert bid["source_url"] == (
        "https://ssl.doas.state.ga.us/gpr/eventDetails?"
        "eSourceNumber=PE-65600-NONST-2027-000000233&sourceSystemType=gpr20"
    )


def test_me_rfp_html_fixture_extracts_public_rfp_table():
    bids = fetch_me_rfp_opportunities(
        get_source("me_state_procurement"),
        query="building",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "me_rfps.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "202508117"
    assert bid["title"] == "Building Management Services"
    assert bid["issuer_name"] == "SMJB"
    assert bid["published_date"] == "08/25/2025"
    assert bid["deadline_date"] == "09/25/2025"
    assert bid["original_category"] == "Closed - Evaluation of Proposals"
    assert bid["source_url"] == "https://www.maine.gov/dafs/bbm/procurementservices/vendors/rfps"
    assert bid["attachments"][0]["name"] == "Amendment #1 and Q&A Summary"


def test_mo_bid_listing_html_fixture_extracts_projects_and_bid_documents():
    bids = fetch_mo_bid_listing_opportunities(
        get_source("mo_state_procurement"),
        query="windows",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "mo_bid_listing.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "H2502-01"
    assert bid["title"] == (
        "Replace Exterior Windows & Doors, Core Building "
        "Gentry Residential Treatment Center Cabool"
    )
    assert bid["deadline_date"] == "7/2/2026"
    assert bid["source_url"] == "https://oa.mo.gov/facilities/bid-opportunities/bid-listing-electronic-plans"
    assert bid["attachments"][0]["name"] == "Bid Forms Invitation for Bid Plans Specifications Planholders List"
    assert bid["attachments"][0]["url"] == "https://oa.mo.gov/facilities/bid-opportunities/H2502-01-plans.pdf"


def test_nv_epro_html_fixture_extracts_rio_table_shape():
    bids = fetch_nv_epro_opportunities(
        get_source("nv_state_procurement"),
        query="utility",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "nv_epro_opportunities.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "CTYNLV-S3899"
    assert bid["title"] == "NGEM-RFP 2026-018 Utility Department Collection Agency Services"
    assert bid["issuer_name"] == "City of North Las Vegas"
    assert bid["deadline_date"] == "06/23/2026 13:00:00"
    assert bid["original_category"] == "Sent"
    assert bid["source_url"] == (
        "https://www.nevadaepro.com/bso/external/bidDetail.sda?docId=CTYNLV-S3899"
    )
