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
from datetime import date, datetime
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

LIST_KINDS = ("open", "closed", "awarded")
DEFAULT_LIST_PAGES = 4
MAX_LIST_PAGES = 50
_MAX_START_PAGE = 100000
_READER_FIELDS = ("solicitation_number", "region", "lifecycle_status", "list_kind", "detail_access")


class ListPageReadError(Exception):
    """The page reader and the adapter parser disagree about whether a page has rows."""


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


def _fetch_list_html(source, list_adapter, config, session, renderer, timeout, url=None):
    url = url or list_adapter.list_url(source)
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


def _iso_date(value):
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _list_date(record, list_kind):
    """The date a list is ordered by: award date on the awarded list, closing date otherwise."""
    value = record.get("awarded_date" if list_kind == "awarded" else "deadline_date")
    try:
        return datetime.strptime(str(value).strip(), "%m/%d/%Y").date()
    except (TypeError, ValueError):
        return None


def resolve_pagination_request(payload):
    """`list_kind` / `start_page` / `max_pages` / `stop_before` from a fetch-task payload.

    Numbers clamp like every other knob here; a list kind or date the crawler cannot act on
    raises ValueError, which fetch-task reports as a failed run instead of guessing.
    """
    payload = payload or {}
    list_kind = payload.get("list_kind") or "open"
    if list_kind not in LIST_KINDS:
        raise ValueError("list_kind must be one of: {0}".format(", ".join(LIST_KINDS)))
    stop_before = payload.get("stop_before")
    if stop_before is not None:
        stop_before = _iso_date(stop_before)
        if stop_before is None:
            raise ValueError("stop_before must be an ISO yyyy-mm-dd date")
    return {
        "list_kind": list_kind,
        "start_page": _clamp(payload.get("start_page"), 1, _MAX_START_PAGE, 1, int),
        "max_pages": _clamp(payload.get("max_pages"), 1, MAX_LIST_PAGES, DEFAULT_LIST_PAGES, int),
        "stop_before": stop_before,
    }


def _overlay_reader_fields(record, reader_record):
    """Sidecar row + what only the adapter's reader knows about the same bid on the same page."""
    if not reader_record:
        return record
    merged = dict(record)
    for field in _READER_FIELDS:
        if reader_record.get(field) is not None:
            merged[field] = reader_record[field]
    # The reader knows which date is which (the awarded list's second date is an award date,
    # which generic heuristics read as a deadline).
    merged["deadline_date"] = reader_record.get("deadline_date")
    merged["awarded_date"] = reader_record.get("awarded_date")
    if not merged.get("published_date"):
        merged["published_date"] = reader_record.get("published_date")
    return merged


def _page_bids(source, config, extractor, html, final_url, reading):
    """Rows of one fetched page: `(bids, method, diagnostics, fallback_reason)`."""
    if config["mode"] != "scrapling":
        return [normalize_state_opportunity(record, source) for record in reading.records], "adapter", {}, None
    by_id = {record["source_bid_id"]: record for record in reading.records}
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
        records = [record for record in (_record_from_item(item, source) for item in payload["items"][: config["max_items"]]) if record]
        if records:
            merged = [_overlay_reader_fields(record, by_id.get(record["source_bid_id"])) for record in records]
            return [normalize_state_opportunity(record, source) for record in merged], "scrapling", payload.get("diagnostics", {}), None
        reason = "no_items: extractor returned no usable rows"
    except ListExtractionError as error:
        reason = "{0}: {1}".format(getattr(error, "reason", "extractor_unreachable"), error)
    return [normalize_state_opportunity(record, source) for record in reading.records], "adapter_fallback", {}, reason


