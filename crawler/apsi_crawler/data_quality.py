"""Semantic admission for standalone SQLite commands, matching public TS core rules.

Managed crawls are assessed again by the parent importer. This module protects the
standalone CLI path; quality metadata is evidence, never an input admission verdict.
"""

import json
import re
from copy import deepcopy
from urllib.parse import urlparse, parse_qsl

from apsi_crawler.detail_backfill import valid_body_text
from apsi_crawler.us_states import STATE_CODES

ISSUER_TYPES = {"federal", "state", "county", "city", "township", "special_district"}
STATE_FIPS = dict(zip(
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(),
    "01 02 04 05 06 08 09 10 11 12 13 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56".split(),
))


def text(value):
    return value.strip() if isinstance(value, str) else ""


def record(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return {}
    return value if isinstance(value, dict) else {}


def core_issues(bid):
    issues = []
    identities = [text(bid.get(field)) for field in ("id", "source_bid_id", "dedupe_key")]
    if not any(identities) or any(value and re.search(r"(?:^|:)(?:unknown|null|undefined)$", value, re.I) for value in identities):
        issues.append("missing_identity")
    if not text(bid.get("title")) or re.match(r"Untitled(?:\s|$)", text(bid.get("title")), re.I):
        issues.append("invalid_title")
    if not text(bid.get("issuer_name")) or re.match(r"Unknown(?:\s|$)", text(bid.get("issuer_name")), re.I):
        issues.append("invalid_issuer")
    issuer = text(bid.get("issuer_type"))
    state = text(bid.get("state_code")).upper()
    if issuer not in ISSUER_TYPES:
        issues.append("invalid_issuer_type")
    if state not in STATE_CODES and not (state == "US" and issuer == "federal"):
        issues.append("invalid_state_code")
    if text(bid.get("jurisdiction_level")) and bid["jurisdiction_level"] != issuer:
        issues.append("jurisdiction_mismatch")
    fips = text(bid.get("fips_code"))
    length = {"state": 2, "county": 5, "city": 7, "township": 10}.get(issuer)
    if fips and (not fips.isdigit() or length and len(fips) != length or state in STATE_FIPS and not fips.startswith(STATE_FIPS[state])):
        issues.append("invalid_fips_code")
    try:
        url = urlparse(text(bid.get("source_url")))
        if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or any(re.fullmatch(r"api[_-]?key|access[_-]?token|authorization|password|client[_-]?secret", key, re.I) for key, _ in parse_qsl(url.query)):
            issues.append("invalid_source_url")
        flags = bid.get("quality_flags_json") or []
        if isinstance(flags, str):
            try:
                flags = json.loads(flags)
            except ValueError:
                flags = []
        if "missing_source_url" in flags or (url.hostname and url.path in ("", "/") and not url.query and not url.fragment and not text(bid.get("source_bid_id")) and not text(bid.get("dedupe_key"))):
            issues.append("missing_source_locator")
    except ValueError:
        issues.append("invalid_source_url")
    return issues


def body_of(bid):
    short = text(bid.get("description")) if valid_body_text(bid.get("description"), bid.get("title")) else ""
    full = text(bid.get("full_description")) if valid_body_text(bid.get("full_description"), bid.get("title")) else ""
    return short if not full or short.casefold().startswith(full.casefold()) else full


def prepare_persisted_bid(incoming, existing, checked_at):
    merged = deepcopy(incoming)
    for field in ("source_bid_id", "dedupe_key", "jurisdiction_level", "fips_code"):
        if existing and not text(merged.get(field)) and text(existing.get(field)):
            merged[field] = existing[field]
    old_raw = record(existing.get("raw_payload")) if existing else {}
    raw = record(merged.get("raw_payload"))
    old_enrichment = record(old_raw.get("enrichment"))
    enrichment = record(raw.get("enrichment"))
    old_fields = set(old_enrichment.get("applied_fields") or []) | set(old_enrichment.get("persisted_fields") or [])
    new_fields = set(enrichment.get("applied_fields") or [])
    for field in ("description", "full_description", "original_category", "contact_name", "contact_email", "contact_phone", "published_date"):
        old = existing.get(field) if existing else None
        new = merged.get(field)
        meaningful = lambda value: valid_body_text(value, merged.get("title")) if field in ("description", "full_description") else bool(text(value)) and not (field == "contact_name" and re.match(r"(?:purchase method|type code|bid type|informal bid flag|allow electronic quote)\s*(?::|：|$)", text(value), re.I))
        explicit_clear = field == "full_description" and new is None and field in new_fields and "description" in new_fields and meaningful(merged.get("description"))
        if not explicit_clear and meaningful(old) and (not meaningful(new) or field in old_fields and field not in new_fields):
            merged[field] = old
        elif not meaningful(new):
            merged[field] = "" if field == "description" else None
    if existing:
        for field in ("deadline_date", "awarded_date", "solicitation_number"):
            if not text(merged.get(field)):
                merged[field] = existing.get(field)
        if existing.get("lifecycle_status") == "awarded" and merged.get("lifecycle_status") == "closed":
            merged["lifecycle_status"] = "awarded"
            merged["is_active"] = 0
    selected = body_of(merged)
    outcome = record(enrichment.get("outcome"))
    freshly_selected = selected == body_of(incoming) and (outcome.get("status") == "success" and outcome.get("valid_body") is True and outcome.get("attempted") is True or bool(new_fields & {"description", "full_description"}))
    reused = bool(existing and selected and selected == body_of(existing) and not freshly_selected)
    old_body = record(record(old_raw.get("data_quality")).get("body"))
    verified_at = (old_body.get("verifiedAt") or existing.get("detail_fetched_at")) if reused else (outcome.get("verified_at") or incoming.get("detail_fetched_at") or checked_at) if selected else None
    raw["enrichment"] = {**old_enrichment, **enrichment, "persisted_fields": sorted(old_fields | new_fields)}
    raw["data_quality"] = {
        "schemaVersion": 1, "checkedAt": checked_at, "coreValid": True, "coreIssues": [],
        "capabilities": {"discovery": True, "analysis": bool(selected), "attachments": False},
        "attachments": {"discovered": len(merged.get("attachments") or []), "archived": sum(file.get("archive_status") == "archived" for file in merged.get("attachments") or []), "verified": 0},
        "body": {"valid": bool(selected), "reason": "valid" if selected else "missing_or_invalid", "verifiedAt": verified_at, "reused": reused},
    }
    merged["raw_payload"] = raw
    return merged


def redact_evidence(value):
    if isinstance(value, dict):
        return {key: "[redacted]" if re.fullmatch(r"api[_-]?key|access[_-]?token|authorization|password|cookie|secret", key, re.I) else redact_evidence(item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_evidence(item) for item in value]
    if isinstance(value, str):
        value = re.sub(r"(https?://)[^/@\s]+@", r"\1", value, flags=re.I)
        return re.sub(r"([?&](?:api_key|access_token|token|password)=)[^&#]*", r"\1[redacted]", value, flags=re.I)
    return value
