from pathlib import Path

import pytest

from apsi_crawler.sources.registry import get_source
from apsi_crawler.spiders.state_bidnet import (
    fetch_mi_bidnet_opportunities,
    fetch_oh_bidnet_opportunities,
    fetch_sc_bidnet_opportunities,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.mark.parametrize(
    (
        "source_id",
        "fetcher",
        "query",
        "expected_bid_id",
        "expected_title",
        "expected_deadline",
        "expected_url",
    ),
    [
        (
            "mi_state_procurement",
            fetch_mi_bidnet_opportunities,
            "chip seal",
            "0000425930",
            "ADVERTISEMENT FOR BID PROPOSALS FOR LABOR AND MATERIAL TO CHIP SEAL/FOGSEAL PARK",
            "06/18/2026",
            "https://www.bidnetdirect.com/mitn/solicitations/open-bids/ADVERTISEMENT-FOR-BID-PROPOSALS-FOR-LABOR-AND-MATERIAL-TO-CHIP-SEAL-FOGSEAL-PARK/0000425930?purchasingGroupId=8412351&origin=1",
        ),
        (
            "sc_state_procurement",
            fetch_sc_bidnet_opportunities,
            "natatorium",
            "444040732596",
            "USC-Aiken Natatorium Locker Rooms & Deck Repairs",
            "06/24/2026",
            "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444040732596/abstract?purchasingGroupId=182877551&origin=1",
        ),
        (
            "oh_state_procurement",
            fetch_oh_bidnet_opportunities,
            "fire restoration",
            "444040849347",
            "Amedia Plaza Fire Restoration",
            "06/26/2026",
            "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444040849347/abstract?purchasingGroupId=12555501&origin=1",
        ),
    ],
)
def test_final_gap_bidnet_fixture_extracts_state_open_bids(
    source_id,
    fetcher,
    query,
    expected_bid_id,
    expected_title,
    expected_deadline,
    expected_url,
):
    bids = fetcher(
        get_source(source_id),
        query=query,
        limit=5,
        fixture_html=str(FIXTURES_DIR / "bidnet_final_gap_open_bids.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == expected_bid_id
    assert bid["title"] == expected_title
    assert bid["published_date"] == "05/28/2026"
    assert bid["deadline_date"] == expected_deadline
    assert bid["source_url"] == expected_url
