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
import re
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
# A source's label is its display name plus decoration: a platform suffix in parens and,
# sometimes, a trailing ", XX" state code -- neither of which the tenant's own page title ever
# carries. Stripping them is what lets `_title_names_tenant` compare the two directly instead of
# relying on `content_quality.tenant_is_confirmed`'s single-token match, which a word as generic
# as "Services" can satisfy against a completely unrelated tenant's page (2026-09-24 review).
_LABEL_PAREN_RE = re.compile(r"\([^)]*\)")
_LABEL_STATE_SUFFIX_RE = re.compile(r",\s*[A-Za-z]{2}$")


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


def _tenant_display_name(label):
    """The label stripped of its "(Platform)" suffix and any trailing ", XX" state code."""
    name = _LABEL_PAREN_RE.sub("", label or "").strip()
    name = _LABEL_STATE_SUFFIX_RE.sub("", name).strip()
    return " ".join(name.split())


def _title_names_tenant(title, label):
    """Whether page 1's own `<title>` names the tenant `label` claims to be, whitespace-collapsed
    and case-insensitive. Deliberately a whole-string comparison, not a token match: a shared
    generic word (e.g. "Services") must never "confirm" the wrong tenant's empty page."""
    if not title:
        return False
    collapsed_title = " ".join(str(title).split())
    return collapsed_title.casefold() == _tenant_display_name(label).casefold()


def _overlay_reader_fields(record, reader_record, list_kind):
    """Sidecar row + what only the adapter's reader knows about the same bid on the same page.

    A sidecar row with no matching reader row is one the reader never corroborated -- it still
    fails that page's coverage check (see `run_paginated_list_extraction`) -- but it still needs
    *some* lifecycle, and the normalizer's blanket "open" default would reopen a bid on a
    closed/awarded walk. Give it the list's own default status instead, and, on the awarded list,
    treat whatever date the sidecar found as an award date rather than a deadline (the same
    correction the reader itself applies to rows it does recognize).
    """
    if not reader_record:
        merged = dict(record)
        merged["list_kind"] = list_kind
        merged["lifecycle_status"] = list_kind
        if list_kind == "awarded":
            merged["awarded_date"] = merged.get("deadline_date")
            merged["deadline_date"] = None
        return merged
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


def _page_bids(source, config, extractor, html, final_url, reading, list_kind):
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
            merged = [_overlay_reader_fields(record, by_id.get(record["source_bid_id"]), list_kind) for record in records]
            return [normalize_state_opportunity(record, source) for record in merged], "scrapling", payload.get("diagnostics", {}), None
        reason = "no_items: extractor returned no usable rows"
    except ListExtractionError as error:
        reason = "{0}: {1}".format(getattr(error, "reason", "extractor_unreachable"), error)
    return [normalize_state_opportunity(record, source) for record in reading.records], "adapter_fallback", {}, reason


def _fetch_paginated_page(source, list_adapter, session, timeout, url):
    """Fetch one page of a paginated walk.

    Always through the adapter's own `fetch_list_html`, never through `config["render"]`'s
    browser sidecar: that is what applies BidNet's 3-second WAF-politeness spacing and turns an
    HTTP 202 challenge into a classified error (`co_bidnet._fetch_bidnet_page`). A paged walk can
    make many more requests than the single-page stage in one run, so skipping that spacing to
    render instead would be exactly the "rapid back-to-back sweep" that trips the WAF.
    """
    html, final_url, _status = list_adapter.fetch_list_html(source, url, session=session, timeout=timeout)
    return html, final_url


