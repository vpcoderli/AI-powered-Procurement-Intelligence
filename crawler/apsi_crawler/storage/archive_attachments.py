"""`archive-attachments` engine — contract C1.

One request describes one source and up to a few hundred of its attachments; one response
reports the outcome of every item. Per-item failures are data, never exceptions: the caller
(the Node attachment-repair service) needs a row for each item it handed us, so the only
exit that loses results is an invalid request.

See `docs/superpowers/plans/2026-09-16-attachment-repair.md` (C1) for the wire format.
"""

import hashlib
import sys
import time
from time import perf_counter

import requests

from apsi_crawler.storage.archive import (
    DEFAULT_MAX_BYTES,
    document_extension,
    fetch_document,
    is_public_http_url,
    looks_browser_or_login_required,
    relative_storage_path,
    validate_document,
    write_document,
)
from apsi_crawler.storage.browser_download import (
    BrowserDownloadError,
    BrowserDownloaderClient,
    build_browser_download_request,
)
from apsi_crawler.storage.sqlite import now_iso


MODES = ("direct", "browser")
DEFAULTS = {
    "mode": "direct",
    "min_interval_seconds": 3.0,
    "timeout_seconds": 30,
    "max_bytes": DEFAULT_MAX_BYTES,
}


class InvalidArchiveRequestError(Exception):
    """The request payload cannot be executed at all (CLI exit 2)."""


