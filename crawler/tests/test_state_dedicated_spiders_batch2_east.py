from pathlib import Path

from apsi_crawler.sources.registry import get_source
from apsi_crawler.spiders.ma_commbuys import fetch_ma_commbuys_opportunities
from apsi_crawler.spiders.nj_start import fetch_nj_start_opportunities
from apsi_crawler.spiders.va_eva import fetch_va_eva_opportunities


FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_ma_commbuys_html_fixture_extracts_detail_and_attachment_links():
    bids = fetch_ma_commbuys_opportunities(
        get_source("ma_state_procurement"),
        query="identity",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "ma_commbuys_opportunities.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "BD-26-1040-ITD00-ITD01-11111"
    assert bid["title"] == "Identity access management modernization"
    assert bid["issuer_name"] == "Executive Office of Technology Services"
    assert bid["published_date"] == "05/19/2026"
    assert bid["deadline_date"] == "06/22/2026 02:00 PM"
    assert bid["original_category"] == "Information Technology"
    assert bid["source_url"] == "https://www.commbuys.com/bso/external/bidDetail.sdo?docId=BD-26-1040-ITD00-ITD01-11111"
    assert bid["attachments"] == [
        {
            "name": "Bid Package",
            "url": "https://www.commbuys.com/bso/external/document/download?bidId=BD-26-1040-ITD00-ITD01-11111",
            "size_label": None,
            "mime_type": None,
            "sort_order": 0,
        }
    ]


def test_ma_commbuys_json_fixture_uses_same_normalized_shape():
    bids = fetch_ma_commbuys_opportunities(
        get_source("ma_state_procurement"),
        query="network",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "ma_commbuys_live_response.json"),
    )

    assert len(bids) == 1
    assert bids[0]["source_bid_id"] == "BD-26-1040-ITD00-ITD01-22222"
    assert bids[0]["source_url"] == "https://www.commbuys.com/bso/external/bidDetail.sdo?docId=BD-26-1040-ITD00-ITD01-22222"
    assert bids[0]["attachments"][0]["name"] == "Technical Requirements"


def test_nj_start_html_fixture_extracts_common_fields_and_attachment_links():
    bids = fetch_nj_start_opportunities(
        get_source("nj_state_procurement"),
        query="endpoint",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "nj_start_opportunities.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "25DPP01024"
    assert bid["title"] == "Endpoint protection managed services"
    assert bid["issuer_name"] == "Division of Purchase and Property"
    assert bid["published_date"] == "05/20/2026"
    assert bid["deadline_date"] == "06/24/2026 10:00 AM"
    assert bid["original_category"] == "Technology"
    assert bid["source_url"] == "https://www.njstart.gov/bso/external/bidDetail.sdo?docId=25DPP01024"
    assert bid["attachments"][0]["url"] == "https://www.njstart.gov/bso/external/document/download?bidId=25DPP01024"


def test_nj_start_json_fixture_and_limit_are_supported():
    bids = fetch_nj_start_opportunities(
        get_source("nj_state_procurement"),
        query="records",
        limit=1,
        fixture_json=str(FIXTURES_DIR / "nj_start_live_response.json"),
    )

    assert len(bids) == 1
    assert bids[0]["source_bid_id"] == "25DPP01088"
    assert bids[0]["attachments"][0]["url"] == "https://www.njstart.gov/bso/external/document/download?bidId=25DPP01088"


def test_va_eva_html_fixture_extracts_detail_and_attachment_links():
    bids = fetch_va_eva_opportunities(
        get_source("va_state_procurement"),
        query="cloud",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "va_eva_opportunities.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "RFP 306-26-001"
    assert bid["title"] == "Cloud migration planning services"
    assert bid["issuer_name"] == "Virginia Information Technologies Agency"
    assert bid["published_date"] == "05/21/2026"
    assert bid["deadline_date"] == "06/26/2026 03:00 PM"
    assert bid["original_category"] == "Professional Services"
    assert bid["source_url"] == "https://eva.virginia.gov/solicitations/RFP-306-26-001"
    assert bid["attachments"][0]["name"] == "RFP Documents"


def test_va_eva_json_fixture_extracts_attachment_links():
    bids = fetch_va_eva_opportunities(
        get_source("va_state_procurement"),
        query="data warehouse",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "va_eva_live_response.json"),
    )

    assert len(bids) == 1
    assert bids[0]["source_bid_id"] == "IFB 501-26-014"
    assert bids[0]["attachments"][0]["url"] == "https://eva.virginia.gov/documents/IFB-501-26-014.pdf"
