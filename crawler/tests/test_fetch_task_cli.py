import io
import json

from apsi_crawler import cli
from apsi_crawler.adapters import registry


def _run(payload, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    exit_code = cli.main(["fetch-task"])
    return exit_code, json.loads(capsys.readouterr().out)


def test_emits_success_payload_with_bids(monkeypatch, capsys):
    def adapter(source, query=None, limit=25, **kwargs):
        return [{"id": f"{source.id}:1", "title": "Road Repair", "source": source.source_label}]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "test_source", adapter)

    exit_code, result = _run(
        {
            "task_id": "tsk_1",
            "source_id": "test_source",
            "label": "Test Source",
            "state_code": "CA",
            "fetch_config": {"base_url": "https://example.gov"},
            "limit": 5,
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 0
    assert result["status"] == "success"
    assert result["taskId"] == "tsk_1"
    assert result["source"] == "test_source"
    assert len(result["bids"]) == 1


def test_empty_result_is_a_failure_not_a_success(monkeypatch, capsys):
    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "empty_source", lambda source, **kwargs: [])

    exit_code, result = _run(
        {
            "task_id": "tsk_2",
            "source_id": "empty_source",
            "label": "Empty Source",
            "state_code": "CA",
            "fetch_config": {},
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 1
    assert result["status"] == "failure"
    assert result["errorCode"] == "EmptyCrawlerResultError"


def test_missing_adapter_reports_adapter_not_found(monkeypatch, capsys):
    exit_code, result = _run(
        {
            "task_id": "tsk_3",
            "source_id": "no_such_source",
            "label": "No Such",
            "state_code": "CA",
            "provider_family": "no_such_platform",
            "fetch_config": {},
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 1
    assert result["status"] == "failure"
    assert result["errorCode"] == "AdapterNotFoundError"


def test_adapter_exception_is_reported_with_its_class_name(monkeypatch, capsys):
    def boom(source, **kwargs):
        raise TimeoutError("read timed out")

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "slow_source", boom)

    exit_code, result = _run(
        {
            "task_id": "tsk_4",
            "source_id": "slow_source",
            "label": "Slow",
            "state_code": "CA",
            "fetch_config": {},
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 1
    assert result["errorCode"] == "TimeoutError"
    assert "read timed out" in result["errorMessage"]