def _clamp(value, low, high, default, cast):
    try:
        number = cast(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def _validate_request(request):
    if not isinstance(request, dict):
        raise InvalidArchiveRequestError("request must be a JSON object")
    archive_root = request.get("archive_root")
    if not isinstance(archive_root, str) or not archive_root.strip():
        raise InvalidArchiveRequestError("archive_root must be a non-empty string")
    items = request.get("items")
    if not isinstance(items, list):
        raise InvalidArchiveRequestError("items must be a list")
    for item in items:
        if not isinstance(item, dict):
            raise InvalidArchiveRequestError("every item must be a JSON object")
        if not isinstance(item.get("id"), str) or not item["id"].strip():
            raise InvalidArchiveRequestError("every item must carry a non-empty string id")
    source = request.get("source")
    if source is not None and not isinstance(source, dict):
        raise InvalidArchiveRequestError("source must be a JSON object")
    mode = (source or {}).get("mode")
    if mode is not None and mode not in MODES:
        raise InvalidArchiveRequestError("source.mode must be one of: {0}".format(", ".join(MODES)))
    browser_url = request.get("browser_downloader_url")
    if browser_url is not None and not isinstance(browser_url, str):
        raise InvalidArchiveRequestError("browser_downloader_url must be a string or null")


def _source_settings(source):
    source = source or {}
    return {
        "id": source.get("id") or "source",
        "label": source.get("label") or source.get("id") or "source",
        "mode": source.get("mode") if source.get("mode") in MODES else DEFAULTS["mode"],
        "min_interval_seconds": _clamp(
            source.get("min_interval_seconds"), 0.0, 60.0, DEFAULTS["min_interval_seconds"], float
        ),
        "timeout_seconds": _clamp(source.get("timeout_seconds"), 5, 120, DEFAULTS["timeout_seconds"], int),
        "max_bytes": _clamp(source.get("max_bytes"), 1024, 209715200, DEFAULTS["max_bytes"], int),
        "browser_link_selector": source.get("browser_link_selector") or None,
    }


def _result(item_id, status, failure_kind=None, error=None, final_url=None, method=None, fetched_at=None, **extra):
    result = {
        "id": item_id,
        "archive_status": status,
        "storage_path": None,
        "byte_size": None,
        "content_type": None,
        "checksum_sha256": None,
        "archive_error": error,
        "failure_kind": failure_kind,
        "final_url": final_url,
        "fetched_at": fetched_at,
        "method": method,
    }
    result.update(extra)
    return result


def _log(message):
    """Diagnostics go to stderr — stdout carries exactly one JSON document."""
    print(message, file=sys.stderr)


def _store(item, settings, archive_root, content, content_type, sniffed_type, final_url, method, fetched_at):
    extension = document_extension(sniffed_type, item.get("url"), item.get("expected_extension"))
    relative = relative_storage_path(
        archive_root,
        settings["id"],
        item.get("bid_id") or "bid",
        "{0}{1}".format(item["id"], extension),
    )
    write_document(archive_root, relative, content)
    return _result(
        item["id"],
        "archived",
        final_url=final_url,
        method=method,
        fetched_at=fetched_at,
        storage_path=relative,
        byte_size=len(content),
        content_type=content_type,
        checksum_sha256=hashlib.sha256(content).hexdigest(),
    )


def _archive_direct(item, settings, archive_root, session, fetched_at):
    outcome = fetch_document(
        session,
        item["url"],
        referer=item.get("page_url"),
        timeout=settings["timeout_seconds"],
        max_bytes=settings["max_bytes"],
    )
    if not outcome["ok"]:
        return _result(
            item["id"],
            "failed",
            failure_kind=outcome["failure_kind"],
            error=outcome["error"],
            final_url=outcome["final_url"],
            method="direct",
        )
    return _store(
        item,
        settings,
        archive_root,
        outcome["content"],
        outcome["content_type"],
        outcome["sniffed_type"],
        outcome["final_url"],
        "direct",
        fetched_at,
    )


def _archive_browser(item, settings, archive_root, client, fetched_at):
    request = build_browser_download_request(
        item,
        timeout_seconds=settings["timeout_seconds"],
        max_bytes=settings["max_bytes"],
        selector=settings["browser_link_selector"],
    )
    try:
        download = client.download(request)
    except BrowserDownloadError as error:
        return _result(
            item["id"],
            "failed",
            failure_kind=error.failure_kind,
            error=error.message,
            final_url=item.get("url"),
            method="browser",
        )

    content = download.content or b""
    if len(content) > settings["max_bytes"]:
        return _result(
            item["id"],
            "failed",
            failure_kind="too_large",
            error="Document exceeds the {0} byte cap.".format(settings["max_bytes"]),
            final_url=download.final_url or item.get("url"),
            method="browser",
        )

    # Sidecar bytes go through exactly the same validation as a direct download: a headless
    # click can land on an error/login page just like a plain GET can.
    content_type, sniffed, kind, error = validate_document(content, download.content_type)
    if kind:
        return _result(
            item["id"],
            "failed",
            failure_kind=kind,
            error=error,
            final_url=download.final_url or item.get("url"),
            method="browser",
        )
    return _store(
        item,
        settings,
        archive_root,
        content,
        content_type,
        sniffed,
        download.final_url or item.get("url"),
        "browser",
        fetched_at,
    )


def archive_attachments(
    request,
    session=None,
    sleep=time.sleep,
    monotonic=time.monotonic,
    now=now_iso,
    browser_client=None,
):
    """Execute one archive request and return the C1 response dict."""
    _validate_request(request)

    started = perf_counter()
    archive_root = request["archive_root"]
    settings = _source_settings(request.get("source"))
    items = request["items"]
    browser_url = request.get("browser_downloader_url")

    client = session or requests.Session()
    close_client = session is None
    # A browser-mode source with no reachable sidecar URL cannot produce bytes at all; every
    # item is then `browser_unavailable` (retryable), never a silent direct-GET fallback.
    if browser_client is None and settings["mode"] == "browser" and (browser_url or "").strip():
        browser_client = BrowserDownloaderClient(browser_url, session=client)

    results = []
    last_request_at = None
    try:
        for item in items:
            try:
                url = item.get("url") or item.get("original_url")
                if not is_public_http_url(url):
                    results.append(
                        _result(
                            item["id"],
                            "unavailable",
                            failure_kind="unavailable",
                            error="Attachment URL is not public HTTP(S).",
                            final_url=url,
                        )
                    )
                    continue
                if looks_browser_or_login_required(url):
                    results.append(
                        _result(
                            item["id"],
                            "unavailable",
                            failure_kind="unavailable",
                            error="Attachment URL appears to require browser/login access.",
                            final_url=url,
                        )
                    )
                    continue
                item = dict(item, url=url)

                if settings["mode"] == "browser" and browser_client is None:
                    results.append(
                        _result(
                            item["id"],
                            "failed",
                            failure_kind="browser_unavailable",
                            error="Source is in browser mode but no browser_downloader_url was provided.",
                            final_url=url,
                            method="browser",
                        )
                    )
                    continue

                # One polite pause per OUTGOING request; skipped items never consume it.
                if last_request_at is not None:
                    remaining = settings["min_interval_seconds"] - (monotonic() - last_request_at)
                    if remaining > 0:
                        sleep(remaining)
                last_request_at = monotonic()

                fetched_at = now()
                if settings["mode"] == "browser":
                    result = _archive_browser(item, settings, archive_root, browser_client, fetched_at)
                else:
                    result = _archive_direct(item, settings, archive_root, client, fetched_at)
            except Exception as error:  # noqa: BLE001 - fail-open per item, by contract
                result = _result(
                    item.get("id") if isinstance(item, dict) else None,
                    "failed",
                    failure_kind="network",
                    error="{0}: {1}".format(type(error).__name__, error),
                    method=settings["mode"],
                )
            if result["archive_status"] != "archived":
                _log(
                    "archive-attachments {0} item={1} status={2} kind={3}: {4}".format(
                        settings["id"], result["id"], result["archive_status"],
                        result["failure_kind"], result["archive_error"],
                    )
                )
            results.append(result)
    finally:
        if close_client:
            client.close()

    stats = {"archived": 0, "failed": 0, "unavailable": 0}
    for result in results:
        if result["archive_status"] in stats:
            stats[result["archive_status"]] += 1
    stats["duration_ms"] = int((perf_counter() - started) * 1000)
    return {"results": results, "stats": stats}
