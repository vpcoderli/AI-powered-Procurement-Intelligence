import pytest

from apsi_crawler.adapters.task import TaskSource, task_source_from_payload
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


def test_builds_source_from_minimal_payload():
    source = task_source_from_payload(
        {
            "source_id": "ga_fulton_county",
            "label": "Fulton County",
            "state_code": "GA",
            "fetch_config": {"base_url": "https://fultoncountyga.bonfirehub.com"},
        }
    )

    assert source.id == "ga_fulton_county"
    assert source.source_label == "Fulton County"
    assert source.state_code == "GA"
    assert source.base_url == "https://fultoncountyga.bonfirehub.com"


def test_defaults_jurisdiction_and_validity_fields():
    source = task_source_from_payload(
        {"source_id": "x", "label": "X", "state_code": "CA", "fetch_config": {}}
    )

    assert source.jurisdiction == "state"
    assert source.adapter_kind == "platform"
    assert source.capabilities == ()
    assert source.trust_status == "beta"
    assert source.evidence_mode == "direct_portal"


def test_requires_source_id_and_label():
    with pytest.raises(ValueError):
        task_source_from_payload({"label": "X", "state_code": "CA", "fetch_config": {}})
    with pytest.raises(ValueError):
        task_source_from_payload({"source_id": "x", "state_code": "CA", "fetch_config": {}})


def test_is_accepted_by_the_existing_normalizer():
    source = TaskSource(
        id="ca_caleprocure",
        name="California Cal eProcure",
        source_label="California Cal eProcure",
        jurisdiction="state",
        state_code="CA",
        base_url="https://caleprocure.ca.gov",
    )

    normalized = normalize_state_opportunity(
        {"source_bid_id": "SB-1", "title": "Road Repair"}, source
    )

    assert normalized["id"] == "ca_caleprocure:SB-1"
    assert normalized["dedupe_key"] == "ca_caleprocure:SB-1"
    assert normalized["state_code"] == "CA"
    assert normalized["source"] == "California Cal eProcure"
