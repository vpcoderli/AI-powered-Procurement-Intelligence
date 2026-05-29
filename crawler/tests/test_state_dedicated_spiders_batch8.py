from pathlib import Path

import pytest

from apsi_crawler.sources.registry import get_source
from apsi_crawler.spiders.state_bidnet import (
    fetch_az_bidnet_opportunities,
    fetch_id_bidnet_opportunities,
    fetch_la_bidnet_opportunities,
    fetch_md_bidnet_opportunities,
    fetch_nc_bidnet_opportunities,
    fetch_nd_bidnet_opportunities,
    fetch_ne_bidnet_opportunities,
    fetch_vt_bidnet_opportunities,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.mark.parametrize(
    ("source_id", "fetcher", "query", "expected_bid_id", "expected_title", "expected_url"),
    [
        (
            "az_state_procurement",
            fetch_az_bidnet_opportunities,
            "emergency management",
            "444040762626",
            "DEMA Emergency Management Instructor Training (M26- 0011)",
            "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444040762626/abstract?purchasingGroupId=700132901&origin=1",
        ),
        (
            "id_state_procurement",
            fetch_id_bidnet_opportunities,
            "suicide prevention",
            "444040849343",
            "Idaho Youth Suicide Prevention Contractor, Education Regions 1 and 2",
            "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444040849343/abstract?purchasingGroupId=388537001&origin=1",
        ),
        (
            "la_state_procurement",
            fetch_la_bidnet_opportunities,
            "landscaping",
            "444040807952",
            "LANDSCAPING AND GRASS CUTTING FOR LPL",
            "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444040807952/abstract?purchasingGroupId=182875151&origin=1",
        ),
        (
            "md_state_procurement",
            fetch_md_bidnet_opportunities,
            "sludge",
            "444040689871",
            "Liquid Sludge Hauling Services for Wastewater Treatment Plants at Myersville and Hagerstown Central Region - SBR Procurement",
            "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444040689871/abstract?purchasingGroupId=182876351&origin=1",
        ),
        (
            "ne_state_procurement",
            fetch_ne_bidnet_opportunities,
            "roof",
            "444040689875",
            "DC Law Enforcement Center Roof Replacement",
            "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444040689875/abstract?purchasingGroupId=388538251&origin=1",
        ),
        (
            "nc_state_procurement",
            fetch_nc_bidnet_opportunities,
            "voltage",
            "0000425495",
            "Voltage Regulators",
            "https://www.bidnetdirect.com/north-carolina/solicitations/open-bids/Voltage-Regulators/0000425495?purchasingGroupId=6605801&origin=1",
        ),
        (
            "nd_state_procurement",
            fetch_nd_bidnet_opportunities,
            "133rd",
            "444040655553",
            "133rd Ave Reconstruction",
            "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444040655553/abstract?purchasingGroupId=845230801&origin=1",
        ),
        (
            "vt_state_procurement",
            fetch_vt_bidnet_opportunities,
            "wolcott",
            "444040849326",
            "North Wolcott road floodplain Restoration Project",
            "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444040849326/abstract?purchasingGroupId=845233301&origin=1",
        ),
    ],
)
def test_batch_eight_bidnet_fixture_extracts_state_open_bids(
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
        fixture_html=str(FIXTURES_DIR / "bidnet_batch8_open_bids.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == expected_bid_id
    assert bid["title"] == expected_title
    assert bid["source_url"] == expected_url
