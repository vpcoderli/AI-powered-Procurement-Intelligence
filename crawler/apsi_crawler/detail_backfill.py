"""Durable per-record detail history shared by state and SAM detail fetches.

The parent reads persisted rows; this module never opens a business database. Retry order
uses the last actual attempt (or first observation), so a listing's order cannot starve
older records. Observing a deferral never changes the last actual attempt.
"""

from copy import deepcopy
from datetime import datetime, timedelta, timezone

from apsi_crawler.content_quality import body_issue, same_text


def valid_body_text(value, title):
    """Match the shared display quality gate; short procurement scope is valid."""
    return body_issue(value, title) is None


def valid_body(bid):
    return any(valid_body_text(bid.get(field), bid.get("title")) for field in ("full_description", "description"))


def outcome_of(bid):
    raw = bid.get("raw_payload")
    enrichment = raw.get("enrichment") if isinstance(raw, dict) else None
    outcome = enrichment.get("outcome") if isinstance(enrichment, dict) else None
    return outcome if isinstance(outcome, dict) else {}


def _date(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (AttributeError, TypeError, ValueError):
        return None


def retry_due(bid, timestamp):
    due = _date(outcome_of(bid).get("next_retry_at"))
    current = _date(timestamp)
    return due is None or current is None or due <= current


def detail_priority(bid, timestamp):
    previous = outcome_of(bid)
    at = _date(previous.get("attempted_at") or bid.get("first_seen_at"))
    return (at.timestamp() if at else 0, str(bid.get("id") or ""))


def record_outcome(bid, status, reason, timestamp, *, attempted=False, obtained_body=False):
    previous = outcome_of(bid)
    count = previous.get("attempt_count", 0)
    count = count if isinstance(count, int) and not isinstance(count, bool) and count >= 0 else 0
    retry = previous.get("next_retry_at")
    if attempted or status == "not_configured" or reason in ("rate_limited", "extractor_unavailable"):
        # Public login restrictions are retried slowly; transient failures and throttles
        # cool down for an hour. Complete detail pages may be revisited weekly for changes.
        seconds = 7 * 86400 if status == "success" and obtained_body else 86400 if status == "restricted" else 3600
        current = _date(timestamp)
        retry = (current + timedelta(seconds=seconds)).isoformat() if current else None
    raw = bid.get("raw_payload")
    raw = deepcopy(raw) if isinstance(raw, dict) else {}
    enrichment = raw.get("enrichment")
    enrichment = deepcopy(enrichment) if isinstance(enrichment, dict) else {}
    if not attempted:
        enrichment["applied_fields"] = []
    enrichment["outcome"] = {
        "status": status, "reason": reason, "attempted": attempted,
        "attempted_at": timestamp if attempted else previous.get("attempted_at"),
        "attempt_count": count + int(attempted), "valid_body": valid_body(bid),
        "verified_at": timestamp if obtained_body else previous.get("verified_at"),
        "next_retry_at": retry,
    }
    raw["enrichment"] = enrichment
    bid["raw_payload"] = raw
    return enrichment["outcome"]


def _carried_enrichment(enrichment):
    """Retry provenance that may cross runs: everything except the previous run's field evidence.

    `applied_fields` names the fields THIS run's detail fetch wrote. A copy carried into a retry
    that then fails makes the importers take the list summary as fresh detail text and clear the
    verified full description. An explicit [] also stops the importers' legacy branch from
    treating copied `fields` diagnostics as detail provenance.
    """
    carried = deepcopy(enrichment) if isinstance(enrichment, dict) else {}
    carried["applied_fields"] = []
    return carried


def _fresh_candidate(row):
    candidate = deepcopy(row)
    raw = candidate.get("raw_payload")
    if isinstance(raw, dict) and isinstance(raw.get("enrichment"), dict):
        raw["enrichment"] = _carried_enrichment(raw["enrichment"])
    return candidate


def apply_detail_history(bids, history, source_id):
    """Reuse only detail fields for exactly matching source/id/title/URL identity."""
    from apsi_crawler.data_quality import core_issues
    previous = {
        row.get("id"): row for row in history or [] if isinstance(row, dict)
        and str(row.get("id") or "").startswith(f"{source_id}:") and not core_issues(row)
    }
    for bid in bids:
        row = previous.get(bid.get("id"))
        if not row or row.get("source_bid_id") != bid.get("source_bid_id"):
            continue
        if not same_text(row.get("title"), bid.get("title")) or row.get("source_url") != bid.get("source_url"):
            continue
        raw = bid.get("raw_payload")
        raw = deepcopy(raw) if isinstance(raw, dict) else {}
        old_raw = row.get("raw_payload") if isinstance(row.get("raw_payload"), dict) else {}
        old_enrichment = old_raw.get("enrichment") if isinstance(old_raw.get("enrichment"), dict) else {}
        raw["enrichment"] = _carried_enrichment(old_enrichment)
        bid["raw_payload"] = raw
        bid["first_seen_at"] = row.get("first_seen_at") or bid.get("first_seen_at")
        if valid_body(row) and not valid_body(bid):
            for field in ("description", "full_description", "detail_fetched_at"):
                bid[field] = row.get(field)
            record_outcome(bid, "reused", "persisted_body", "", obtained_body=False)
        # Importers preserve other enriched fields; bringing these into the task prevents
        # repeated requests caused by incomplete list summaries.
        for field in old_enrichment.get("persisted_fields", []):
            if field in ("original_category", "contact_name", "contact_email", "contact_phone", "published_date") and row.get(field):
                bid[field] = row[field]
    return bids


def historical_candidates(history, source_id, source=None):
    """Only normalized persisted records in the caller's exact canonical namespace."""
    from apsi_crawler.data_quality import core_issues
    expected_state = getattr(source, "state_code", None) or ("US" if source_id == "sam_gov" else None)
    expected_level = getattr(source, "jurisdiction", None) or ("federal" if source_id == "sam_gov" else None)
    base_url = getattr(source, "base_url", None)
    return [_fresh_candidate(row) for row in history or [] if isinstance(row, dict) and not core_issues(row)
            and (not expected_state or row.get("state_code") == expected_state)
            and (not expected_level or row.get("issuer_type") == expected_level)
            and (not base_url or row.get("source_url") != base_url)
            and str(row.get("id") or "").startswith(f"{source_id}:")
            and row.get("source_bid_id") is not None
            and row.get("id") == f"{source_id}:{row['source_bid_id']}"
            and row.get("title") and row.get("source_url") and not valid_body(row)]
