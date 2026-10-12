"""P0-4: a backfill run prints at most its attempt budget of candidates, oldest attempt first."""

import io
import json

from apsi_crawler import cli


def _state_row(index):
    return {
        "id": f"old_source:{index:02d}", "source_bid_id": f"{index:02d}", "dedupe_key": f"old_source:{index:02d}",
        "source": "Old Source", "issuer_name": "County Roads Agency", "issuer_type": "county", "state_code": "CA",
        "title": f"Road repair {index:02d}", "description": "", "full_description": None,
        "source_url": f"https://public.example/bid/{index:02d}", "first_seen_at": f"2026-09-{index:02d}T00:00:00+00:00",
        "lifecycle_status": "closed", "is_active": 0, "raw_payload": {}, "attachments": [],
    }


def test_state_backfill_prints_at_most_its_attempt_budget_oldest_first(monkeypatch, capsys):
    monkeypatch.setattr(cli, "resolve_adapter", lambda *args: (_ for _ in ()).throw(AssertionError("must not fetch list")))
    request = {
        "task_id": "budget", "source_id": "old_source", "label": "Old Source", "state_code": "CA", "provider_family": "unknown",
        "jurisdiction_level": "county", "fetch_config": {"enrichment": {"max_details_per_run": 3}},
        "detail_history": [_state_row(index) for index in range(28, 0, -1)], "detail_backfill_only": True,
    }
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(request)))
    assert cli.main(["fetch-task"]) == 0
    output = json.loads(capsys.readouterr().out)
    assert [bid["id"] for bid in output["bids"]] == ["old_source:01", "old_source:02", "old_source:03"]


def test_sam_backfill_prints_at_most_max_descriptions_oldest_first(monkeypatch, capsys):
    monkeypatch.delenv("SAM_API_KEY", raising=False)
    rows = [{
        "id": f"sam_gov:n{index:02d}", "source_bid_id": f"n{index:02d}", "dedupe_key": f"sam_gov:n{index:02d}", "source": "SAM.gov",
        "issuer_name": "Department of the Interior", "issuer_type": "federal", "state_code": "US",
        "title": f"Trail maintenance {index:02d}", "description": "", "full_description": None,
        "source_url": f"https://sam.gov/opp/n{index:02d}/view", "first_seen_at": f"2026-09-{index:02d}T00:00:00+00:00",
        "raw_payload": {"description": f"https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=n{index:02d}"}, "attachments": [],
    } for index in range(10, 0, -1)]
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(rows)))
    assert cli.main(["fetch-sam-gov", "--output-json", "--posted-from", "09/01/2026", "--posted-to", "09/30/2026",
                     "--detail-history-stdin", "--detail-backfill-only", "--max-descriptions", "2"]) == 0
    output = json.loads(capsys.readouterr().out)
    assert [bid["id"] for bid in output["bids"]] == ["sam_gov:n01", "sam_gov:n02"]
