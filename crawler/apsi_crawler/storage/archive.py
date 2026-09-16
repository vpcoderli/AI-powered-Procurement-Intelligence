"""Download and validate bid documents onto the local archive root.

Hardened 2026-09-16 (see `docs/superpowers/specs/2026-09-16-attachment-repair-design.md`):

* `storage_path` is RELATIVE to the archive root — an absolute host path stops resolving the
  moment the same database is read from a container or another machine.
* Nothing reaches disk before its magic bytes are checked. A portal that answers a download
  URL with a login/session-error page returns HTTP 200 + HTML, and the old writer happily
  stored that HTML as `Solicitation.pdf`.
* The blocklist matches WHOLE path segments, so `/authority/bid/7` is downloaded and only a
  real `/login/…` route is refused.
* Requests carry the crawler's browser headers and the bid detail page as `Referer`, with a
  streamed, size-capped read.
"""

import hashlib
import re
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

import requests

from apsi_crawler.content_quality import is_login_html
from apsi_crawler.enrichment import detect_off_target_redirect
from apsi_crawler.html.public_page import BROWSER_REQUEST_HEADERS
from apsi_crawler.storage.content_sniff import (
    clean_content_type,
    extension_for_content_type,
    sniff_bytes,
)


# Same identity as every other crawler request, but a document download must not advertise an
# HTML-only Accept header — some portals answer `406` or hand back an HTML wrapper for it.
DOWNLOAD_REQUEST_HEADERS = dict(BROWSER_REQUEST_HEADERS)
DOWNLOAD_REQUEST_HEADERS["Accept"] = "*/*"

# Whole path segments only. Substring matching used to reject `/authority/…`,
# `/associations/…` and anything else that merely contains "auth" or "login".
BLOCKED_PATH_SEGMENTS = (
    "browser_check",
    "captcha",
    "login",
    "signin",
    "sign-in",
    "sso",
    "auth",
)

DEFAULT_MAX_BYTES = 52428800
_CHUNK_SIZE = 65536


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _safe_segment(value):
    text = str(value or "unknown").strip().lower()
    text = re.sub(r"[^a-z0-9._-]+", "_", text)
    return text.strip("._-") or "unknown"


def is_public_http_url(url):
    parsed = urlparse(str(url or ""))
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def looks_browser_or_login_required(url):
    """True only when a WHOLE path segment is a login/challenge route.

    `/authority/bid/7`, `/associations/…` and `bidDetail.sdo?…` are ordinary public
    documents; the pre-2026-09-16 substring blocklist refused all of them.
    """
    path = urlparse(str(url or "")).path
    segments = [segment for segment in unquote(path or "").lower().split("/") if segment]
    return any(segment in BLOCKED_PATH_SEGMENTS for segment in segments)


# Internal aliases kept for the original call sites in this module.
_is_public_http_url = is_public_http_url
_looks_browser_or_login_required = looks_browser_or_login_required


def document_extension(sniffed_type, url, fallback=None):
    """C1 order: sniffed type -> URL path suffix -> caller's expected extension -> `.bin`."""
    extension = extension_for_content_type(sniffed_type)
    if extension:
        return extension
    suffix = Path(urlparse(str(url or "")).path).suffix
    if suffix:
        return suffix[:16]
    return fallback or ".bin"


def relative_storage_path(archive_root, *segments):
    """`<archive_root>/<safe>/<safe>/…` as a path RELATIVE to `archive_root` (never absolute)."""
    relative = Path(*[_safe_segment(segment) for segment in segments])
    directory = (Path(archive_root) / relative).parent
    directory.mkdir(parents=True, exist_ok=True)
    return relative.as_posix()


def write_document(archive_root, relative_path, content):
    path = Path(archive_root) / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return relative_path


def validate_document(content, header_content_type, allow_html=False):
    """Return `(content_type, sniffed_type, failure_kind, error)` for a downloaded payload."""
    if not content:
        return None, None, "network", "Downloaded document was empty."

    header = clean_content_type(header_content_type)
    sniffed = sniff_bytes(content, header)
    if (sniffed == "text/html" or header == "text/html") and not allow_html:
        text = content.decode("utf-8", errors="ignore")
        try:
            login = is_login_html(text)
        except Exception:  # noqa: BLE001 - a malformed login page is still an HTML response
            login = False
        return (
            None,
            sniffed,
            "login_wall" if login else "html_response",
            "Portal returned a login page instead of the document."
            if login
            else "Portal returned an HTML page instead of the document.",
        )

    content_type = sniffed or header or None
    if content_type is None:
        return None, None, "unsupported_type", "Downloaded bytes matched no known document type."
    return content_type, sniffed, None, None


