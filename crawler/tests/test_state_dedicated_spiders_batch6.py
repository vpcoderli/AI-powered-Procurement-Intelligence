from pathlib import Path

import pytest

from apsi_crawler.sources.registry import get_source
from apsi_crawler.spiders.state_bidnet import (
    fetch_ak_bidnet_opportunities,
    fetch_al_bidnet_opportunities,
    fetch_ky_bidnet_opportunities,
    fetch_mn_bidnet_opportunities,
    fetch_nh_bidnet_opportunities,
    fetch_wi_bidnet_opportunities,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.mark.parametrize(
    ("source_id", "fetcher", "query", "expected_bid_id", "expected_title", "expected_url"),
    [
        (
            "al_state_procurement",
            fetch_al_bidnet_opportunities,
            "cedar point",
            "0000425806",
            "New Hope - Cedar Point Road Bridge Replacement",
            "https://www.bidnetdirect.com/alabama/solicitations/open-bids/New-Hope-Cedar-Point-Road-Bridge-Replacement/0000425806?purchasingGroupId=388530651&origin=1",
        ),
        (
            "ak_state_procurement",
            fetch_ak_bidnet_opportunities,
            "kenaitze",
            "444040844243",
            "KENAITZE POINTE MECHANICAL SYSTEMS UPGRADE",
            "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444040844243/abstract?purchasingGroupId=845217101&origin=1",
        ),
        (
            "ky_state_procurement",
            fetch_ky_bidnet_opportunities,
            "hvac",
            "444040844235",
            "RFB-282-26 KSP Post 2 HVAC Repair/Replacement",
            "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444040844235/abstract?purchasingGroupId=388535751&origin=1",
        ),
        (
            "mn_state_procurement",
            fetch_mn_bidnet_opportunities,
            "asset management",
            "444041074181",
            "Multifamily Compliance and Asset Management Guide Consulting Services",
            "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444041074181/abstract?purchasingGroupId=700134101&origin=1",
        ),
        (
            "wi_state_procurement",
            fetch_wi_bidnet_opportunities,
            "engineering",
            "444041074183",
            "Engineering On-call Master Service Agreement",
            "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444041074183/abstract?purchasingGroupId=700140101&origin=1",
        ),
        (
            "nh_state_procurement",
            fetch_nh_bidnet_opportunities,
            "soccer",
            "444040732574",
            "Design-Build Soccer Field Conversion",
            "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444040732574/abstract?purchasingGroupId=845229551&origin=1",
        ),
    ],
)
def test_batch_six_bidnet_fixture_extracts_state_open_bids(
    source_id,
    fetcher,
    query,
    expected_bid_id,
    expected_title,
    expected_url,
):
    bids = fetcher(
        get_source(source_id),
        query=query,
        limit=5,
        fixture_html=str(FIXTURES_DIR / "bidnet_batch6_open_bids.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == expected_bid_id
    assert bid["title"] == expected_title
    assert bid["published_date"] == "05/28/2026"
    assert bid["deadline_date"] == "06/09/2026"
    assert bid["source_url"] == expected_url
