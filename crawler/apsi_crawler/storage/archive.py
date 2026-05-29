import hashlib
import mimetypes
import re
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests


DEFAULT_HEADERS = {"User-Agent": "Mozilla/5.0 APSI crawler"}
BLOCKED_URL_MARKERS = (
    "browser_check",
    "captcha",
    "login",
    "signin",
    "sign-in",
    "sso",
    "auth",
)
CONTENT_TYPE_EXTENSIONS = {
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/html": ".html",
    "text/plain": ".txt",
}


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _clean_content_type(value):
    return (value or "").split(";")[0].strip().lower()


def _safe_segment(value):
    text = str(value or "unknown").strip().lower()
    text = re.sub(r"[^a-z0-9._-]+", "_", text)
    return text.strip("._-") or "unknown"


def _is_public_http_url(url):
    parsed = urlparse(str(url or ""))
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def _looks_browser_or_login_required(url):
    lowered = str(url or "").lower()
    return any(marker in lowered for marker in BLOCKED_URL_MARKERS)


def _extension_for(url, content_type, fallback):
    parsed = urlparse(url)
    suffix = Path(parsed.path).suffix
    if suffix:
        return suffix[:16]
    if content_type in CONTENT_TYPE_EXTENSIONS:
        return CONTENT_TYPE_EXTENSIONS[content_type]
    return mimetypes.guess_extension(content_type) or fallback


def _write_bytes(archive_root, bid, content, url, content_type, prefix, index):
    extension = _extension_for(url, content_type, ".bin")
    source_segment = _safe_segment(bid.get("source") or bid.get("source_bid_id") or "source")
    bid_segment = _safe_segment(bid.get("id") or bid.get("dedupe_key") or "bid")
    directory = Path(archive_root).resolve() / source_segment / bid_segment
    directory.mkdir(parents=True, exist_ok=True)
    file_path = directory / f"{prefix}-{index}{extension}"
    file_path.write_bytes(content)
    return str(file_path)


def _download_public_url(url, archive_root, bid, session, timeout, prefix, index):
    if not _is_public_http_url(url):
        return {
            "archive_status": "unavailable",
            "archive_error": "Attachment URL is not public HTTP(S).",
        }
    if _looks_browser_or_login_required(url):
        return {
            "archive_status": "unavailable",
            "archive_error": "Attachment URL appears to require browser/login access.",
        }

    try:
        response = session.get(url, headers=DEFAULT_HEADERS, timeout=timeout)
        response.raise_for_status()
        content = bytes(response.content or b"")
        if not content:
            return {
                "archive_status": "failed",
                "storage_path": None,
                "archive_error": f"Downloaded {prefix.replace('_', ' ')} was empty.",
            }
        content_type = _clean_content_type(response.headers.get("Content-Type"))
        return {
            "archive_status": "archived",
            "storage_path": _write_bytes(archive_root, bid, content, url, content_type, prefix, index),
            "byte_size": len(content),
            "content_type": content_type or None,
            "checksum_sha256": hashlib.sha256(content).hexdigest(),
            "archive_error": None,
        }
    except Exception as error:
        return {
            "archive_status": "failed",
            "storage_path": None,
            "archive_error": str(error),
        }


def _detail_unavailable_error(url):
    if not _is_public_http_url(url):
        return "Detail URL is not public HTTP(S)."
    return "Detail URL appears to require browser/login access."


def archive_bid_documents(
    bid,
    archive_root,
    session=None,
    timeout=30,
    fetch_detail=False,
    fetched_at=None,
):
    enriched = deepcopy(bid)
    timestamp = fetched_at or _now_iso()
    client = session or requests.Session()
    close_client = session is None

    try:
        attachments = []
        for index, attachment in enumerate(enriched.get("attachments") or [], start=1):
            updated = dict(attachment)
            url = updated.get("url")
            updated["original_url"] = updated.get("original_url") or url
            result = _download_public_url(url, archive_root, enriched, client, timeout, "attachment", index)
            updated.update(result)
            if updated.get("archive_status") == "archived":
                updated["fetched_at"] = timestamp
            attachments.append(updated)
        enriched["attachments"] = attachments

        if fetch_detail:
            detail_url = enriched.get("source_url")
            if not _is_public_http_url(detail_url) or _looks_browser_or_login_required(detail_url):
                enriched["detail_archive_status"] = "unavailable"
                enriched["detail_archive_error"] = _detail_unavailable_error(detail_url)
            else:
                result = _download_public_url(
                    detail_url,
                    archive_root,
                    enriched,
                    client,
                    timeout,
                    "detail",
                    1,
                )
                enriched["detail_archive_status"] = result["archive_status"]
                enriched["detail_archive_path"] = result.get("storage_path")
                enriched["detail_checksum_sha256"] = result.get("checksum_sha256")
                enriched["detail_archive_error"] = result.get("archive_error")
                if result["archive_status"] == "archived":
                    enriched["detail_fetched_at"] = timestamp
        return enriched
    finally:
        if close_client:
            client.close()
