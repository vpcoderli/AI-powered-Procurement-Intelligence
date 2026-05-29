from pathlib import Path

from apsi_crawler.sources.registry import get_live_fetcher, get_source
from apsi_crawler.spiders.or_oregonbuys import fetch_or_oregonbuys_opportunities
from apsi_crawler.spiders.pa_emarketplace import fetch_pa_emarketplace_opportunities
from apsi_crawler.spiders.sc_business_opportunities import (
    fetch_sc_business_opportunities,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_pa_emarketplace_html_fixture_extracts_detail_and_attachment_links():
    bids = fetch_pa_emarketplace_opportunities(
        get_source("pa_state_procurement"),
        query="network",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "pa_emarketplace_opportunities.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "6100061201"
    assert bid["title"] == "Network operations monitoring platform"
    assert bid["issuer_name"] == "Department of General Services"
    assert bid["deadline_date"] == "06/15/2026 02:00 PM"
    assert bid["published_date"] == "05/21/2026"
    assert bid["original_category"] == "Invitation for Bid"
    assert bid["source_url"] == "https://www.emarketplace.state.pa.us/Solicitations.aspx?SID=6100061201"
    assert bid["attachments"] == [
        {
            "name": "Specifications",
            "url": "https://www.emarketplace.state.pa.us/FileDownload.aspx?file=6100061201_specs.pdf",
            "size_label": None,
            "mime_type": None,
            "sort_order": 0,
        }
    ]


def test_pa_emarketplace_json_fixture_uses_same_normalized_shape():
    bids = fetch_pa_emarketplace_opportunities(
        get_source("pa_state_procurement"),
        query="mainframe",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "pa_emarketplace_live_response.json"),
    )

    assert len(bids) == 1
    assert bids[0]["source_bid_id"] == "6100061403"
    assert bids[0]["source_url"] == "https://www.emarketplace.state.pa.us/Solicitations.aspx?SID=6100061403"
    assert bids[0]["attachments"][0]["url"] == "https://www.emarketplace.state.pa.us/FileDownload.aspx?file=6100061403_rfi.pdf"


def test_pa_emarketplace_current_nested_table_extracts_live_shape(tmp_path):
    fixture = tmp_path / "pa-current.html"
    fixture.write_text(
        """
        <table>
          <tr><td>
            <table id="ctl00_MainBody_grdResults">
              <tr>
                <th>Solicitation #</th>
                <th>Types</th>
                <th>Solicitation Title</th>
                <th>Description</th>
                <th>Agency</th>
                <th>Solicitation Start Date</th>
                <th>Solicitation Due Date</th>
                <th>Bid Opening Date</th>
              </tr>
              <tr>
                <td><a href="/Solicitations.aspx?SID=6100062001">6100062001</a></td>
                <td>IFB</td>
                <td>Cloud storage services</td>
                <td>Object storage and backup services</td>
                <td>Department of General Services</td>
                <td>05/29/2026</td>
                <td>06/19/2026</td>
                <td>06/20/2026 10:00 AM</td>
              </tr>
              <tr><td></td><td></td><td></td></tr>
            </table>
          </td></tr>
        </table>
        """,
        encoding="utf-8",
    )

    bids = fetch_pa_emarketplace_opportunities(
        get_source("pa_state_procurement"),
        query="backup",
        limit=5,
        fixture_html=str(fixture),
    )

    assert len(bids) == 1
    assert bids[0]["source_bid_id"] == "6100062001"
    assert bids[0]["title"] == "Cloud storage services"
    assert bids[0]["description"] == "Object storage and backup services"
    assert bids[0]["source_url"] == "https://www.emarketplace.state.pa.us/Solicitations.aspx?SID=6100062001"


def test_sc_business_opportunities_html_fixture_combines_opening_date_and_time():
    bids = fetch_sc_business_opportunities(
        get_source("sc_state_procurement"),
        query="cybersecurity",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "sc_business_opportunities.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "5400028123"
    assert bid["title"] == "Cybersecurity risk assessment services"
    assert bid["deadline_date"] == "06/12/2026 11:00 AM"
    assert bid["published_date"] == "05/18/2026"
    assert bid["source_url"] == "https://procurement.sc.gov/bids/5400028123"
    assert bid["attachments"][0]["name"] == "Addendum 1"
    assert bid["attachments"][0]["url"] == "https://procurement.sc.gov/files/5400028123_addendum_1.pdf"


def test_sc_business_opportunities_json_fixture_extracts_attachment_links():
    bids = fetch_sc_business_opportunities(
        get_source("sc_state_procurement"),
        query="endpoint",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "sc_business_opportunities_live_response.json"),
    )

    assert len(bids) == 1
    assert bids[0]["source_bid_id"] == "5400028234"
    assert bids[0]["attachments"][0]["url"] == "https://procurement.sc.gov/files/5400028234_packet.pdf"


def test_or_oregonbuys_html_fixture_extracts_common_fields_and_attachment_links():
    bids = fetch_or_oregonbuys_opportunities(
        get_source("or_state_procurement"),
        query="cooling",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "or_oregonbuys_opportunities.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "S-10700-00011822"
    assert bid["title"] == "Regional data center cooling upgrade"
    assert bid["issuer_name"] == "Department of Administrative Services"
    assert bid["published_date"] == "05/20/2026"
    assert bid["deadline_date"] == "06/18/2026 03:00 PM"
    assert bid["original_category"] == "Information Technology"
    assert bid["source_url"] == "https://oregonbuys.gov/bso/external/bidDetail.sdo?docId=S-10700-00011822"
    assert bid["attachments"][0]["url"] == "https://oregonbuys.gov/bso/external/document/download?bidId=S-10700-00011822"


def test_or_oregonbuys_json_fixture_and_limit_are_supported():
    bids = fetch_or_oregonbuys_opportunities(
        get_source("or_state_procurement"),
        query="identity",
        limit=1,
        fixture_json=str(FIXTURES_DIR / "or_oregonbuys_live_response.json"),
    )

    assert len(bids) == 1
    assert bids[0]["source_bid_id"] == "S-10700-00011950"
    assert bids[0]["attachments"][0]["name"] == "Solicitation Packet"


def test_or_oregonbuys_current_rio_table_extracts_live_shape(tmp_path):
    fixture = tmp_path / "or-current.html"
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
            <td><a href="/bso/external/bidDetail.sda?docId=S-10700-00012001">S-10700-00012001</a></td>
            <td>Department of Administrative Services</td>
            <td>Data exchange platform</td>
            <td>06/18/2026 14:00:00</td>
            <td>Open</td>
          </tr>
        </table>
        """,
        encoding="utf-8",
    )

    bids = fetch_or_oregonbuys_opportunities(
        get_source("or_state_procurement"),
        query="exchange",
        limit=5,
        fixture_html=str(fixture),
    )

    assert len(bids) == 1
    assert bids[0]["source_bid_id"] == "S-10700-00012001"
    assert bids[0]["title"] == "Data exchange platform"
    assert bids[0]["issuer_name"] == "Department of Administrative Services"
    assert bids[0]["source_url"] == "https://oregonbuys.gov/bso/external/bidDetail.sda?docId=S-10700-00012001"


def test_selected_state_sources_are_registered_to_dedicated_fetchers():
    assert get_live_fetcher("pa_state_procurement") is fetch_pa_emarketplace_opportunities
    assert get_live_fetcher("sc_state_procurement") is fetch_sc_business_opportunities
    assert get_live_fetcher("or_state_procurement") is fetch_or_oregonbuys_opportunities