def _raise_empty_first_page(source, list_adapter, html, config, request):
    """Page 1 had no rows at all: the adapter's parser decides, as the single-page stage does."""
    pagination = {
        "list_kind": request["list_kind"], "start_page": request["start_page"], "pages_fetched": 1,
        "next_page": None, "stopped_reason": "exhausted", "requests_made": 1, "complete": True,
    }
    method = "scrapling" if config["mode"] == "scrapling" else "adapter"
    try:
        list_adapter.parse_list_html(source, html, query=None, limit=1)
    except VerifiedEmptyListError as error:
        raise VerifiedEmptyListError(error.marker, error.tenant_confirmed, method=method, pagination=pagination) from error
    raise ListPageReadError("{0}: the page reader found no rows the adapter parser could read".format(source.id))


def run_paginated_list_extraction(
    source,
    list_adapter,
    config,
    request,
    query=None,
    limit=None,
    session=None,
    extractor=None,
    renderer=None,
    timeout=30,
):
    """Page through one list of an adapter that can read its own pagination.

    Returns `(bids, metadata.listExtraction, metadata.pagination)`. Each page is fetched exactly
    once. Rows come from the sidecar in scrapling mode (the adapter's parser is the per-page
    fallback) and from the adapter's parser otherwise; the adapter's page reader supplies the
    number, the lifecycle and the next page. `complete` is true only when the walk reached a page
    without a next link, nothing was cut by `limit`/`query`, and every row the reader saw is in
    the result -- the one condition under which the importers may close delisted bids.
    """
    list_kind = request["list_kind"]
    extractor_url = config.get("extractor_url")
    if config["mode"] == "scrapling" and extractor is None:
        extractor = ListExtractorClient(extractor_url)

    url = list_adapter.page_url(source, list_kind, request["start_page"])
    page_number = request["start_page"]
    bids, methods = [], []
    diagnostics, fallback_reason = None, None
    covered, rendered, pages_fetched = True, False, 0
    stopped_reason, next_page = "exhausted", None

    while True:
        html, final_url, page_rendered = _fetch_list_html(source, list_adapter, config, session, renderer, timeout, url=url)
        pages_fetched += 1
        rendered = rendered or page_rendered
        reading = list_adapter.page_reader(source, html, list_kind)
        page_bids, method, page_diagnostics, reason = _page_bids(source, config, extractor, html, final_url, reading)
        if pages_fetched == 1 and not page_bids and not reading.records:
            _raise_empty_first_page(source, list_adapter, html, config, request)

        methods.append(method)
        diagnostics = page_diagnostics if diagnostics is None else diagnostics
        fallback_reason = fallback_reason or reason
        page_ids = {bid["source_bid_id"] for bid in page_bids}
        if any(record["source_bid_id"] not in page_ids for record in reading.records):
            covered = False
        bids.extend(page_bids)

        stop_before = request["stop_before"]
        if stop_before and reading.records and all(
            (_list_date(record, list_kind) or date.max) < stop_before for record in reading.records
        ):
            stopped_reason = "window"
            break
        if reading.next_url is None:
            break
        if pages_fetched >= request["max_pages"]:
            stopped_reason = "max_pages"
            next_page = reading.next_page or page_number + 1
            break
        url = reading.next_url
        page_number = reading.next_page or page_number + 1

    truncated = False
    if query:
        query_text = query.lower()
        bids = [bid for bid in bids if query_text in " ".join(str(value) for value in bid.values()).lower()]
        truncated = True
    if limit is not None and len(bids) > int(limit):
        bids = bids[: int(limit)]
        truncated = True
        stopped_reason = "limit"

    overall = "adapter_fallback" if "adapter_fallback" in methods else methods[0]
    stats = _stats(
        overall,
        len(bids),
        diagnostics or {},
        rendered,
        extractor_url if config["mode"] == "scrapling" else None,
        fallback_reason,
    )
    pagination = {
        "list_kind": list_kind,
        "start_page": request["start_page"],
        "pages_fetched": pages_fetched,
        "next_page": next_page,
        "stopped_reason": stopped_reason,
        "requests_made": pages_fetched,
        "complete": stopped_reason == "exhausted" and covered and not truncated,
    }
    return bids, stats, pagination
