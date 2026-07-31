from pathlib import Path

import pytest

from apsi_crawler.adapters.task import task_source_from_payload
from apsi_crawler.spiders.bonfire import BonfireError, fetch_bonfire_opportunities

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _make_source(tenant="louisvilleky", source_id="bonfire_ky_louisville"):
    return task_source_from_payload({
        "task_id": "t1",
        "source_id": source_id,
        "label": f"Louisville KY (Bonfire)",
        "state_code": "KY",
        "provider_family": "bonfire",
        "jurisdiction_level": "city",
        "fetch_config": {
            "tenant": tenant,
            "base_url": f"https://{tenant}.bonfirehub.com/portal/",
        },
    })


def test_parses_bonfire_fixture_into_normalized_bids():
    source = _make_source()
    bids = fetch_bonfire_opportunities(
        source,
        fixture_json=str(FIXTURES_DIR / "bonfire_sample.json"),
    )
    assert len(bids) == 2
    assert bids[0]["source_bid_id"] == "RFP-2026-042"
    assert bids[0]["title"] == "Louisville Metro Road Resurfacing Program 2026"
    assert "bonfirehub.com/opportunities/300001" in bids[0]["source_url"]
    assert bids[0]["state_code"] == "KY"


def test_respects_limit():
    source = _make_source()
    bids = fetch_bonfire_opportunities(
        source,
        limit=1,
        fixture_json=str(FIXTURES_DIR / "bonfire_sample.json"),
    )
    assert len(bids) == 1


def test_filters_by_query():
    source = _make_source()
    bids = fetch_bonfire_opportunities(
        source,
        query="road resurfacing",
        fixture_json=str(FIXTURES_DIR / "bonfire_sample.json"),
    )
    assert len(bids) == 1
    assert "Road Resurfacing" in bids[0]["title"]


def test_raises_when_tenant_is_missing():
    source = task_source_from_payload({
        "task_id": "t2",
        "source_id": "bonfire_ky_louisville",
        "label": "Louisville",
        "state_code": "KY",
        "provider_family": "bonfire",
        "fetch_config": {},
    })
    with pytest.raises(ValueError, match="fetch_config.tenant"):
        fetch_bonfire_opportunities(source, fixture_json=str(FIXTURES_DIR / "bonfire_sample.json"))


def test_raises_on_empty_response():
    source = _make_source()
    with pytest.raises(BonfireError, match="did not contain opportunities"):
        fetch_bonfire_opportunities(
            source,
            fixture_json=str(FIXTURES_DIR / "contracts" / "fetch_task_v1.json"),
        )
