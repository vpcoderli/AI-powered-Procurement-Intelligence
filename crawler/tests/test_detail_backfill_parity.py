"""A backfill candidate the run cannot attempt cools down instead of holding one of the run's few slots.

The parent selects only due candidates, oldest attempt first, up to the attempt budget. A row the
crawler skips without an attempt keeps its old attempt time, so unless its retry time moves it is
selected first again on every run.
"""

import io
import json

import pytest

from apsi_crawler import cli
from apsi_crawler.detail_backfill import record_outcome
from apsi_crawler.enrichment import enrich_bids
from apsi_crawler.spiders.sam_gov_api import enrich_sam_gov_bids
from test_enrichment import FakeExtractor, FakeResponse, FakeSession
from test_sam_gov_api import FakeResponse as SamResponse, FakeSession as SamSession

RUN = "2026-10-12T00:00:00+00:00"
NEXT_RUN = "2026-10-12T01:00:00+00:00"
A_DAY_LATER = "2026-10-13T00:00:00+00:00"
EARLIER = {"attempt_count": 2, "attempted_at": "2026-09-01T00:00:00+00:00", "next_retry_at": "2026-09-01T01:00:00+00:00"}


def _with_outcome(outcome):
    return {"title": "Road repair", "description": "", "raw_payload": {"enrichment": {"outcome": dict(outcome)}}}


@pytest.mark.parametrize("status, reason", [
    ("not_needed", "missing_detail_url"),
    ("not_needed", "complete"),
    ("restricted", "untrusted_description_url"),
    ("not_configured", "description_endpoint_missing"),
])
def test_a_backfill_candidate_the_run_cannot_attempt_waits_a_day(status, reason):
    outcome = record_outcome(_with_outcome(EARLIER), status, reason, RUN, backfill=True)
    assert outcome["next_retry_at"] == A_DAY_LATER
    # Still no new attempt: the last real attempt and its count stand.
    assert (outcome["attempted_at"], outcome["attempt_count"]) == (EARLIER["attempted_at"], 2)


@pytest.mark.parametrize("status, reason, backfill", [
    # List runs see the row again anyway; the cooldown belongs to the backfill queue.
    ("not_needed", "missing_detail_url", False),
    ("restricted", "untrusted_description_url", False),
    # A row over this run's budget, or still cooling down, is next in line as it is.
    ("budget", "budget_exhausted", True),
    ("deferred", "cooldown", True),
])
def test_other_unattempted_outcomes_keep_their_retry_time(status, reason, backfill):
    outcome = record_outcome(_with_outcome(EARLIER), status, reason, RUN, backfill=backfill)
    assert outcome["next_retry_at"] == EARLIER["next_retry_at"]


def test_a_missing_sam_api_key_stays_a_one_hour_cooldown_in_backfill():
    # Configuration, not the row: every candidate is retried once the key is set.
    outcome = record_outcome(_with_outcome(EARLIER), "not_configured", "sam_api_key_not_configured", RUN, backfill=True)
    assert outcome["next_retry_at"] == "2026-10-12T01:00:00+00:00"


LIST_PAGE = "https://www.bidnetdirect.com/colorado/county-portal/solicitations/open-bids"
LATER_DETAIL = "https://www.bidnetdirect.com/colorado/county-portal/solicitations/later-bid"


def _county_row(key, first_seen_at, source_url):
    return {
        "id": f"county_portal:{key}", "source_bid_id": key, "dedupe_key": f"county_portal:{key}", "source": "County Portal",
        "issuer_name": "County Roads Agency", "issuer_type": "county", "state_code": "CO", "title": f"Road repair {key}",
        "description": "", "full_description": None, "source_url": source_url, "first_seen_at": first_seen_at,
        "raw_payload": {}, "attachments": [],
    }


