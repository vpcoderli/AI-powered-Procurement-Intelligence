from datetime import datetime, timezone


def now_iso():
    return datetime.now(timezone.utc).isoformat()


class StateBidNormalizationError(Exception):
    pass


def _clean_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _first_present(raw, keys, default=None):
    for key in keys:
        value = _clean_text(raw.get(key))
        if value is not None:
            return value
    return default


def _quality_flags(raw, source_url, deadline_date):
    flags = []
    if (
        not _clean_text(raw.get("title"))
        and not _clean_text(raw.get("name"))
        and not _clean_text(raw.get("solicitation_title"))
    ):
        flags.append("missing_title")
    if not _clean_text(raw.get("source_url")) and not _clean_text(raw.get("url")) and not _clean_text(raw.get("link")):
        flags.append("missing_source_url")
    if not deadline_date:
        flags.append("missing_deadline")
    if source_url and source_url.endswith("/"):
        flags.append("generic_source_url")
    return flags


def normalize_state_opportunity(raw, source):
    source_bid_id = _first_present(raw, ("source_bid_id", "id", "bid_id", "solicitation_id"))
    if not source_bid_id:
        raise StateBidNormalizationError(f"{source.id} opportunity is missing source id")

    title = _first_present(
        raw,
        ("title", "name", "solicitation_title"),
        f"Untitled {source.source_label} opportunity",
    )

    description = _first_present(raw, ("description", "summary", "type"), title)
    full_description = _first_present(raw, ("full_description", "description", "summary"), description)
    source_url = _first_present(raw, ("source_url", "url", "link"), source.base_url)
    deadline_date = _first_present(raw, ("deadline_date", "due_date", "response_deadline"))
    timestamp = now_iso()

    return {
        "id": f"{source.id}:{source_bid_id}",
        "source": source.source_label,
        "source_bid_id": source_bid_id,
        "dedupe_key": f"{source.id}:{source_bid_id}",
        "title": title,
        "description": description,
        "full_description": full_description,
        "original_category": _first_present(raw, ("original_category", "category", "type"), ""),
        "amount": raw.get("amount"),
        "amount_min": raw.get("amount_min"),
        "amount_max": raw.get("amount_max"),
        "currency": raw.get("currency", "USD"),
        "published_date": _first_present(raw, ("published_date", "posted_date", "postedDate")),
        "deadline_date": deadline_date,
        "issuer_name": _first_present(raw, ("issuer_name", "agency", "department"), "Unknown state agency"),
        "issuer_type": "state",
        "state_code": source.state_code,
        "contact_name": raw.get("contact_name"),
        "contact_email": raw.get("contact_email"),
        "contact_phone": raw.get("contact_phone"),
        "source_url": source_url,
        "is_active": 1,
        "raw_payload": raw,
        "source_confidence": raw.get("source_confidence", "medium"),
        "quality_flags_json": raw.get("quality_flags_json", _quality_flags(raw, source_url, deadline_date)),
        "admin_review_status": "unreviewed",
        "detail_archive_status": raw.get("detail_archive_status", "not_archived"),
        "detail_archive_path": raw.get("detail_archive_path"),
        "detail_fetched_at": raw.get("detail_fetched_at"),
        "detail_checksum_sha256": raw.get("detail_checksum_sha256"),
        "first_seen_at": timestamp,
        "last_seen_at": timestamp,
        "created_at": timestamp,
        "updated_at": timestamp,
        "attachments": raw.get("attachments", []),
    }
