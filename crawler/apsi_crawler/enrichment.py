"""Optional detail-page enrichment stage for fetch-task.

Fetches each normalized bid's source_url with the crawler's own requests path (browser UA,
per-source throttle) and asks the Scrapling extractor sidecar to pull description,
attachments, category, contact and published date out of the HTML. Fills missing/summary values,
never raises into fetch_task (fail-open), and reports transparent stats.
"""

import os
import re
import sys
import time
from copy import deepcopy
from urllib.parse import parse_qs, quote, unquote, urlparse

import requests

from apsi_crawler.html.public_page import fetch_page
from apsi_crawler.content_quality import comparable_text, has_full_body, is_body, is_login_html, same_text, useful_text
from apsi_crawler.date_window import normalize_published_date
from apsi_crawler.storage.sqlite import now_iso

ENRICHMENT_FIELDS = ("description", "attachments", "category", "contact", "published_date")
_FIELD_GROUPS = {
    "description": ("description", "full_description"),
    "category": ("original_category",),
    "contact": ("contact_name", "contact_email", "contact_phone"),
    "published_date": ("published_date",),
    "attachments": (),
}
_TEXT_FIELDS = frozenset(key for keys in _FIELD_GROUPS.values() for key in keys)
_DETAIL_ID_KEYS = frozenset(("id", "sid", "docid", "bidid", "bidnumber", "bidnbr", "solicitationid", "solicitationnumber", "eventid", "noticeid", "projectid", "adid"))
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
# Portals that require a vendor account answer a detail URL with 302 → login page + HTTP 200.
# The HTML that comes back is a login screen, not bid content, so it must never reach the
# extractor: the heuristics would happily turn the login navigation bar into a "description".
# We detect that and count the record as failed. Nothing here bypasses a login.
_LOGIN_PATH_MARKERS = ("/login", "/signin", "/sign-in", "/account/login", "/auth")
_LOGIN_MARKER_SEGMENTS = tuple(
    tuple(segment for segment in marker.split("/") if segment) for marker in _LOGIN_PATH_MARKERS
)


def _path_segments(path):
    return [segment for segment in unquote(path or "").lower().split("/") if segment]


def _comparable_host(parts):
    """Host identity for redirect comparison: case, default port and a `www.` prefix are noise.

    `urlparse().hostname` already lowercases and drops the port and any userinfo, so an apex →
    `www` redirect (or an explicit `:443`) is the SAME portal, not a bounce off target. Without
    this, every detail fetch on such a source is counted as a failure and enrichment yields
    nothing for it.
    """
    try:
        host = (parts.hostname or "").lower()
    except ValueError:  # malformed netloc (e.g. a bad port) — treat it as its own host
        host = (parts.netloc or "").lower()
    return host[4:] if host.startswith("www.") else host


def _has_login_marker(segments):
    """True when the path contains a login marker as WHOLE segments.

    Substring matching would flag a portal path like `/authority/bid/7` (contains "/auth") or
    `/loginpage/7` as a login bounce and silently disable enrichment for that source.
    """
    for marker in _LOGIN_MARKER_SEGMENTS:
        width = len(marker)
        for start in range(len(segments) - width + 1):
            if tuple(segments[start:start + width]) == marker:
                return True
    return False


class ExtractorError(Exception):
    pass


class RedirectedOffTarget(Exception):
    """The fetched page is not the requested detail page (login wall / bounce to a list page)."""


def detect_off_target_redirect(requested_url, final_url, redirected):
    """Return a short reason string when `final_url` is not the requested detail page, else None.

    Compare the host, login route and detail identity in the path/query:
      1. the final host differs from the requested host;
      2. the final path picked up a login marker the requested path did not have;
      3. a redirect ran AND the final path no longer carries the requested path's last segment
         (typically the ad id), i.e. we landed on some other page of the same portal.
    """
    requested = urlparse(requested_url or "")
    final = urlparse(final_url or "")
    if not final.netloc:
        return None

    if _comparable_host(final) != _comparable_host(requested):
        return "host is not the requested host"

    # Both paths are percent-decoded before comparison: `requests` re-quotes the URL when
    # preparing it, so a requested `/bid/RFP 26-101` comes back as `/bid/RFP%2026-101` and a
    # raw comparison would "lose" the id that is plainly still there.
    requested_segments = _path_segments(requested.path)
    final_segments = _path_segments(final.path)
    if _has_login_marker(final_segments) and not _has_login_marker(requested_segments):
        return "login page"

    requested_query = {key.casefold().replace("_", ""): values for key, values in parse_qs(requested.query).items()}
    final_query = {key.casefold().replace("_", ""): values for key, values in parse_qs(final.query).items()}
    for key, values in requested_query.items():
        if key in _DETAIL_ID_KEYS and sorted(values) != sorted(final_query.get(key, [])):
            return "requested detail query identity changed or disappeared"

    if redirected:
        last_segment = requested_segments[-1] if requested_segments else ""
        if last_segment and last_segment not in final_segments:
            return "redirected away from the requested detail path"
    return None


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
        validate_extraction(payload)
        return payload


