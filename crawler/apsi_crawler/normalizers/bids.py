from datetime import datetime, timezone
from urllib.parse import unquote, urlparse


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def _text(value):
    return value.strip() if isinstance(value, str) else ""


def _contact(raw):
    values = raw.get("pointOfContact") or raw.get("pointofContact") or []
    if not isinstance(values, list):
        return {}
    records = [value for value in values if isinstance(value, dict)]
    return next((value for value in records if _text(value.get("type")).lower() == "primary"), records[0] if records else {})


def _resource_attachments(raw, quality_flags):
    links = raw.get("resourceLinks") or []
    if not isinstance(links, list):
        quality_flags.append("invalid_attachment_list")
        return []
    attachments = []
    seen = set()
    for value in links:
        url = _text(value)
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            quality_flags.append("invalid_attachment_url")
            continue
        if url in seen:
            continue
        seen.add(url)
        name = unquote(parsed.path.rsplit("/", 1)[-1]) or f"Attachment {len(attachments) + 1}"
        attachments.append({"name": name, "url": url, "original_url": url, "archive_status": "not_archived"})
    return attachments


def normalize_sam_gov_opportunity(raw, description_text=None, description_error=None):
    notice_id = _text(raw.get("noticeId")) or _text(raw.get("solicitationNumber"))
    if not notice_id:
        raise ValueError("SAM.gov opportunity is missing notice identity")
    title = raw.get("title") or "Untitled SAM.gov opportunity"
    timestamp = now_iso()
    award = raw.get("award")
    source_url = raw.get("uiLink") or "https://sam.gov"
    deadline_date = raw.get("responseDeadLine")
    quality_flags = []
    if not raw.get("title"):
        quality_flags.append("missing_title")
    if not raw.get("uiLink"):
        quality_flags.append("missing_source_url")
    if not deadline_date:
        quality_flags.append("missing_deadline")

    original_description = raw.get("description") or ""
    is_description_link = isinstance(original_description, str) and original_description.strip().lower().startswith(("http://", "https://"))
    description = description_text[:500] if description_text is not None else ("" if is_description_link else original_description)
    raw_payload = dict(raw)
    detail_fetched_at = raw.get("detail_fetched_at")
    if description_text is not None or description_error is not None:
        raw_payload["enrichment"] = {
            "fields": {"description": "sam_api" if description_text is not None else description_error},
            "applied_fields": ["description", "full_description"] if description_text is not None else [],
        }
        if description_text is not None:
            detail_fetched_at = timestamp
        else:
            quality_flags.append("description_not_fetched" if description_error == "budget_exhausted" else "description_fetch_failed")

    contact = _contact(raw)
    notice_type = _text(raw.get("type")).lower()
    lifecycle_status = "awarded" if notice_type in ("award notice", "a") else "closed" if raw.get("active") is False or str(raw.get("active", "")).lower() in ("no", "false", "0") else "open"
    attachments = _resource_attachments(raw, quality_flags)
    issuer_name = _text(raw.get("fullParentPathName")) or _text(raw.get("organizationName")) or _text(raw.get("department")) or "Unknown agency"
    return {
        "id": f"sam_gov:{notice_id}",
        "source": "SAM.gov",
        "source_bid_id": notice_id,
        "dedupe_key": f"sam_gov:{notice_id}",
        "title": title,
        "description": description,
        "full_description": description_text if description_text is not None else ("" if is_description_link else original_description),
        "original_category": raw.get("type") or "",
        "amount": award.get("amount") if isinstance(award, dict) else None,
        "amount_min": None,
        "amount_max": None,
        "currency": "USD",
        "published_date": raw.get("postedDate"),
        "deadline_date": deadline_date,
        "issuer_name": issuer_name,
        "issuer_type": "federal",
        "state_code": "US",
        "contact_name": _text(contact.get("fullName")) or _text(contact.get("fullname")) or None,
        "contact_email": _text(contact.get("email")) or None,
        "contact_phone": _text(contact.get("phone")) or None,
        "source_url": source_url,
        "is_active": 1 if lifecycle_status == "open" else 0,
        "lifecycle_status": lifecycle_status,
        "awarded_date": award.get("date") if lifecycle_status == "awarded" and isinstance(award, dict) else None,
        "solicitation_number": _text(raw.get("solicitationNumber")) or None,
        "raw_payload": raw_payload,
        "source_confidence": "high",
        "quality_flags_json": quality_flags,
        "admin_review_status": "unreviewed",
        "detail_archive_status": raw.get("detail_archive_status", "not_archived"),
        "detail_archive_path": raw.get("detail_archive_path"),
        "detail_fetched_at": detail_fetched_at,
        "detail_checksum_sha256": raw.get("detail_checksum_sha256"),
        "first_seen_at": timestamp,
        "last_seen_at": timestamp,
        "created_at": timestamp,
        "updated_at": timestamp,
        "attachments": attachments,
    }
