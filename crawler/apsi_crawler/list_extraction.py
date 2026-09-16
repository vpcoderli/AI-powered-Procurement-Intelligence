"""Scrapling list extraction — the MAIN list path (contracts C1/C2/C3).

Why the sidecar leads and the adapter follows: the dedicated adapters match list rows with
regular expressions against portal markup (`mets-table-row` and friends). Any template change
turns that into "page did not contain open solicitations", i.e. a hard source failure. The
sidecar's adaptive selectors survive most of those changes, so it parses first and the
adapter's own parser becomes the safety net.

Two invariants this module exists to keep:
  1. **Exactly one list HTTP request per run.** The HTML is fetched once and handed to the
     sidecar; the fallback re-parses that same string. Routing a source through Scrapling must
     never change how often we touch a portal.
  2. **Empty state is decided after extraction, from visible copy only.** Hidden template rows
     (aria-hidden / display:none) never count, and a page with parsed rows is never "empty".
"""

import os
from urllib.parse import urlparse

import requests

from apsi_crawler.content_quality import detect_empty_list
from apsi_crawler.errors import VerifiedEmptyListError
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


# C2 field set, in contract order.
LIST_FIELDS = ("title", "url", "published_date", "deadline_date", "source_bid_id", "issuer_name")
DEFAULT_MAX_ITEMS = 200
MAX_ITEMS_CEILING = 500
_EXTRACT_TIMEOUT = 20.0
_RENDER_TIMEOUT_HEADROOM = 15
_DIAGNOSTIC_VALUES = ("selector", "heuristic", "not_found")


class ListExtractionError(Exception):
    """The sidecar could not be used for this run — always recoverable via the adapter parser."""

    def __init__(self, message, reason="extractor_unreachable"):
        Exception.__init__(self, message)
        self.reason = reason


class ListRenderError(Exception):
    """browser-downloader `/render` refused or failed. Surfaced as a run failure, never hidden."""


