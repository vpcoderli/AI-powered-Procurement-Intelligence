"""Durable per-record detail history shared by state and SAM detail fetches.

The parent reads persisted rows; this module never opens a business database. Retry order
uses the last actual attempt (or first observation), so a listing's order cannot starve
older records. Observing a deferral never changes the last actual attempt.
"""

import re
from copy import deepcopy
from datetime import datetime, timedelta, timezone

from apsi_crawler.content_quality import comparable_text, same_text, useful_text


def valid_body_text(value, title):
    """Match the shared display quality gate; short procurement scope is valid."""
    if not useful_text(value, title):
        return False
    text = comparable_text(value)
    if re.fullmatch(r"https?://\S+", text):
        return False
    if re.fullmatch(r"(?:(?:solicitation|short|full|bulletin|bid|project)\s+)?(?:description|desc|summary|scope of work|statement of work)[:\s]*", text):
        return False
    if re.fullmatch(r"(?:n/a|none|null|not (?:available|provided)|no description(?: available)?|description (?:not available|pending)|tbd|待补|暂无(?:正文|描述))\.?", text):
        return False
    if re.fullmatch(r"(?:solicitation|presolicitation|combined synopsis/solicitation|sources sought|special notice|award notice|sale of surplus property|ifb|rfp|rfq|itb|rfi)\.?", text):
        return False
    if re.match(r"(?:please\s+)?(?:log\s*in|sign\s*in|register|create an account|you (?:must|need to) (?:log\s*in|sign\s*in))", text):
        return False
    if re.match(r"(?:access denied|forbidden|unauthorized|error (?:403|404|500)|page not found|checking your browser|just a moment|enable javascript|verify (?:you are|that you are) human)\b", text):
        return False
    if re.match(r"(?:purchase method|type code|bid type|informal bid flag|allow electronic quote)\s*(?::|：|$)", text):
        return False
    navigation = [part for part in re.split(r"\s*[|\n·]\s*", value.strip().casefold()) if part]
    if navigation and all(re.fullmatch(r"(?:home|about(?: us)?|contact(?: us)?|privacy(?: policy)?|terms(?: of (?:use|service))?|copyright.*|all rights reserved|login|sign in|register)", part) for part in navigation):
        return False
    if re.fullmatch(r"\d+[a-z]?\s+[\w\s.]+\s(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr)\.?\s*,[^\n]+\b[a-z]{2}\s+\d{5}(?:-\d{4})?\s*", text):
        return False
    return True


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
        raw["enrichment"] = deepcopy(old_enrichment)
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
    return [deepcopy(row) for row in history or [] if isinstance(row, dict) and not core_issues(row)
            and (not expected_state or row.get("state_code") == expected_state)
            and (not expected_level or row.get("issuer_type") == expected_level)
            and (not base_url or row.get("source_url") != base_url)
            and str(row.get("id") or "").startswith(f"{source_id}:")
            and row.get("source_bid_id") is not None
            and row.get("id") == f"{source_id}:{row['source_bid_id']}"
            and row.get("title") and row.get("source_url") and not valid_body(row)]
