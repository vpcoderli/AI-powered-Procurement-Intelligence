"""P0-2: reused history carries retry provenance, never the previous run's applied_fields."""

import requests

from apsi_crawler.data_quality import prepare_persisted_bid
from apsi_crawler.detail_backfill import apply_detail_history, historical_candidates
from apsi_crawler.enrichment import enrich_bids
from test_enrichment import FakeExtractor, FakeSession, _source

DETAIL_SUMMARY = "Storm sewer replacement, Phase 2: furnish and install 2,400 linear feet of storm sewer."
VERIFIED_BODY = DETAIL_SUMMARY + " Includes trench restoration, inlet reconstruction and traffic control for twelve weeks."
LIST_SUMMARY = "Storm sewer replacement."


def _persisted_row():
    return {
        "id": "il_bidbuy:22-118", "source_bid_id": "22-118", "dedupe_key": "il_bidbuy:22-118",
        "title": "Storm sewer replacement - Phase 2", "issuer_name": "Illinois DOT", "issuer_type": "state", "state_code": "IL",
        "source_url": "https://portal.example.gov/bid/22-118", "description": DETAIL_SUMMARY, "full_description": VERIFIED_BODY,
        "detail_fetched_at": "2026-09-01T00:00:00Z", "first_seen_at": "2026-08-30T00:00:00Z",
        "raw_payload": {"enrichment": {
            "fields": {"description": "selector"},
            "applied_fields": ["description", "full_description"],
            "persisted_fields": ["description", "full_description"],
            "outcome": {"status": "success", "reason": None, "attempted": True, "attempted_at": "2026-09-01T00:00:00Z",
                        "attempt_count": 1, "valid_body": True, "verified_at": "2026-09-01T00:00:00Z",
                        "next_retry_at": "2026-09-08T00:00:00Z"},
        }},
    }


def _list_bid():
    return {
        "id": "il_bidbuy:22-118", "source_bid_id": "22-118", "dedupe_key": "il_bidbuy:22-118",
        "title": "Storm sewer replacement - Phase 2", "issuer_name": "Illinois DOT", "issuer_type": "state", "state_code": "IL",
        "source_url": "https://portal.example.gov/bid/22-118", "description": LIST_SUMMARY, "full_description": None,
        "first_seen_at": "2026-10-12T00:00:00Z", "raw_payload": {}, "attachments": [],
    }


def test_reused_history_keeps_retry_provenance_but_not_the_previous_runs_applied_fields():
    bid = _list_bid()
    apply_detail_history([bid], [_persisted_row()], "il_bidbuy")
    enrichment = bid["raw_payload"]["enrichment"]
    assert enrichment["applied_fields"] == []
    assert enrichment["persisted_fields"] == ["description", "full_description"]
    assert enrichment["outcome"]["attempt_count"] == 1


def test_failed_retry_keeps_the_verified_body_when_persisted():
    existing = _persisted_row()
    bid = _list_bid()
    apply_detail_history([bid], [existing], "il_bidbuy")
    session = FakeSession({bid["source_url"]: requests.ConnectionError("portal reset the connection")})

    out, stats = enrich_bids([bid], _source(), {"enrichment": {"enabled": True, "min_interval_seconds": 0}},
                             extractor=FakeExtractor(), session=session, now=lambda: "2026-10-12T00:00:00Z")

    assert stats["failed"] == 1
    assert out[0]["raw_payload"]["enrichment"]["applied_fields"] == []
    merged = prepare_persisted_bid(out[0], existing, "2026-10-12T00:00:00Z")
    assert merged["description"] == DETAIL_SUMMARY
    assert merged["full_description"] == VERIFIED_BODY


def test_backfill_candidates_start_without_the_previous_runs_applied_fields():
    row = {**_persisted_row(), "description": "", "full_description": None}
    candidates = historical_candidates([row], "il_bidbuy")
    assert candidates[0]["raw_payload"]["enrichment"]["applied_fields"] == []
    assert row["raw_payload"]["enrichment"]["applied_fields"] == ["description", "full_description"]