def _read_capped(response, limit):
    """Stream at most `limit` bytes. Returns `(data, exceeded)`; nothing is written to disk."""
    chunks = []
    total = 0
    for chunk in response.iter_content(chunk_size=_CHUNK_SIZE):
        if not chunk:
            continue
        total += len(chunk)
        if total > limit:
            chunks.append(chunk[: max(0, limit - (total - len(chunk)))])
            return b"".join(chunks), True
        chunks.append(chunk)
    return b"".join(chunks), False


def fetch_document(
    session,
    url,
    referer=None,
    timeout=30,
    max_bytes=DEFAULT_MAX_BYTES,
    allow_html=False,
):
    """GET one document with the crawler's polite headers and full content validation.

    Returns a dict with `ok`, `content`, `content_type`, `sniffed_type`, `final_url`,
    `failure_kind` and `error`. Never raises for an expected portal condition.
    """
    headers = dict(DOWNLOAD_REQUEST_HEADERS)
    if referer:
        headers["Referer"] = referer

    def failure(kind, error, final_url=None):
        return {
            "ok": False,
            "content": None,
            "content_type": None,
            "sniffed_type": None,
            "final_url": final_url or url,
            "failure_kind": kind,
            "error": error,
        }

    try:
        response = session.get(url, headers=headers, timeout=timeout, stream=True)
    except requests.Timeout as error:
        return failure("timeout", "Request timed out: {0}".format(error))
    except requests.RequestException as error:
        return failure("network", "Request failed: {0}".format(error))

    try:
        status_code = int(getattr(response, "status_code", 0) or 0)
        final_url = getattr(response, "url", None) or url
        if status_code >= 500:
            return failure("http_5xx", "HTTP {0}".format(status_code), final_url)
        if status_code >= 400:
            return failure("http_4xx", "HTTP {0}".format(status_code), final_url)

        off_target = detect_off_target_redirect(url, final_url, bool(getattr(response, "history", None)))
        if off_target:
            return failure("off_target", "Redirected to {0} — {1}".format(final_url, off_target), final_url)

        try:
            content, exceeded = _read_capped(response, max_bytes)
        except requests.Timeout as error:
            return failure("timeout", "Read timed out: {0}".format(error), final_url)
        except requests.RequestException as error:
            return failure("network", "Read failed: {0}".format(error), final_url)

        header_content_type = (getattr(response, "headers", None) or {}).get("Content-Type")
        if exceeded:
            content_type, _sniffed, kind, error = validate_document(
                content, header_content_type, allow_html=allow_html
            )
            if kind in ("html_response", "login_wall"):
                return failure(kind, error, final_url)
            return failure(
                "too_large",
                "Document exceeds the {0} byte cap.".format(max_bytes),
                final_url,
            )

        content_type, sniffed, kind, error = validate_document(
            content, header_content_type, allow_html=allow_html
        )
        if kind:
            return failure(kind, error, final_url)
        return {
            "ok": True,
            "content": content,
            "content_type": content_type,
            "sniffed_type": sniffed,
            "final_url": final_url,
            "failure_kind": None,
            "error": None,
        }
    finally:
        close = getattr(response, "close", None)
        if callable(close):
            close()


def _download_public_url(url, archive_root, bid, session, timeout, prefix, index, allow_html=False):
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

    outcome = fetch_document(
        session,
        url,
        referer=bid.get("source_url"),
        timeout=timeout,
        max_bytes=DEFAULT_MAX_BYTES,
        allow_html=allow_html,
    )
    if not outcome["ok"]:
        return {
            "archive_status": "failed",
            "storage_path": None,
            "archive_error": outcome["error"],
            "failure_kind": outcome["failure_kind"],
        }

    content = outcome["content"]
    extension = document_extension(outcome["sniffed_type"], url)
    relative = relative_storage_path(
        archive_root,
        bid.get("source") or bid.get("source_bid_id") or "source",
        bid.get("id") or bid.get("dedupe_key") or "bid",
        "{0}-{1}{2}".format(prefix, index, extension),
    )
    return {
        "archive_status": "archived",
        "storage_path": write_document(archive_root, relative, content),
        "byte_size": len(content),
        "content_type": outcome["content_type"],
        "checksum_sha256": hashlib.sha256(content).hexdigest(),
        "archive_error": None,
        "failure_kind": None,
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
    """Archive a bid's attachments (and optionally its detail page) under `archive_root`.

    Used by `fetch-sam-gov --archive-documents`. `storage_path` / `detail_archive_path` are
    relative to `archive_root`. Attachments are content-validated (HTML is refused); the
    detail page is archived as the HTML it is meant to be.
    """
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
                    allow_html=True,
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
