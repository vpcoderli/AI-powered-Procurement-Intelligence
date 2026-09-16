"""`discover-tenant` (contract C4): read-only probing for a moved tenant path.

Four BidNet county sources answer 404 because their `base_url` tenant slug changed. This
module guesses the small, well-known set of alternative paths, fetches at most `max_requests`
of them spaced by `min_interval_seconds`, and reports what it saw. It **suggests** — nothing
here ever writes a `base_url`; an admin confirms the change.

It aborts the whole probe the moment the platform answers with a WAF challenge (HTTP 202):
hammering a bot-managed host to "find" a path is exactly the access pattern we avoid.

stdlib + `requests` only.
"""

import re
import time
from urllib.parse import urlparse, urlunparse

import requests

from apsi_crawler.content_quality import detect_empty_list, tenant_is_confirmed
from apsi_crawler.html.public_page import BROWSER_REQUEST_HEADERS


DEFAULT_MAX_REQUESTS = 6
DEFAULT_MIN_INTERVAL_SECONDS = 3.0
WAF_CHALLENGE_STATUS = 202
SUPPORTED_PROVIDER_FAMILIES = ("bidnet",)

STATE_PATH_NAMES = {
    "AL": "alabama", "AK": "alaska", "AZ": "arizona", "AR": "arkansas", "CA": "california",
    "CO": "colorado", "CT": "connecticut", "DE": "delaware", "DC": "district-of-columbia",
    "FL": "florida", "GA": "georgia", "HI": "hawaii", "ID": "idaho", "IL": "illinois",
    "IN": "indiana", "IA": "iowa", "KS": "kansas", "KY": "kentucky", "LA": "louisiana",
    "ME": "maine", "MD": "maryland", "MA": "massachusetts", "MI": "michigan", "MN": "minnesota",
    "MS": "mississippi", "MO": "missouri", "MT": "montana", "NE": "nebraska", "NV": "nevada",
    "NH": "new-hampshire", "NJ": "new-jersey", "NM": "new-mexico", "NY": "new-york",
    "NC": "north-carolina", "ND": "north-dakota", "OH": "ohio", "OK": "oklahoma", "OR": "oregon",
    "PA": "pennsylvania", "RI": "rhode-island", "SC": "south-carolina", "SD": "south-dakota",
    "TN": "tennessee", "TX": "texas", "UT": "utah", "VT": "vermont", "VA": "virginia",
    "WA": "washington", "WV": "west-virginia", "WI": "wisconsin", "WY": "wyoming",
}

_BIDNET_TAIL = "solicitations/open-bids"
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_TAG_RE = re.compile(r"<[^>]+>")
_ROW_RE = re.compile(r'<tr[^>]+class="[^"]*mets-table-row[^"]*"', re.I)


class InvalidDiscoveryRequestError(Exception):
    pass


def _page_title(html):
    match = _TITLE_RE.search(html or "")
    if not match:
        return None
    return " ".join(_TAG_RE.sub(" ", match.group(1)).split()) or None


def _slugify(value):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", (value or "").lower())).strip("-")


def _slug_variants(slug, state_code, state_name):
    """`franklin-county-oh` -> `[franklin-county-oh, franklin-county, franklin-county-ohio]`."""
    code = (state_code or "").lower()
    base = slug
    for suffix in [suffix for suffix in (code, state_name) if suffix]:
        if slug.endswith("-" + suffix):
            base = slug[: -(len(suffix) + 1)]
            break

    variants = []
    for candidate in (slug, base, "{0}-{1}".format(base, code) if code else None,
                      "{0}-{1}".format(base, state_name) if state_name else None):
        if candidate and candidate not in variants:
            variants.append(candidate)
    return variants