def resolve_attachment_url(raw_href, source_bid_id, template):
    if not template or not isinstance(template, str):
        return None
    if urlparse(template).scheme not in ("http", "https"):
        return None
    match = _QUOTED_DIGITS.search(raw_href or "")
    if not match:
        return None
    # The portal supplies source_bid_id; percent-encode it so an id carrying a space or an `&`
    # cannot produce a malformed URL or smuggle extra query parameters into the template.
    return template.replace("{id}", match.group(1)).replace(
        "{source_bid_id}", quote(str(source_bid_id or ""), safe="")
    )


def _empty(value):
    return value is None or (isinstance(value, str) and not value.strip())


def _attachment_key(url):
    """Identity of one document link, ignoring cosmetic differences between list and detail page.

    The same PDF is routinely linked as `https://Portal.gov/a.pdf` from the list page and
    `https://portal.gov:443/a.pdf#page=2` from the detail page; comparing the raw strings appends
    it a second time here, and the importer (which also matches on the exact URL) then persists a
    duplicate attachment row. Query strings are kept: they usually select a different document.
    """
    if not isinstance(url, str):
        return url
    parts = urlparse(url)
    try:
        host = (parts.hostname or "").lower()
        port = parts.port
    except ValueError:
        host, port = (parts.netloc or "").lower(), None
    default_port = {"http": 80, "https": 443}.get(parts.scheme.lower())
    if port is not None and port != default_port:
        host = f"{host}:{port}"
    return (parts.scheme.lower(), host, parts.path.rstrip("/"), parts.query)


def validate_extraction(extracted):
    """Validate the whole response before touching a bid, including injected clients."""
    if not isinstance(extracted, dict) or not isinstance(extracted.get("fields"), dict):
        raise ExtractorError("extractor payload missing fields")
    for key, value in extracted["fields"].items():
        if key not in _TEXT_FIELDS or (value is not None and not isinstance(value, str)):
            raise ExtractorError(f"invalid extractor field: {key}")
    attachments = extracted.get("attachments", [])
    if not isinstance(attachments, list):
        raise ExtractorError("extractor attachments must be a list")
    for attachment in attachments:
        if not isinstance(attachment, dict):
            raise ExtractorError("invalid extractor attachment")
        for key in ("name", "url", "raw_href", "size_label", "mime_type"):
            value = attachment.get(key)
            if value is not None and not isinstance(value, str):
                raise ExtractorError(f"invalid extractor attachment {key}")
    diagnostics = extracted.get("diagnostics", {})
    if not isinstance(diagnostics, dict) or any(
        key not in ENRICHMENT_FIELDS or value not in ("selector", "heuristic", "not_found")
        for key, value in diagnostics.items()
    ):
        raise ExtractorError("invalid extractor diagnostics")


def _description_complete(bid):
    raw = bid.get("raw_payload")
    enrichment = raw.get("enrichment") if isinstance(raw, dict) else None
    applied = enrichment.get("applied_fields", []) if isinstance(enrichment, dict) else []
    # Parser summaries are <=500 characters. A prose-looking list excerpt below that
    # limit still needs a detail attempt unless provenance says the text came from detail.
    description = bid.get("description")
    return has_full_body(bid) or (
        len(comparable_text(description)) > 500 and is_body(description, bid.get("title"))
    ) or (
        isinstance(applied, list) and "description" in applied and useful_text(bid.get("description"), bid.get("title"))
    )


