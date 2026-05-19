from datetime import datetime, timezone


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def _first_present(raw, keys, default=None):
    for key in keys:
        value = raw.get(key)
        if value not in (None, ""):
            return value
    return default


def normalize_state_opportunity(raw, source):
    source_bid_id = _first_present(raw, ("source_bid_id", "id", "bid_id", "solicitation_id"))
    title = _first_present(raw, ("title", "name", "solicitation_title"), "Untitled state opportunity")
    source_url = _first_present(raw, ("source_url", "url", "link"), "")
    timestamp = now_iso()

    return {
        "id": f"{source.id}:{source_bid_id}",
        "source": source.source_label,
        "source_bid_id": source_bid_id,
        "dedupe_key": f"{source.id}:{source_bid_id}",
        "title": title,
        "description": _first_present(raw, ("description", "summary", "type"), ""),
        "full_description": _first_present(raw, ("full_description", "description", "summary"), ""),
        "original_category": _first_present(raw, ("original_category", "category", "type"), ""),
        "amount": raw.get("amount"),
        "amount_min": raw.get("amount_min"),
        "amount_max": raw.get("amount_max"),
        "currency": raw.get("currency", "USD"),
        "published_date": _first_present(raw, ("published_date", "posted_date", "postedDate")),
        "deadline_date": _first_present(raw, ("deadline_date", "due_date", "response_deadline")),
        "issuer_name": _first_present(raw, ("issuer_name", "agency", "department"), "Unknown state agency"),
        "issuer_type": "state",
        "state_code": source.state_code,
        "contact_name": raw.get("contact_name"),
        "contact_email": raw.get("contact_email"),
        "contact_phone": raw.get("contact_phone"),
        "source_url": source_url,
        "is_active": 1,
        "raw_payload": raw,
        "first_seen_at": timestamp,
        "last_seen_at": timestamp,
        "created_at": timestamp,
        "updated_at": timestamp,
        "attachments": raw.get("attachments", []),
    }