def _raise_empty_first_page(source, list_adapter, html, config, request, title, total):
    """Page 1 had no rows at all: the adapter's parser decides, as the single-page stage does.

    A positive printed total contradicts an empty list outright: BidNet never prints one on a
    genuinely empty list (Erie's own empty page has none at all). A page that reports zero rows to
    both the reader and the adapter's own parser while still claiming a positive total is a layout
    break, not a verified empty tenant -- reported loudly (`ListPageReadError`, which `fetch_task`'s
    generic `except Exception` turns into a failed run) rather than as a zero-row success that
    would let `delistingApplies` close every open bid of the source.
    """
    if total is not None and total > 0:
        raise ListPageReadError(
            "{0}: page 1 printed a total of {1} but the reader and the adapter's own parser both "
            "found zero rows -- not a verified empty list".format(source.id, total)
        )
    method = "scrapling" if config["mode"] == "scrapling" else "adapter"
    try:
        list_adapter.parse_list_html(source, html, query=None, limit=1, list_kind=request["list_kind"])
    except VerifiedEmptyListError as error:
        pagination = {
            "list_kind": request["list_kind"], "start_page": request["start_page"], "pages_fetched": 1,
            "next_page": None, "stopped_reason": "exhausted", "requests_made": 1,
            "complete": (
                error.tenant_confirmed
                and _title_names_tenant(title, source.source_label)
                and request["start_page"] == 1
            ),
        }
        raise VerifiedEmptyListError(error.marker, error.tenant_confirmed, method=method, pagination=pagination) from error
    raise ListPageReadError(
        "{0}: the page reader found no rows on a page the adapter's own parser could read".format(source.id)
    )


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
    once, always through the adapter's own fetcher (`renderer`/`config["render"]` are accepted for
    interface symmetry with the single-page stage but never used here -- see
    `_fetch_paginated_page`). Rows come from the sidecar in scrapling mode (the adapter's parser is
    the per-page fallback) and from the adapter's parser otherwise; the adapter's page reader
    supplies the number, the lifecycle and the next page.

    `complete` is true only when ALL of the following hold -- each one guards a way a partial walk
    could otherwise look finished, which matters because the importers close every open bid of
    this source a `complete: True` run did not return:
      * the walk reached a page with no next link on its own (`stopped_reason == "exhausted"`);
      * it started at page 1 -- a walk starting later never saw the earlier pages;
      * every page's row ids exactly match what the page's own reader saw there (not just a
        superset: a sidecar-only row the reader never corroborated is as suspect as a dropped one);
      * no page the reader could not read at all was treated as the end of the list -- the walk
        stops there immediately instead (`stopped_reason == "unreadable_page"`) and never follows
        that page's next link, keeping any sidecar rows already found there without ever letting
        them count toward completeness;
      * nothing was cut by `limit` or `query`;
      * the next link was never a page already fetched (`stopped_reason == "repeated_page"`);
      * page 1's own printed result total is known, every page agreed on it, and the number of
        unique bids collected equals it;
      * page 1's own `<title>` names the source's tenant (guards a misconfigured `base_url` or a
        weak `tenant_is_confirmed` token match from ever being called "complete").
    """
    list_kind = request["list_kind"]
    label = source.source_label
    extractor_url = config.get("extractor_url")
    if config["mode"] == "scrapling" and extractor is None:
        extractor = ListExtractorClient(extractor_url)

    url = list_adapter.page_url(source, list_kind, request["start_page"])
    page_number = request["start_page"]
    bids, methods = [], []
    seen_ids, fetched_urls = set(), set()
    diagnostics, fallback_reason = None, None
    covered, pages_fetched = True, 0
    stopped_reason, next_page = "exhausted", None
    expected_total, totals_match, tenant_ok, truncated = None, True, False, False

    while True:
        if url in fetched_urls:
            # A next link that loops back to an already-fetched page (seen once with a tenant
            # whose "next" wrongly pointed at page 1): re-fetching it would just repeat forever.
            stopped_reason = "repeated_page"
            break
        fetched_urls.add(url)

        html, final_url = _fetch_paginated_page(source, list_adapter, session, timeout, url)
        pages_fetched += 1
        reading = list_adapter.page_reader(source, html, list_kind)
        page_bids, method, page_diagnostics, reason = _page_bids(source, config, extractor, html, final_url, reading, list_kind)
        if pages_fetched == 1 and not page_bids and not reading.records:
            _raise_empty_first_page(source, list_adapter, html, config, request, reading.title, reading.total)

        methods.append(method)
        diagnostics = page_diagnostics if diagnostics is None else diagnostics
        fallback_reason = fallback_reason or reason

        reader_ids = {record["source_bid_id"] for record in reading.records}
        page_ids = {bid["source_bid_id"] for bid in page_bids}
        if not reader_ids:
            # The reader could not read this page at all -- a layout change, or a blank
            # interstitial mid-walk. Trusting it as "the last page" (it may even have no next
            # link of its own) could delist every bid after it, so the walk stops here and never
            # follows this page's own next link. But Scrapling is the main list-extraction path
            # (CLAUDE.md), not the reader: any sidecar rows already found on this same page are
            # still kept (deduplicated and limit-truncated like any other page) rather than
            # thrown away -- a reader-only layout break degrades to fewer/uncorroborated rows
            # instead of turning every run into a zero-row failure. They just can never make this
            # walk "complete" (adapter mode has no sidecar rows, so nothing changes there).
            stopped_reason = "unreadable_page"
            new_bids = [bid for bid in page_bids if bid["source_bid_id"] not in seen_ids]
            seen_ids.update(bid["source_bid_id"] for bid in new_bids)
            bids.extend(new_bids)
            if limit is not None and query is None and len(bids) > int(limit):
                bids = bids[: int(limit)]
                stopped_reason = "limit"
            break
        if reader_ids != page_ids:
            covered = False

        if pages_fetched == 1:
            expected_total = reading.total
            tenant_ok = _title_names_tenant(reading.title, label)
        totals_match = totals_match and reading.total is not None and reading.total == expected_total

        new_bids = [bid for bid in page_bids if bid["source_bid_id"] not in seen_ids]
        seen_ids.update(bid["source_bid_id"] for bid in new_bids)
        bids.extend(new_bids)

        if limit is not None and query is None and len(bids) >= int(limit):
            bids = bids[: int(limit)]
            stopped_reason = "limit"
            next_page = (reading.next_page or page_number + 1) if reading.next_url is not None else None
            truncated = True
            break

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

    if query:
        # Whether the filtered set happens to keep every row or not, a query only ever asked for
        # a subset -- it can never be used to prove the whole list was seen.
        query_text = query.lower()
        bids = [bid for bid in bids if query_text in " ".join(str(value) for value in bid.values()).lower()]
        truncated = True
        if limit is not None and len(bids) > int(limit):
            bids = bids[: int(limit)]

    overall = "adapter_fallback" if "adapter_fallback" in methods else methods[0]
    stats = _stats(
        overall,
        len(bids),
        diagnostics or {},
        False,
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
        "complete": (
            stopped_reason == "exhausted"
            and request["start_page"] == 1
            and covered
            and not truncated
            and tenant_ok
            and expected_total is not None
            and totals_match
            and len(seen_ids) == expected_total
        ),
    }
    return bids, stats, pagination