def _state_backfill(monkeypatch, capsys, history, timestamp, session):
    monkeypatch.setattr(cli, "now_iso", lambda: timestamp)
    monkeypatch.setattr(cli, "enrich_bids", lambda bids, source, fetch_config, **options: enrich_bids(
        bids, source, fetch_config, extractor=FakeExtractor(), session=session, now=lambda: timestamp, **options))
    request = {
        "task_id": "parity", "source_id": "county_portal", "label": "County Portal", "state_code": "CO", "provider_family": "bidnet",
        "jurisdiction_level": "county", "detail_history": history, "detail_backfill_only": True,
        "fetch_config": {"base_url": LIST_PAGE, "enrichment": {
            "enabled": True, "fields": ["description"], "max_details_per_run": 1, "min_interval_seconds": 0}},
    }
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(request)))
    assert cli.main(["fetch-task"]) == 0
    return json.loads(capsys.readouterr().out)["bids"]


def test_a_candidate_without_a_detail_url_stops_holding_the_only_slot(monkeypatch, capsys):
    # The list page with a trailing slash passes the history filter, yet enrichment finds no detail URL in it.
    persisted = {row["id"]: row for row in [
        _county_row("unfetchable", "2026-09-01T00:00:00+00:00", LIST_PAGE + "/"),
        _county_row("later", "2026-09-20T00:00:00+00:00", LATER_DETAIL),
    ]}
    session = FakeSession({LATER_DETAIL: FakeResponse()})
    for timestamp in (RUN, NEXT_RUN):
        for bid in _state_backfill(monkeypatch, capsys, list(persisted.values()), timestamp, session):
            persisted[bid["id"]] = bid
    unfetchable = persisted["county_portal:unfetchable"]["raw_payload"]["enrichment"]["outcome"]
    assert (unfetchable["reason"], unfetchable["next_retry_at"]) == ("missing_detail_url", A_DAY_LATER)
    assert [call["url"] for call in session.calls] == [LATER_DETAIL]


SAM_LATER_DESCRIPTION = "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=later"


def _sam_row(key, first_seen_at, description_url):
    return {
        "id": f"sam_gov:{key}", "source_bid_id": key, "dedupe_key": f"sam_gov:{key}", "source": "SAM.gov",
        "issuer_name": "Department of the Interior", "issuer_type": "federal", "state_code": "US", "title": f"Trail maintenance {key}",
        "description": "", "full_description": None, "source_url": f"https://sam.gov/opp/{key}/view", "first_seen_at": first_seen_at,
        "raw_payload": {"description": description_url}, "attachments": [],
    }


def _sam_backfill(monkeypatch, capsys, history, timestamp, session):
    monkeypatch.setenv("SAM_API_KEY", "secret")
    monkeypatch.setattr(cli, "now_iso", lambda: timestamp)
    monkeypatch.setattr(cli, "enrich_sam_gov_bids", lambda bids, api_key, **options: enrich_sam_gov_bids(
        bids, api_key, session=session, now=lambda: timestamp, **options))
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(history)))
    assert cli.main(["fetch-sam-gov", "--output-json", "--posted-from", "09/01/2026", "--posted-to", "09/30/2026",
                     "--detail-history-stdin", "--detail-backfill-only", "--max-descriptions", "1"]) == 0
    return json.loads(capsys.readouterr().out)["bids"]


@pytest.mark.parametrize("description, reason", [
    ("https://untrusted.example/noticedesc?noticeid=first", "untrusted_description_url"),
    (None, "description_endpoint_missing"),
])
def test_a_sam_row_without_a_usable_description_link_stops_holding_the_only_slot(monkeypatch, capsys, description, reason):
    persisted = {row["id"]: row for row in [
        _sam_row("first", "2026-09-01T00:00:00+00:00", description),
        _sam_row("later", "2026-09-20T00:00:00+00:00", SAM_LATER_DESCRIPTION),
    ]}
    session = SamSession([SamResponse(200, {"description": "Clear brush and repair twelve miles of trail tread."})])
    for timestamp in (RUN, NEXT_RUN):
        for bid in _sam_backfill(monkeypatch, capsys, list(persisted.values()), timestamp, session):
            persisted[bid["id"]] = bid
    first = persisted["sam_gov:first"]["raw_payload"]["enrichment"]["outcome"]
    assert (first["reason"], first["next_retry_at"]) == (reason, A_DAY_LATER)
    assert [call["url"] for call in session.calls] == [SAM_LATER_DESCRIPTION]
