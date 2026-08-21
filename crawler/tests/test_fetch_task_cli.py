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


def test_date_range_filters_bids_and_reports_stats(monkeypatch, capsys):
    def adapter(source, query=None, limit=25, **kwargs):
        return [
            {"id": "old", "title": "Old", "published_date": "2026-01-05"},
            {"id": "new", "title": "New", "published_date": "8/20/2026"},
            {"id": "undated", "title": "Undated", "published_date": None},
        ]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "windowed_source", adapter)

    exit_code, result = _run(
        {
            "task_id": "tsk_win_1",
            "source_id": "windowed_source",
            "label": "Windowed Source",
            "state_code": "CA",
            "fetch_config": {},
            "limit": 5,
            "date_range": {"from": "2026-08-01", "to": "2026-08-31"},
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 0
    assert result["status"] == "success"
    assert [b["id"] for b in result["bids"]] == ["new", "undated"]
    assert result["metadata"]["dateFilter"] == {
        "from": "2026-08-01",
        "to": "2026-08-31",
        "kept": 2,
        "dropped": 1,
        "unparsed": 1,
    }


def test_date_range_that_drops_everything_is_still_a_success(monkeypatch, capsys):
    def adapter(source, query=None, limit=25, **kwargs):
        return [{"id": "old", "title": "Old", "published_date": "2026-01-05"}]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "all_dropped_source", adapter)

    exit_code, result = _run(
        {
            "task_id": "tsk_win_2",
            "source_id": "all_dropped_source",
            "label": "All Dropped Source",
            "state_code": "CA",
            "fetch_config": {},
            "date_range": {"from": "2026-08-01"},
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 0
    assert result["status"] == "success"
    assert result["bids"] == []
    assert result["metadata"]["dateFilter"]["dropped"] == 1


def test_invalid_date_range_is_a_failure_with_clear_error_code(monkeypatch, capsys):
    def adapter(source, query=None, limit=25, **kwargs):
        return [{"id": "a", "title": "A", "published_date": "8/20/2026"}]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "bad_window_source", adapter)

    exit_code, result = _run(
        {
            "task_id": "tsk_win_3",
            "source_id": "bad_window_source",
            "label": "Bad Window Source",
            "state_code": "CA",
            "fetch_config": {},
            "date_range": {"from": "08/01/2026"},
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 1
    assert result["status"] == "failure"
    assert result["errorCode"] == "DateWindowError"


def test_null_date_range_keeps_existing_behavior(monkeypatch, capsys):
    def adapter(source, query=None, limit=25, **kwargs):
        return [{"id": "a", "title": "A", "published_date": "2026-01-05"}]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "no_window_source", adapter)

    exit_code, result = _run(
        {
            "task_id": "tsk_win_4",
            "source_id": "no_window_source",
            "label": "No Window Source",
            "state_code": "CA",
            "fetch_config": {},
            "date_range": None,
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 0
    assert len(result["bids"]) == 1
    assert "dateFilter" not in result["metadata"]