def _clamp(value, low, high, default, cast):
    try:
        number = cast(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def _clean_selector(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


def resolve_list_extraction_config(fetch_config, extractor_url, adapter_supports_html):
    """Resolve `fetch_config.list_extraction` against what this deployment can actually run.

    `mode` defaults to "scrapling" when the sidecar URL is configured AND the adapter can hand
    us raw list HTML; an explicit "scrapling" with neither degrades to "adapter" rather than
    failing the run — a missing sidecar must never take a working source offline.
    """
    raw = (fetch_config or {}).get("list_extraction")
    raw = raw if isinstance(raw, dict) else {}
    extractor_url = (extractor_url or "").strip().rstrip("/")
    can_run_scrapling = bool(extractor_url) and bool(adapter_supports_html)

    mode = raw.get("mode")
    if mode not in ("scrapling", "adapter"):
        mode = "scrapling" if can_run_scrapling else "adapter"
    if mode == "scrapling" and not can_run_scrapling:
        mode = "adapter"

    selectors_raw = raw.get("selectors")
    selectors_raw = selectors_raw if isinstance(selectors_raw, dict) else {}
    selectors = {}
    for field in LIST_FIELDS:
        selector = _clean_selector(selectors_raw.get(field))
        if selector:
            selectors[field] = selector

    return {
        "mode": mode,
        "render": raw.get("render") is True,
        "item_selector": _clean_selector(raw.get("item_selector")),
        "max_items": _clamp(raw.get("max_items"), 1, MAX_ITEMS_CEILING, DEFAULT_MAX_ITEMS, int),
        "selectors": selectors,
        "extractor_url": extractor_url or None,
    }


class ListExtractorClient:
    """Speaks C2 `POST /extract-list`. Mirrors `enrichment.ExtractorClient`'s shape."""

    def __init__(self, base_url, session=None):
        self.base_url = (base_url or "").rstrip("/")
        self.session = session or requests.Session()

    def extract_list(self, html, url, item_selector=None, selectors=None, max_items=DEFAULT_MAX_ITEMS, timeout=None):
        body = {
            "url": url,
            "html": html,
            "item_selector": item_selector or None,
            "selectors": selectors or None,
            "fields": list(LIST_FIELDS),
            "max_items": max_items,
            "auto_save": True,
        }
        try:
            response = self.session.post(
                "{0}/extract-list".format(self.base_url), json=body, timeout=timeout or _EXTRACT_TIMEOUT
            )
        except requests.RequestException as error:
            raise ListExtractionError(
                "extractor request failed: {0}".format(error), reason="extractor_unreachable"
            )
        try:
            payload = response.json()
        except ValueError:
            raise ListExtractionError("extractor returned non-JSON", reason="extractor_error")
        if response.status_code != 200:
            message = payload.get("error", {}).get("message") if isinstance(payload, dict) else None
            raise ListExtractionError(
                "extractor returned {0}: {1}".format(response.status_code, message), reason="extractor_error"
            )
        return payload


class BrowserRendererClient:
    """Speaks C3 `POST /render` on the browser-downloader sidecar."""

    def __init__(self, base_url, session=None):
        self.base_url = (base_url or "").rstrip("/")
        self.session = session or requests.Session()

    def render(self, page_url, allowed_hosts=None, timeout_seconds=30, wait_for=None):
        if not self.base_url:
            raise ListRenderError("list_extraction.render is on but BROWSER_DOWNLOADER_URL is not configured")
        body = {
            "page_url": page_url,
            "allowed_hosts": list(allowed_hosts or []),
            "timeout_seconds": timeout_seconds,
            "wait_for": wait_for or {"selector": None, "network_idle": True},
        }
        try:
            response = self.session.post(
                "{0}/render".format(self.base_url), json=body, timeout=timeout_seconds + _RENDER_TIMEOUT_HEADROOM
            )
        except requests.RequestException as error:
            raise ListRenderError("browser downloader unreachable: {0}".format(error))
        try:
            payload = response.json()
        except ValueError:
            raise ListRenderError("browser downloader returned non-JSON")
        if response.status_code != 200:
            error = payload.get("error") if isinstance(payload, dict) else None
            error = error if isinstance(error, dict) else {}
            # LOGIN_WALL / OFF_HOST / TIMEOUT are guard verdicts, not transport noise: they stay
            # visible as run failures so an operator fixes the source instead of silently
            # ingesting whatever the sidecar happened to land on.
            raise ListRenderError(
                "browser downloader {0} {1}: {2}".format(
                    response.status_code, error.get("code") or "RENDER_FAILED", error.get("message") or ""
                )
            )
        html = payload.get("html") if isinstance(payload, dict) else None
        if not isinstance(html, str) or not html.strip():
            raise ListRenderError("browser downloader returned no HTML")
        return html, payload.get("final_url") or page_url, int(payload.get("status") or 200)


def validate_list_extraction(payload):
    """Reject a malformed C2 response before a single item can reach the normalizer."""
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise ListExtractionError("extractor payload missing items", reason="invalid_response")
    for item in payload["items"]:
        if not isinstance(item, dict):
            raise ListExtractionError("invalid extractor item", reason="invalid_response")
        for key, value in item.items():
            if key in LIST_FIELDS and value is not None and not isinstance(value, str):
                raise ListExtractionError("invalid extractor item field: {0}".format(key), reason="invalid_response")
    diagnostics = payload.get("diagnostics", {})
    if not isinstance(diagnostics, dict) or any(
        key not in LIST_FIELDS or value not in _DIAGNOSTIC_VALUES for key, value in diagnostics.items()
    ):
        raise ListExtractionError("invalid extractor diagnostics", reason="invalid_response")
    empty_state = payload.get("empty_state")
    if empty_state is not None and not isinstance(empty_state, dict):
        raise ListExtractionError("invalid extractor empty_state", reason="invalid_response")
    return payload


def _record_from_item(item, source):
    url = (item.get("url") or "").strip() or None
    source_bid_id = (item.get("source_bid_id") or "").strip() or url
    if not source_bid_id:
        return None
    return {
        "source_bid_id": source_bid_id,
        "title": item.get("title"),
        "description": item.get("title"),
        "published_date": item.get("published_date"),
        "deadline_date": item.get("deadline_date"),
        "issuer_name": (item.get("issuer_name") or "").strip() or source.source_label,
        "source_url": url or source.base_url,
        "attachments": [],
    }


def normalize_list_items(items, source, query=None, limit=25):
    records = [record for record in (_record_from_item(item, source) for item in items) if record]
    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]
    return [normalize_state_opportunity(record, source) for record in records[: int(limit)]]


def _host(url):
    try:
        return (urlparse(url or "").hostname or "").lower()
    except ValueError:
        return ""


def _stats(method, items, diagnostics, rendered, extractor, fallback_reason):
    return {
        "method": method,
        "items": items,
        "diagnostics": diagnostics,
        "rendered": rendered,
        "extractor": extractor,
        "fallback_reason": fallback_reason,
    }


def _fetch_list_html(source, list_adapter, config, session, renderer, timeout):
    url = list_adapter.list_url(source)
    if not config["render"]:
        html, final_url, _status = list_adapter.fetch_list_html(source, url, session=session, timeout=timeout)
        return html, final_url, False

    if renderer is None:
        renderer = BrowserRendererClient(os.environ.get("BROWSER_DOWNLOADER_URL", "").strip())
    html, final_url, _status = renderer.render(
        url,
        allowed_hosts=[host for host in [_host(url)] if host],
        timeout_seconds=timeout,
        wait_for={"selector": config["item_selector"], "network_idle": True},
    )
    return html, final_url, True


def run_list_extraction(
    source,
    list_adapter,
    config,
    query=None,
    limit=25,
    session=None,
    extractor=None,
    renderer=None,
    timeout=30,
):
    """Fetch the list page once, parse it with the sidecar, fall back to the adapter parser.

    Returns `(bids, metadata.listExtraction)`. Raises `VerifiedEmptyListError` when the page
    itself says it is empty, and lets adapter/render failures propagate as run failures.
    """
    html, final_url, rendered = _fetch_list_html(source, list_adapter, config, session, renderer, timeout)

    # Empty state is decided AFTER extraction, never before: a page that says "no open bids" in a
    # hidden template row while listing 16 real rows must yield those rows (BidNet, 2026-09-16).
    extractor_url = config.get("extractor_url")
    if extractor is None:
        extractor = ListExtractorClient(extractor_url)

    fallback_reason = None
    bids = []
    diagnostics = {}
    try:
        payload = validate_list_extraction(
            extractor.extract_list(
                html,
                final_url,
                item_selector=config["item_selector"],
                selectors=config["selectors"] or None,
                max_items=config["max_items"],
            )
        )
        diagnostics = payload.get("diagnostics", {})
        bids = normalize_list_items(payload["items"][: config["max_items"]], source, query=query, limit=limit)
        if not bids:
            # Zero items: either a genuinely empty page or a layout the sidecar did not understand.
            # The adapter parser below settles it — it raises VerifiedEmptyListError only when its
            # own parse also finds nothing AND the visible copy declares the list empty.
            fallback_reason = "no_items: extractor returned no usable rows"
    except ListExtractionError as error:
        fallback_reason = "{0}: {1}".format(getattr(error, "reason", "extractor_unreachable"), error)

    if fallback_reason is None:
        return bids, _stats("scrapling", len(bids), diagnostics, rendered, extractor_url, None)

    try:
        bids = list_adapter.parse_list_html(source, html, query=query, limit=limit)
    except VerifiedEmptyListError as error:
        raise VerifiedEmptyListError(error.marker, error.tenant_confirmed, method="scrapling") from error
    return bids, _stats("adapter_fallback", len(bids), {}, rendered, extractor_url, fallback_reason)
