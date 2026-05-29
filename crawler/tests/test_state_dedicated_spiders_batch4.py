from pathlib import Path

from apsi_crawler.sources.registry import get_source
from apsi_crawler.spiders.co_bidnet import fetch_co_bidnet_opportunities
from apsi_crawler.spiders.ct_ctsource import fetch_ct_ctsource_opportunities
from apsi_crawler.spiders.in_idoa import fetch_in_idoa_opportunities
from apsi_crawler.spiders.ks_esupplier import fetch_ks_esupplier_opportunities
from apsi_crawler.spiders.ms_contract_bid_search import (
    fetch_ms_contract_bid_search_opportunities,
)
from apsi_crawler.spiders.mt_emacs import fetch_mt_emacs_opportunities
from apsi_crawler.spiders.nm_spd import fetch_nm_spd_opportunities
from apsi_crawler.spiders.ut_bonfire import fetch_ut_bonfire_opportunities


FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_ut_bonfire_json_fixture_extracts_open_projects():
    bids = fetch_ut_bonfire_opportunities(
        get_source("ut_state_procurement"),
        query="neola",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "ut_bonfire_open_opportunities.json"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "NS26-142"
    assert bid["title"] == "NS26-142 Neola Water & Sewer District - Well & Waterline Improvements Project 2026"
    assert bid["deadline_date"] == "2026-05-29 16:00:00"
    assert bid["issuer_name"] == "Utah Bonfire"
    assert bid["source_url"] == "https://utah.bonfirehub.com/opportunities/236984"


def test_ks_esupplier_html_fixture_extracts_peoplesoft_rows():
    bids = fetch_ks_esupplier_opportunities(
        get_source("ks_state_procurement"),
        query="conference",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "ks_esupplier_opportunities.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "EVT0010778"
    assert bid["title"] == "Conference Planning Services"
    assert bid["issuer_name"] == "Ks Dept for Aging & Disab Svs"
    assert bid["published_date"] == "04/14/2026 08:57 AM CST"
    assert bid["deadline_date"] == "06/02/2026 02:00 PM CST"
    assert bid["source_url"] == "https://supplier.sok.ks.gov/psc/sokfsprdsup/SUPPLIER/ERP/c/SCP_PUBLIC_MENU_FL.SCP_PUB_BID_CMP_FL.GBL"


def test_mt_emacs_html_fixture_extracts_jaggaer_rows():
    bids = fetch_mt_emacs_opportunities(
        get_source("mt_state_procurement"),
        query="home health",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "mt_emacs_opportunities.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "HomeHealthServicesHomeBasedTherapyProvider"
    assert bid["title"] == "Home Health Services/Home Based Therapy Provider"
    assert bid["description"] == "MSF is seeking home health providers to provide services."
    assert bid["original_category"] == "Open"
    assert bid["source_url"] == "https://app01.jaggaer.com/apps/Router/ViewSourcingEvent?AuthToken=abc"


def test_nm_spd_html_fixture_extracts_active_procurements():
    bids = fetch_nm_spd_opportunities(
        get_source("nm_state_procurement"),
        query="tularosa",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "nm_spd_active_procurements.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "60-S0086-26-CP131"
    assert bid["title"].startswith("TULAROSA MUNICIPAL SCHOOL DISTRICT")
    assert bid["issuer_name"] == "S0086 - TULAROSA MUNICIPAL SCHOOLS"
    assert bid["deadline_date"] == "05/28/2026"
    assert bid["original_category"] == "SOLE SOURCE"


def test_co_bidnet_html_fixture_extracts_open_solicitations():
    bids = fetch_co_bidnet_opportunities(
        get_source("co_state_procurement"),
        query="hardware",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "co_bidnet_open_bids.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "0000425954"
    assert bid["title"] == "RFP 26-034 FNS Point-of-Sale Computer Hardware"
    assert bid["published_date"] == "05/28/2026"
    assert bid["deadline_date"] == "07/16/2026"
    assert bid["source_url"] == "https://www.bidnetdirect.com/colorado/solicitations/open-bids/RFP-26-034-FNS-Point-of-Sale-Computer-Hardware/0000425954?purchasingGroupId=8409951&origin=1"


def test_in_idoa_html_fixture_extracts_bid_documents():
    bids = fetch_in_idoa_opportunities(
        get_source("in_state_procurement"),
        query="ctsi",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "in_idoa_opportunities.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "004000000087584"
    assert bid["title"] == "400-27-113-CTSI Support RFQ"
    assert bid["issuer_name"] == "Indiana Dept of Health"
    assert bid["deadline_date"] == "05/28/2026 4:00:00PM EST"
    assert bid["contact_name"] == "Alexandra Stultz-00400"
    assert bid["attachments"][0]["name"] == "Bid Documents"
    assert bid["attachments"][0]["url"] == "https://www.in.gov/idoa/proc/solicitations/files/004000000087584.zip"


def test_ms_contract_bid_search_json_fixture_extracts_datatables_payload():
    bids = fetch_ms_contract_bid_search_opportunities(
        get_source("ms_state_procurement"),
        query="mail insertion",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "ms_contract_bid_search_response.json"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "45453"
    assert bid["title"].startswith("Sole Source No. 5003")
    assert bid["issuer_name"] == "Statewide"
    assert bid["deadline_date"] == "2026-06-09"
    assert bid["original_category"] == "Req. for Information"
    assert bid["contact_email"] == "VALERIE.LUCKETT@ITS.MS.GOV"
    assert bid["attachments"][0]["name"] == "Sole Source No. 5003 URL"


def test_ct_ctsource_json_fixture_extracts_webprocure_hits():
    bids = fetch_ct_ctsource_opportunities(
        get_source("ct_state_procurement"),
        query="warewashing",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "ct_ctsource_search_response.json"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "142657"
    assert bid["title"] == "Warewashing"
    assert bid["issuer_name"] == "West Hartford Nutrition Services"
    assert bid["original_category"] == "Request for Proposal"
    assert bid["published_date"] == "2026-05-27T14:00:00Z"
    assert bid["source_url"] == "https://webprocure.proactiscloud.com/wp-web-public/#/bidboard/bid/142657"
