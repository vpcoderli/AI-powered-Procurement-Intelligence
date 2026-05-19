from datetime import datetime, timezone


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def normalize_sam_gov_opportunity(raw):
    notice_id = raw.get("noticeId") or raw.get("solicitationNumber")
    title = raw.get("title") or "Untitled SAM.gov opportunity"
    timestamp = now_iso()
    award = raw.get("award")

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
        "deadline_date": raw.get("responseDeadLine"),
        "issuer_name": raw.get("department") or raw.get("organizationName") or "Unknown agency",
        "issuer_type": "federal",
        "state_code": "US",
        "contact_name": None,
        "contact_email": None,
        "contact_phone": None,
        "source_url": raw.get("uiLink") or "https://sam.gov",
        "is_active": 1,
        "raw_payload": raw,
        "first_seen_at": timestamp,
        "last_seen_at": timestamp,
        "created_at": timestamp,
        "updated_at": timestamp,
        "attachments": [],
    }
