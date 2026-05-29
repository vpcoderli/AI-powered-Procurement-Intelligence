from pathlib import Path

from apsi_crawler.sources.registry import get_source
from apsi_crawler.spiders.ar_procurement import fetch_ar_procurement_opportunities
from apsi_crawler.spiders.ok_esupplier import fetch_ok_esupplier_opportunities
from apsi_crawler.spiders.sd_esm import fetch_sd_esm_opportunities
from apsi_crawler.spiders.wv_bidnet import fetch_wv_bidnet_opportunities
from apsi_crawler.spiders.wy_ai_bids import fetch_wy_ai_bid_opportunities


FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_ok_esupplier_html_fixture_extracts_open_events():
    bids = fetch_ok_esupplier_opportunities(
        get_source("ok_state_procurement"),
        query="screener",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "ok_esupplier_opportunities.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "EV00000893"
    assert bid["title"] == "Written Expression Screener - RFI"
    assert bid["issuer_name"] == "Department of Education"
    assert bid["published_date"] == "05/15/2026 04:35 PM CST"
    assert bid["deadline_date"] == "05/29/2026 03:00 PM CST"
    assert bid["original_category"] == "RFx"


def test_ar_procurement_html_fixture_extracts_current_solicitations():
    bids = fetch_ar_procurement_opportunities(
        get_source("ar_state_procurement"),
        query="dental",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "ar_procurement_current_solicitations.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "S000000494"
    assert bid["title"] == "Dental Services"
    assert bid["issuer_name"] == "Arkansas Department of Human Services"
    assert bid["deadline_date"] == "06/05/2026 10:00 AM CDT"
    assert bid["contact_email"] == "Joshua.williams@arkansas.gov"
    assert bid["source_url"] == "https://www.arkansas.gov/tss/procurement/bids/bid_info.php?bid_number=S000000494"


def test_sd_esm_json_fixture_extracts_current_events():
    bids = fetch_sd_esm_opportunities(
        get_source("sd_state_procurement"),
        query="pouring rights",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "sd_esm_current_events.json"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "19802"
    assert bid["title"] == "Pouring Rights and Vending Services for South Dakota State Univ."
    assert bid["issuer_name"] == "South Dakota ESM Posting Board"
    assert bid["published_date"] == "2026-05-21T14:03:24.807"
    assert bid["deadline_date"] == "2026-05-29T19:00:00"
    assert bid["original_category"] == "Invitation Only"
    assert bid["source_url"] == "https://postingboard.esmsolutions.com/3444a404-3818-494f-84c5-2a850acd7779/eventDetail/19802"


def test_wy_ai_csv_fixture_extracts_bid_status_rows():
    bids = fetch_wy_ai_bid_opportunities(
        get_source("wy_state_procurement"),
        query="tourism",
        limit=5,
        fixture_csv=str(FIXTURES_DIR / "wy_ai_bid_status.csv"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "0016-M"
    assert bid["title"] == "Tourism Board Travel Guide"
    assert bid["issuer_name"] == "Tourism Board"
    assert bid["published_date"] == "7/23/2025"
    assert bid["deadline_date"] == "8/28/2025"
    assert bid["contact_email"] == "kristy.simola1@wyo.gov"
    assert bid["original_category"] == "Pending"


def test_wv_bidnet_html_fixture_extracts_open_solicitations():
    bids = fetch_wv_bidnet_opportunities(
        get_source("wv_state_procurement"),
        query="gravel",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "wv_bidnet_open_bids.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "444040954676"
    assert bid["title"] == "River Gravel and Limestone Aggregates"
    assert bid["published_date"] == "05/28/2026"
    assert bid["deadline_date"] == "06/09/2026"
    assert bid["source_url"] == "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444040954676/abstract?purchasingGroupId=388531901&origin=1"
