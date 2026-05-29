from pathlib import Path

from apsi_crawler.sources.registry import get_source
from apsi_crawler.spiders.oh_procure import fetch_oh_procure_opportunities
from apsi_crawler.spiders.wa_des import fetch_wa_des_opportunities


FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_wa_des_html_fixture_extracts_common_fields_and_attachment_links():
    bids = fetch_wa_des_opportunities(
        get_source("wa_state_procurement"),
        query="identity",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "wa_des_opportunities.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "DES-2026-0815"
    assert bid["title"] == "Statewide identity verification services"
    assert bid["description"] == "Statewide identity verification services"
    assert bid["issuer_name"] == "Department of Enterprise Services"
    assert bid["published_date"] == "05/18/2026"
    assert bid["deadline_date"] == "06/17/2026 02:00 PM"
    assert bid["original_category"] == "Information Technology"
    assert bid["source_url"] == "https://pr-webs-vendor.des.wa.gov/bid/detail/DES-2026-0815"
    assert bid["attachments"] == [
        {
            "name": "Bid Packet",
            "url": "https://pr-webs-vendor.des.wa.gov/docs/DES-2026-0815_packet.pdf",
            "size_label": None,
            "mime_type": None,
            "sort_order": 0,
        }
    ]


def test_wa_des_json_fixture_uses_same_normalized_shape_and_limit():
    bids = fetch_wa_des_opportunities(
        get_source("wa_state_procurement"),
        query="cloud",
        limit=1,
        fixture_json=str(FIXTURES_DIR / "wa_des_live_response.json"),
    )

    assert len(bids) == 1
    assert bids[0]["source_bid_id"] == "DES-2026-0901"
    assert bids[0]["source_url"] == "https://pr-webs-vendor.des.wa.gov/bid/detail/DES-2026-0901"
    assert bids[0]["attachments"][0]["url"] == "https://pr-webs-vendor.des.wa.gov/docs/DES-2026-0901_scope.pdf"


def test_wa_des_bid_calendar_extracts_current_live_shape(tmp_path):
    fixture = tmp_path / "wa-bid-calendar.html"
    fixture.write_text(
        """
        <table>
          <tr>
            <th>Solicitation Close Date/ Amendment Date</th>
            <th>Title / Description</th>
            <th>Contact</th>
          </tr>
        </table>
        <table>
          <tr>
            <td>06/15/26</td>
            <td><a href="Search_BidDetails.aspx?ID=56933">Washington State Opportunity Zone Nominations Ref #: OZ2.0-04-2026</a></td>
            <td>Serena Grimes</td>
          </tr>
          <tr>
            <td colspan="3">Seeking nominations for opportunity zone designation.</td>
          </tr>
        </table>
        """,
        encoding="utf-8",
    )

    bids = fetch_wa_des_opportunities(
        get_source("wa_state_procurement"),
        query="opportunity",
        limit=5,
        fixture_html=str(fixture),
    )

    assert len(bids) == 1
    assert bids[0]["source_bid_id"] == "OZ2.0-04-2026"
    assert bids[0]["title"] == "Washington State Opportunity Zone Nominations"
    assert bids[0]["description"] == "Seeking nominations for opportunity zone designation."
    assert bids[0]["source_url"] == "https://pr-webs-vendor.des.wa.gov/Search_BidDetails.aspx?ID=56933"


def test_oh_procure_html_fixture_extracts_common_fields_and_attachment_links():
    bids = fetch_oh_procure_opportunities(
        get_source("oh_state_procurement"),
        query="network",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "oh_procure_opportunities.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "SRC0000026418"
    assert bid["title"] == "Managed network equipment refresh"
    assert bid["description"] == "Managed network equipment refresh"
    assert bid["issuer_name"] == "Department of Administrative Services"
    assert bid["published_date"] == "05/20/2026"
    assert bid["deadline_date"] == "06/19/2026 01:00 PM"
    assert bid["original_category"] == "IT Services"
    assert bid["source_url"] == "https://procure.ohio.gov/proc/viewProcOpps.asp?oppID=SRC0000026418"
    assert bid["attachments"][0]["name"] == "Solicitation"
    assert bid["attachments"][0]["url"] == "https://procure.ohio.gov/proc/files/SRC0000026418_solicitation.pdf"


def test_oh_procure_json_fixture_extracts_attachment_links():
    bids = fetch_oh_procure_opportunities(
        get_source("oh_state_procurement"),
        query="endpoint",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "oh_procure_live_response.json"),
    )

    assert len(bids) == 1
    assert bids[0]["source_bid_id"] == "SRC0000026577"
    assert bids[0]["attachments"][0]["name"] == "Request for Quotes"
    assert bids[0]["attachments"][0]["url"] == "https://procure.ohio.gov/proc/files/SRC0000026577_rfq.pdf"
