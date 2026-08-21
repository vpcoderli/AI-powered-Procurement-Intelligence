import io
import json
from pathlib import Path

from apsi_crawler import cli
from apsi_crawler.adapters import registry
from apsi_crawler.adapters.task import task_source_from_payload

CONTRACT_PATH = Path(__file__).parent / "fixtures" / "contracts" / "fetch_task_v1.json"


def test_python_can_consume_the_node_generated_contract():
    """NOTE: the jurisdiction assertion below is not discriminating for this fixture --
    payload["jurisdiction_level"] is "state", which is also task.py's own fallback
    default (`payload.get("jurisdiction_level") or "state"`), so a renamed key would
    silently reproduce the same value here. See
    test_fetch_task_reads_every_directly_read_field_by_its_real_key below, which uses a
    non-default value to close that gap for real.
    """
    payload = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    source = task_source_from_payload(payload)

    assert source.id == payload["source_id"]
    assert source.source_label == payload["label"]
    assert source.state_code == payload["state_code"]
    assert source.base_url == payload["fetch_config"]["base_url"]
    assert source.jurisdiction == payload["jurisdiction_level"]


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
        "date_range",
    ):
        assert key in payload, f"contract fixture is missing {key}"


def test_fetch_task_echoes_task_id_from_the_contract_payload(monkeypatch, capsys):
    """Drive the real fetch_task CLI path with the committed contract fixture (not a
    second dict lookup, which would prove nothing) so a key rename in cli.py -- e.g.
    payload.get("taskId") instead of payload.get("task_id") -- actually fails this test.

    limit and query are asserted too, but they are NOT discriminating for this
    particular fixture: fetch_task's own fallback behaviour
    (`int(payload.get("limit") or 25)`, and `payload.get("query")` defaulting to None)
    happens to produce the exact same values the fixture already carries (limit=25,
    query=null). A renamed key would silently reproduce these values here. task_id has
    no such fallback, so the taskId assertion below is the one that is genuinely
    protected by this test. See
    test_fetch_task_reads_every_directly_read_field_by_its_real_key below for value
    choices that close that gap for limit/query/provider_family/jurisdiction_level.
    """
    payload = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    seen = {}

    def adapter(source, query=None, limit=25, **kwargs):
        seen["query"] = query
        seen["limit"] = limit
        return [{"id": f"{source.id}:1", "title": "stub", "source": source.source_label}]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, payload["source_id"], adapter)
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))

    exit_code = cli.main(["fetch-task"])
    result = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert result["status"] == "success"
    assert result["taskId"] == payload["task_id"]
    assert seen["limit"] == payload["limit"]
    assert seen["query"] == payload["query"]


def test_fetch_task_reads_every_directly_read_field_by_its_real_key(monkeypatch, capsys):
    """The committed contract fixture cannot prove limit, query, provider_family, or
    jurisdiction_level are read under their correct keys, because its own sample values
    collide with fallback/short-circuit behaviour on the Python side:

    - limit=25 in the fixture equals fetch_task's own `or 25` fallback default, so a
      renamed key ("Limit") would silently produce the identical value.
    - query=null in the fixture equals the default when the key is absent entirely, so
      a renamed key ("Query") would also silently produce the identical value.
    - jurisdiction_level="state" in the fixture equals task.py's own
      `payload.get("jurisdiction_level") or "state"` fallback default, so a renamed key
      ("jurisdictionLevel") would silently produce the identical value.
    - provider_family=null is never even consulted for this fixture's source_id
      ("ca_caleprocure"): resolve_adapter() checks DEDICATED_ADAPTERS by source_id
      FIRST and returns on a hit, before provider_family is read at all.

    Each collision was confirmed empirically (not just reasoned about) by temporarily
    renaming the corresponding key read in cli.py / task.py and re-running this file:
    test_fetch_task_echoes_task_id_from_the_contract_payload above kept passing in every
    case, proving the fixture-driven test alone is blind to these four renames.

    This test uses a locally-built payload -- same field names as the contract, but
    values chosen to differ from every fallback/short-circuit -- so each of the four
    keys is load-bearing: reading the wrong key changes the outcome, and the same
    renames all fail this test.
    """
    payload = {
        "task_id": "tsk_field_probe",
        "source_id": "zz_probe_platform_source",  # deliberately not in DEDICATED_ADAPTERS
        "label": "Contract Field Probe",
        "state_code": "CO",
        "provider_family": "bidnet",
        "jurisdiction_level": "county",  # distinct from task.py's "state" fallback
        "fetch_config": {"base_url": "https://example.gov"},
        "limit": 7,
        "query": "road repair",
    }
    seen = {}

    def probe_adapter(source, query=None, limit=25, **kwargs):
        seen["query"] = query
        seen["limit"] = limit
        seen["jurisdiction"] = source.jurisdiction
        return [{"id": "probe:1", "title": "stub", "source": source.source_label}]

    # Only the "bidnet" platform adapter is stubbed. If provider_family were read under
    # the wrong key, resolve_adapter would see provider_family=None for a source_id with
    # no dedicated adapter and raise AdapterNotFoundError instead of reaching this stub.
    monkeypatch.setitem(registry.PLATFORM_ADAPTERS, "bidnet", probe_adapter)
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))

    exit_code = cli.main(["fetch-task"])
    result = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert result["status"] == "success"
    assert result["metadata"]["adapter"] == "probe_adapter"
    assert seen["limit"] == 7
    assert seen["query"] == "road repair"
    assert seen["jurisdiction"] == "county"
