"""Optional detail-page enrichment stage for fetch-task.

Fetches each normalized bid's source_url with the crawler's own requests path (browser UA,
per-source throttle) and asks the Scrapling extractor sidecar to pull description,
attachments, category, contact and published date out of the HTML. Fills EMPTY values only,
never raises into fetch_task (fail-open), and reports transparent stats.
"""

import os
import re
import time
from urllib.parse import urlparse

import requests

from apsi_crawler.html.public_page import fetch_html
from apsi_crawler.storage.sqlite import now_iso

ENRICHMENT_FIELDS = ("description", "attachments", "category", "contact", "published_date")
_DEFAULTS = {
    "enabled": False,
    "max_details_per_run": 25,
    "min_interval_seconds": 3.0,
    "timeout_seconds": 20,
}
_HEALTH_TIMEOUT = 3.0
_EXTRACT_TIMEOUT = 10.0
_MAX_HTML_BYTES = 2 * 1024 * 1024
# Only digits inside quotes count as an id argument (e.g. downloadFile('998877')) — a bare
# digit inside unquoted parens (e.g. void(0)) is not a call argument we can trust.
_QUOTED_DIGITS = re.compile(r"['\"](\d+)['\"]")


class ExtractorError(Exception):
    pass


def _clamp(value, low, high, default, cast):
    try:
        number = cast(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def parse_enrichment_config(fetch_config):
    raw = (fetch_config or {}).get("enrichment")
    raw = raw if isinstance(raw, dict) else {}
    fields = raw.get("fields")
    if not isinstance(fields, list):
        fields = list(ENRICHMENT_FIELDS)
    fields = [field for field in fields if field in ENRICHMENT_FIELDS]
    selectors = raw.get("detail_selectors")
    selectors = selectors if isinstance(selectors, dict) else {}
    selectors = {
        key: value for key, value in selectors.items()
        if key in ENRICHMENT_FIELDS and isinstance(value, str) and value.strip()
    }
    template = raw.get("attachment_url_template")
    template = template if isinstance(template, str) and template.strip() else None
    return {
        "enabled": raw.get("enabled") is True,
        "fields": fields,
        "max_details_per_run": _clamp(raw.get("max_details_per_run"), 1, 200, _DEFAULTS["max_details_per_run"], int),
        "min_interval_seconds": _clamp(raw.get("min_interval_seconds"), 0.0, 60.0, _DEFAULTS["min_interval_seconds"], float),
        "timeout_seconds": _clamp(raw.get("timeout_seconds"), 5, 60, _DEFAULTS["timeout_seconds"], int),
        "detail_selectors": selectors,
        "attachment_url_template": template,
    }


class ExtractorClient:
    def __init__(self, base_url, session=None):
        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()

    def health(self, timeout=_HEALTH_TIMEOUT):
        try:
            response = self.session.get(f"{self.base_url}/health", timeout=timeout)
            if response.status_code != 200:
                return None
            payload = response.json()
        except (requests.RequestException, ValueError):
            return None
        return payload.get("scrapling") if isinstance(payload, dict) and payload.get("ok") else None

    def extract(self, html, url, fields, selectors, timeout=_EXTRACT_TIMEOUT):
        try:
            response = self.session.post(
                f"{self.base_url}/extract",
                json={"html": html, "url": url, "fields": list(fields), "selectors": selectors or None},
                timeout=timeout,
            )
        except requests.RequestException as error:
            raise ExtractorError(f"extractor request failed: {error}") from error
        try:
            payload = response.json()
        except ValueError as error:
            raise ExtractorError("extractor returned non-JSON") from error
        if response.status_code != 200:
            message = payload.get("error", {}).get("message") if isinstance(payload, dict) else None
            raise ExtractorError(f"extractor returned {response.status_code}: {message}")
        if not isinstance(payload, dict) or not isinstance(payload.get("fields"), dict):
            raise ExtractorError("extractor payload missing fields")
        return payload


def resolve_attachment_url(raw_href, source_bid_id, template):
    if not template or not isinstance(template, str):
        return None
    if urlparse(template).scheme not in ("http", "https"):
        return None
    match = _QUOTED_DIGITS.search(raw_href or "")
    if not match:
        return None
    return template.replace("{id}", match.group(1)).replace("{source_bid_id}", str(source_bid_id or ""))


def _empty(value):
    return value is None or (isinstance(value, str) and not value.strip())


def merge_enrichment(bid, extracted, template):
    fields = extracted.get("fields") or {}
    changed = False

    description = fields.get("description")
    if not _empty(description) and (_empty(bid.get("description")) or bid.get("description") == bid.get("title")):
        bid["description"] = description
        changed = True
    for key in ("full_description", "original_category", "contact_name", "contact_email", "contact_phone", "published_date"):
        value = fields.get(key)
        if not _empty(value) and _empty(bid.get(key)):
            bid[key] = value
            changed = True

    if not bid.get("attachments"):
        resolved = []
        for attachment in extracted.get("attachments") or []:
            url = attachment.get("url") or resolve_attachment_url(attachment.get("raw_href"), bid.get("source_bid_id"), template)
            if not url or urlparse(url).scheme not in ("http", "https"):
                continue
            resolved.append(
                {
                    "name": attachment.get("name") or url,
                    "url": url,
                    "size_label": attachment.get("size_label"),
                    "mime_type": attachment.get("mime_type"),
                    "sort_order": len(resolved),
                }
            )
        if resolved:
            bid["attachments"] = resolved
            changed = True

    raw_payload = bid.get("raw_payload")
    if not isinstance(raw_payload, dict):
        raw_payload = {}
    raw_payload["enrichment"] = {"fields": extracted.get("diagnostics") or {}}
    bid["raw_payload"] = raw_payload
    return changed


def _already_complete(bid, fields):
    """True when every requested field group already holds a real value (nothing to fill)."""
    checks = {
        "description": lambda: not _empty(bid.get("description")) and bid.get("description") != bid.get("title"),
        "attachments": lambda: bool(bid.get("attachments")),
        "category": lambda: not _empty(bid.get("original_category")),
        "contact": lambda: any(not _empty(bid.get(key)) for key in ("contact_name", "contact_email", "contact_phone")),
        "published_date": lambda: not _empty(bid.get("published_date")),
    }
    return all(checks[field]() for field in fields if field in checks)


def _needs_enrichment(bid, base_url, config):
    url = bid.get("source_url") or ""
    if urlparse(url).scheme not in ("http", "https"):
        return False
    if url.rstrip("/") == (base_url or "").rstrip("/"):
        return False
    if _already_complete(bid, config["fields"]):
        return False
    return True


def enrich_bids(bids, source, fetch_config, *, extractor=None, session=None, sleep=time.sleep, now=now_iso, monotonic=time.monotonic):
    config = parse_enrichment_config(fetch_config)
    stats = {"attempted": 0, "enriched": 0, "failed": 0, "skipped": 0, "reason": None, "extractor": None}

    if not config["enabled"]:
        stats["skipped"] = len(bids)
        stats["reason"] = "disabled"
        return bids, stats

    if extractor is None:
        extractor_base_url = os.environ.get("SCRAPLING_EXTRACTOR_URL", "").strip()
        if not extractor_base_url:
            stats["skipped"] = len(bids)
            stats["reason"] = "extractor_not_configured"
            return bids, stats
        extractor = ExtractorClient(extractor_base_url)

    version = extractor.health()
    if not version:
        stats["skipped"] = len(bids)
        stats["reason"] = "extractor_unavailable"
        return bids, stats
    stats["extractor"] = version

    base_url = (fetch_config or {}).get("base_url") or getattr(source, "base_url", "") or ""
    client = session or requests.Session()
    close_client = session is None
    last_request_at = None
    try:
        for bid in bids:
            if stats["attempted"] >= config["max_details_per_run"] or not _needs_enrichment(bid, base_url, config):
                stats["skipped"] += 1
                continue

            current_time = monotonic()
            if last_request_at is not None:
                remaining = config["min_interval_seconds"] - (current_time - last_request_at)
                if remaining > 0:
                    sleep(remaining)
            stats["attempted"] += 1
            last_request_at = monotonic()
            try:
                html = fetch_html(bid["source_url"], session=client, timeout=config["timeout_seconds"])
                if len(html.encode("utf-8", errors="ignore")) > _MAX_HTML_BYTES:
                    raise ExtractorError("detail page exceeds 2 MB")
                extracted = extractor.extract(html, bid["source_url"], config["fields"], config["detail_selectors"])
                merge_enrichment(bid, extracted, config["attachment_url_template"])
                bid["detail_fetched_at"] = now()
                stats["enriched"] += 1
            except Exception:  # noqa: BLE001 - fail-open by contract: never propagate to the caller
                stats["failed"] += 1
    finally:
        if close_client:
            client.close()

    return bids, stats
