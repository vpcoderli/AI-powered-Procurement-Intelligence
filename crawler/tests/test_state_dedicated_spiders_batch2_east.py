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


def test_ma_commbuys_current_rio_table_extracts_live_shape(tmp_path):
    fixture = tmp_path / "ma-current.html"
    fixture.write_text(
        """
        <table>
          <tr>
            <th>Bid Solicitation #</th>
            <th>Organization Name</th>
            <th>Description</th>
            <th>Bid Opening Date</th>
            <th>Status</th>
          </tr>
          <tr>
            <td><a href="/bso/external/bidDetail.sda?docId=BD-26-1241-ARL03-ARL03-130019">BD-26-1241-ARL03-ARL03-130019</a></td>
            <td>Town of Arlington</td>
            <td>Traffic Signal and Street Light Maintenance</td>
            <td>06/11/2026 14:00:00</td>
            <td>Open</td>
          </tr>
        </table>
        """,
        encoding="utf-8",
    )

    bids = fetch_ma_commbuys_opportunities(
        get_source("ma_state_procurement"),
        query="traffic",
        limit=5,
        fixture_html=str(fixture),
    )

    assert len(bids) == 1
    assert bids[0]["source_bid_id"] == "BD-26-1241-ARL03-ARL03-130019"
    assert bids[0]["title"] == "Traffic Signal and Street Light Maintenance"
    assert bids[0]["issuer_name"] == "Town of Arlington"
    assert bids[0]["source_url"] == "https://www.commbuys.com/bso/external/bidDetail.sda?docId=BD-26-1241-ARL03-ARL03-130019"


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


def test_nj_start_current_rio_table_extracts_live_shape(tmp_path):
    fixture = tmp_path / "nj-current.html"
    fixture.write_text(
        """
        <table>
          <tr>
            <th>Bid Solicitation #</th>
            <th>Organization Name</th>
            <th>Description</th>
            <th>Bid Opening Date</th>
            <th>Status</th>
          </tr>
          <tr>
            <td><a href="/bso/external/bidDetail.sda?docId=26DPP00001">26DPP00001</a></td>
            <td>Division of Purchase and Property</td>
            <td>Endpoint telemetry services</td>
            <td>06/12/2026 11:00:00</td>
            <td>Open</td>
          </tr>
        </table>
        """,
        encoding="utf-8",
    )

    bids = fetch_nj_start_opportunities(
        get_source("nj_state_procurement"),
        query="telemetry",
        limit=5,
        fixture_html=str(fixture),
    )

    assert len(bids) == 1
    assert bids[0]["source_bid_id"] == "26DPP00001"
    assert bids[0]["title"] == "Endpoint telemetry services"
    assert bids[0]["source_url"] == "https://www.njstart.gov/bso/external/bidDetail.sda?docId=26DPP00001"


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


def test_va_eva_solr_json_extracts_current_public_opportunity_shape(tmp_path):
    fixture = tmp_path / "va-solr.json"
    fixture.write_text(
        """
        {
          "response": {
            "numFound": 1,
            "docs": [
              {
                "externalid": "121312",
                "internalid": "121312",
                "version": "0",
                "doccd": "IFB",
                "docdeptcd": "L034FREDCNTYSCH",
                "app": "IV",
                "shortdesc": "IFB 26015; Pest Management Services",
                "longdesc": "Provide pest management services.",
                "pubdate": "2026-05-28T18:19:33.200Z",
                "closedate": "2026-06-09T13:00:00Z",
                "agencyname": "Frederick County Public Schools",
                "category": "Non-professional Services - Non-Technology"
              }
            ]
          }
        }
        """,
        encoding="utf-8",
    )

    bids = fetch_va_eva_opportunities(
        get_source("va_state_procurement"),
        query="pest",
        limit=5,
        fixture_json=str(fixture),
    )

    assert len(bids) == 1
    assert bids[0]["source_bid_id"] == "121312"
    assert bids[0]["title"] == "IFB 26015; Pest Management Services"
    assert bids[0]["source_url"] == (
        "https://mvendor.cgieva.com/Vendor/public/IVDetails.jsp?"
        "PageTitle=SO%20Details&rfp_id_lot=121312&rfp_id_round=0"
    )