def merge_enrichment(bid, extracted, template, requested_fields=None):
    validate_extraction(extracted)
    requested = ENRICHMENT_FIELDS if requested_fields is None else requested_fields
    allowed = {key for group in requested for key in _FIELD_GROUPS[group]}
    fields = {key: value for key, value in extracted["fields"].items() if key in allowed}
    # Build the complete update first; a malformed URL or response must not partially merge.
    updates = {}
    description = fields.get("description")
    full = fields.get("full_description")
    clear_full = False
    if not _description_complete(bid):
        if useful_text(description, bid.get("title")) and (
            not useful_text(bid.get("description"), bid.get("title"))
            or (
                (
                    not is_body(bid.get("description"), bid.get("title"))
                    or extracted.get("diagnostics", {}).get("description") == "selector"
                )
                and len(comparable_text(description)) > len(comparable_text(bid.get("description")))
            )
        ):
            updates["description"] = description
        next_description = updates.get("description", bid.get("description"))
        if useful_text(full, bid.get("title")) and not same_text(full, next_description):
            updates["full_description"] = full
        elif "description" in updates and "full_description" in fields and full is None:
            # The parser explicitly represents a complete short response with a null full
            # field. Apply that clear even when this fresh list record is already null:
            # persistence may contain an older full body that would hide the new short one.
            updates["full_description"] = None
            clear_full = True
        elif "description" in updates and bid.get("full_description") is not None:
            updates["full_description"] = None

    original_values = {}
    for key in ("original_category", "contact_name", "contact_email", "contact_phone", "published_date"):
        value = fields.get(key)
        if not _empty(value) and _empty(bid.get(key)):
            updates[key] = normalize_published_date(value) if key == "published_date" else value
            if key == "published_date":
                original_values[key] = value

    if "attachments" in requested:
        resolved = deepcopy(bid.get("attachments") or [])
        seen = {_attachment_key(item.get("url")) for item in resolved}
        for attachment in extracted.get("attachments", []):
            url = attachment.get("url") or resolve_attachment_url(attachment.get("raw_href"), bid.get("source_bid_id"), template)
            if not url or urlparse(url).scheme not in ("http", "https") or not urlparse(url).netloc:
                continue
            key = _attachment_key(url)
            if key in seen:
                continue
            seen.add(key)
            resolved.append({
                "name": attachment.get("name") or url,
                "url": url,
                "size_label": attachment.get("size_label"),
                "mime_type": attachment.get("mime_type"),
                "sort_order": len(resolved),
            })
        if len(resolved) > len(bid.get("attachments") or []):
            updates["attachments"] = resolved

    updates = {
        key: value for key, value in updates.items()
        if bid.get(key) != value or (key == "full_description" and clear_full)
    }
    raw_payload = deepcopy(bid.get("raw_payload"))
    if not isinstance(raw_payload, dict):
        raw_payload = {}
    raw_payload["enrichment"] = {"fields": deepcopy(extracted.get("diagnostics", {})), "applied_fields": list(updates)}
    if original_values:
        raw_payload["enrichment"]["original_values"] = original_values
    bid.update(updates)
    bid["raw_payload"] = raw_payload
    return bool(updates)


def _already_complete(bid, fields):
    """True when every requested field group already holds a real value (nothing to fill)."""
    checks = {
        "description": lambda: _description_complete(bid),
        # A list of links cannot prove that no new detail attachments exist.
        "attachments": lambda: False,
        "category": lambda: not _empty(bid.get("original_category")),
        "contact": lambda: all(not _empty(bid.get(key)) for key in ("contact_name", "contact_email", "contact_phone")),
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
                page = fetch_page(bid["source_url"], session=client, timeout=config["timeout_seconds"])
                off_target = detect_off_target_redirect(bid["source_url"], page.final_url, page.redirected)
                if off_target:
                    # Bail out before the extractor: the HTML is some other page (usually a login
                    # wall), and merging it would write portal chrome into the bid record.
                    raise RedirectedOffTarget(f"final url {page.final_url} — {off_target}")
                if len(page.html.encode("utf-8", errors="ignore")) > _MAX_HTML_BYTES:
                    raise ExtractorError("detail page exceeds 2 MB")
                if is_login_html(page.html):
                    raise RedirectedOffTarget("detail HTML contains a login form without bid content")
                extracted = extractor.extract(page.html, bid["source_url"], config["fields"], config["detail_selectors"])
                changed = merge_enrichment(bid, extracted, config["attachment_url_template"], config["fields"])
                bid["detail_fetched_at"] = now()
                # `enriched` counts WRITES, not parses: an extractor call that returned only
                # values the record already had (or nothing at all) changed no field, so the
                # record is a skip. Otherwise a source that answers with an empty SPA shell
                # reports enriched == attempted while filling in nothing.
                if changed:
                    stats["enriched"] += 1
                else:
                    stats["skipped"] += 1
            except Exception as error:  # noqa: BLE001 - fail-open by contract: never propagate to the caller
                stats["failed"] += 1
                # The stats dict shape is fixed by contract (fetch-task's stdout is parsed JSON),
                # so failure detail can't live there. Emit it to stderr instead — never stdout,
                # which carries only the JSON result — so an operator can still tell a portal 403
                # apart from a sidecar 500 or a genuine bug in merge_enrichment.
                print(
                    f"enrichment failed source={source.id} url={bid.get('source_url')}: "
                    f"{type(error).__name__}: {error}",
                    file=sys.stderr,
                )
    finally:
        if close_client:
            client.close()

    return bids, stats
