from datetime import datetime, timezone


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def normalize_sam_gov_opportunity(raw):
    notice_id = raw.get("noticeId") or raw.get("solicitationNumber")
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

    return {
        "id": f"sam_gov:{notice_id}",
        "source": "SAM.gov",
        "source_bid_id": notice_id,
        "dedupe_key": f"sam_gov:{notice_id}",
        "title": title,
        "description": raw.get("description") or raw.get("type") or "",
        "full_description": raw.get("description") or "",
        "original_category": raw.get("type") or "",
        "amount": award.get("amount") if isinstance(award, dict) else None,
        "amount_min": None,
        "amount_max": None,
        "currency": "USD",
        "published_date": raw.get("postedDate"),
        "deadline_date": deadline_date,
        "issuer_name": raw.get("department") or raw.get("organizationName") or "Unknown agency",
        "issuer_type": "federal",
        "state_code": "US",
        "contact_name": None,
        "contact_email": None,
        "contact_phone": None,
        "source_url": source_url,
        "is_active": 1,
        "raw_payload": raw,
        "source_confidence": "high",
        "quality_flags_json": quality_flags,
        "admin_review_status": "unreviewed",
        "detail_archive_status": raw.get("detail_archive_status", "not_archived"),
        "detail_archive_path": raw.get("detail_archive_path"),
        "detail_fetched_at": raw.get("detail_fetched_at"),
        "detail_checksum_sha256": raw.get("detail_checksum_sha256"),
        "first_seen_at": timestamp,
        "last_seen_at": timestamp,
        "created_at": timestamp,
        "updated_at": timestamp,
        "attachments": [],
    }
