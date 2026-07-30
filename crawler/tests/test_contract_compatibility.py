import json
from pathlib import Path

from apsi_crawler.adapters.task import task_source_from_payload

CONTRACT_PATH = Path(__file__).parent / "fixtures" / "contracts" / "fetch_task_v1.json"


def test_python_can_consume_the_node_generated_contract():
    payload = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    source = task_source_from_payload(payload)

    assert source.id == payload["source_id"]
    assert source.source_label == payload["label"]
    assert source.state_code == payload["state_code"]
    assert source.base_url == payload["fetch_config"]["base_url"]


def test_contract_carries_every_field_the_worker_needs():
    payload = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    for key in (
        "task_id",
        "source_id",
        "label",
        "state_code",
        "provider_family",
        "jurisdiction_level",
        "fetch_config",
        "limit",
        "query",
    ):
        assert key in payload, f"contract fixture is missing {key}"