def build_candidate_urls(base_url, label, state_code, provider_family, max_requests=DEFAULT_MAX_REQUESTS):
    """Ordered, deduped candidate tenant URLs, capped at `max_requests`.

    Order follows C4: `/{state-name}/{slug}/…` for each slug variant, then `/{slug}/…`, then
    the source's current URL last (it is usually the one already known to 404).
    """
    if provider_family not in SUPPORTED_PROVIDER_FAMILIES:
        return []

    parts = urlparse(base_url)
    state_name = STATE_PATH_NAMES.get((state_code or "").upper())
    segments = [segment for segment in (parts.path or "").split("/") if segment]
    prefix = segments[: segments.index("solicitations")] if "solicitations" in segments else segments
    # Parenthetical platform notes ("(BidNet)") are never part of a tenant slug.
    slug = prefix[-1] if prefix else _slugify(re.sub(r"\(.*?\)", " ", label))
    if not slug:
        return []

    variants = _slug_variants(slug, state_code, state_name)

    paths = []
    if state_name:
        paths.extend("/{0}/{1}/{2}".format(state_name, variant, _BIDNET_TAIL) for variant in variants)
    paths.extend("/{0}/{1}".format(variant, _BIDNET_TAIL) for variant in variants)

    candidates = []
    for path in paths:
        url = urlunparse((parts.scheme, parts.netloc, path, "", parts.query, ""))
        if url not in candidates:
            candidates.append(url)
    if base_url not in candidates:
        candidates.append(base_url)
    return candidates[: max(1, int(max_requests))]


def _probe(session, url, label, timeout):
    response = session.get(url, params=None, headers=BROWSER_REQUEST_HEADERS, timeout=timeout)
    status = int(getattr(response, "status_code", 0) or 0)
    html = getattr(response, "text", "") or ""
    title = _page_title(html)
    empty = detect_empty_list(html, label) if status == 200 else {"detected": False}
    return {
        "url": url,
        "status": status,
        "title": title,
        "label_match": bool(status == 200 and tenant_is_confirmed(title, html, label)),
        "rows": len(_ROW_RE.findall(html)) if status == 200 else 0,
        "empty_state": bool(empty["detected"]),
    }


def discover_tenant(payload, session=None, sleep=None, timeout=30):
    """Contract C4. Returns `{candidates, suggested_base_url, reason}`; never writes anything."""
    payload = payload if isinstance(payload, dict) else {}
    # Resolved here, not in the signature, so a test (or an operator script) can swap the
    # module-level sleeper without the default argument having captured the original.
    sleep = sleep or time.sleep
    base_url = (payload.get("base_url") or "").strip()
    label = (payload.get("label") or "").strip()
    if not base_url or urlparse(base_url).scheme not in ("http", "https") or not urlparse(base_url).netloc:
        raise InvalidDiscoveryRequestError("base_url must be an absolute http(s) URL")
    if not label:
        raise InvalidDiscoveryRequestError("label is required to confirm a tenant page")

    provider_family = payload.get("provider_family") or "bidnet"
    max_requests = max(1, min(20, int(payload.get("max_requests") or DEFAULT_MAX_REQUESTS)))
    min_interval = max(0.0, float(payload.get("min_interval_seconds") or DEFAULT_MIN_INTERVAL_SECONDS))

    candidates = build_candidate_urls(base_url, label, payload.get("state_code"), provider_family, max_requests)
    if not candidates:
        return {
            "candidates": [],
            "suggested_base_url": None,
            "reason": "unsupported_provider_family"
            if provider_family not in SUPPORTED_PROVIDER_FAMILIES
            else "no_candidate_generated",
        }

    client = session or requests.Session()
    close_client = session is None
    results = []
    try:
        for index, url in enumerate(candidates):
            if index:
                sleep(min_interval)
            try:
                result = _probe(client, url, label, timeout)
            except requests.RequestException:
                # A transport error on one candidate is data, not a crash: record it as
                # status 0 and keep probing the remaining (budgeted) candidates.
                results.append(
                    {"url": url, "status": 0, "title": None, "label_match": False, "rows": 0, "empty_state": False}
                )
                continue
            results.append(result)
            if result["status"] == WAF_CHALLENGE_STATUS:
                return {"candidates": results, "suggested_base_url": None, "reason": "waf_challenge"}
            if result["label_match"] and (result["rows"] > 0 or result["empty_state"]):
                return {"candidates": results, "suggested_base_url": url, "reason": "confirmed"}
    finally:
        if close_client:
            client.close()

    return {"candidates": results, "suggested_base_url": None, "reason": "no_candidate_matched"}
