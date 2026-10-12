from copy import deepcopy

import pytest

from apsi_crawler.detail_backfill import (
    apply_detail_history,
    detail_priority,
    historical_candidates,
    record_outcome,
    retry_due,
    valid_body_text,
)


@pytest.mark.parametrize("text", [
    "Road repair.", "https://api.sam.gov/opportunities/v1/noticedesc?noticeid=one",
    "Description pending", "Sources Sought", "RFQ", "Sign in to see this solicitation",
    "Access denied", "Purchase Method: Open Market", "Home\nAbout\nPrivacy Policy",
    "123 Main Street, Springfield, IL 62701",
])
def test_body_classifier_rejects_existing_placeholder_shapes(text):
    assert not valid_body_text(text, "Road repair")


def test_short_procurement_scope_is_not_suppressed_by_length():
    assert valid_body_text("Supply and install two backup generators.", "Road repair")


def test_retry_priority_does_not_starve_an_older_due_failure_behind_new_arrivals():
    failed = {"id": "source:old", "raw_payload": {"enrichment": {"outcome": {"attempted_at": "2026-09-01T00:00:00Z", "next_retry_at": "2026-09-01T01:00:00Z"}}}}
    fresh = {"id": "source:new", "first_seen_at": "2026-10-01T00:00:00Z"}
    assert retry_due(failed, "2026-10-01T00:00:00Z")
    assert sorted([fresh, failed], key=lambda row: detail_priority(row, "2026-10-01T00:00:00Z"))[0] is failed


def test_identity_change_cannot_reuse_an_old_records_body_or_attempt_history():
    previous = {"id": "source:one", "source_bid_id": "one", "title": "Original scope", "source_url": "https://portal.example/bid/one", "description": "Supply and install two backup generators.", "raw_payload": {"enrichment": {"outcome": {"attempt_count": 9}}}}
    current = {**previous, "title": "Different project", "description": "Different project", "raw_payload": {}}
    apply_detail_history([current], [previous], "source")
    assert current["description"] == "Different project"
    assert current["raw_payload"] == {}


def test_historical_backlog_is_scoped_to_source_and_preserves_closed_status():
    row = {"id": "source:one", "source_bid_id": "one", "dedupe_key": "source:one", "issuer_name": "County Roads Agency", "issuer_type": "county", "state_code": "CA", "title": "Road repair", "description": "Road repair", "source_url": "https://portal.example/bid/one", "lifecycle_status": "closed", "is_active": 0}
    wrong = {**row, "id": "other:one"}
    forged = {**row, "id": "source:two"}
    complete = {**row, "id": "source:complete", "source_bid_id": "complete", "description": "Supply and install two backup generators."}
    candidates = historical_candidates([wrong, row, forged, complete], "source")
    assert candidates == [row]
    assert candidates[0] is not row


def test_deferred_and_budget_observations_preserve_last_actual_attempt():
    bid = {"title": "Road repair", "description": "Road repair", "raw_payload": {"enrichment": {"outcome": {"attempted_at": "2026-09-01T00:00:00Z", "attempt_count": 2, "next_retry_at": "2026-09-01T01:00:00Z"}}}}
    record_outcome(bid, "budget", "budget_exhausted", "2026-10-01T00:00:00Z")
    previous = deepcopy(bid["raw_payload"]["enrichment"]["outcome"])
    record_outcome(bid, "deferred", "cooldown", "2026-10-02T00:00:00Z")
    assert bid["raw_payload"]["enrichment"]["outcome"]["attempted_at"] == previous["attempted_at"]
    assert bid["raw_payload"]["enrichment"]["outcome"]["attempt_count"] == 2
    assert bid["raw_payload"]["enrichment"]["outcome"]["next_retry_at"] == previous["next_retry_at"]


def test_invalid_oldest_record_cannot_starve_a_good_history_retry_across_runs():
    from apsi_crawler.data_quality import core_issues
    from apsi_crawler.enrichment import enrich_bids
    from test_enrichment import FakeExtractor, FakeResponse, FakeSession, _source
    good = {"id": "il_bidbuy:good", "source_bid_id": "good", "dedupe_key": "il_bidbuy:good", "title": "Road repair", "description": "Road repair", "source_url": "https://portal.example.gov/bid/good", "issuer_name": "County Roads Agency", "issuer_type": "state", "state_code": "IL", "first_seen_at": "2026-09-01T00:00:00Z", "attachments": []}
    bad = {**good, "id": "il_bidbuy:bad", "source_bid_id": "bad", "dedupe_key": "il_bidbuy:bad", "title": "Untitled old record", "description": "Untitled old record", "source_url": "https://portal.example.gov/bid/bad", "first_seen_at": "2020-01-01T00:00:00Z"}
    persisted = {row["id"]: row for row in [bad, good]}
    session = FakeSession({row["source_url"]: FakeResponse() for row in [bad, good]})
    for timestamp in ["2026-10-01T00:00:00Z", "2026-10-01T03:00:00Z"]:
        candidates = historical_candidates(list(persisted.values()), "il_bidbuy")
        out, _ = enrich_bids(candidates, _source(), {"enrichment": {"enabled": True, "fields": ["description"], "max_details_per_run": 1, "min_interval_seconds": 0}}, extractor=FakeExtractor(), session=session, now=lambda: timestamp)
        # The admission gate never persists an invalid candidate's attempt evidence.
        for row in out:
            if not core_issues(row):
                persisted[row["id"]] = deepcopy(row)
    assert [call["url"] for call in session.calls] == [good["source_url"], good["source_url"]]
