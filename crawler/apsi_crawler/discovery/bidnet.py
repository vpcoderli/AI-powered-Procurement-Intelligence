"""`harvest_bidnet` (contract C1): read the BidNet Direct public agency directory.

Why this exists: BidNet's tenant paths have no derivable shape — `/city-of-aurora`,
`/colorado/boulder-county` and `/ohio/franklincountychildrensservices` are all real, and the
2026-09-16 batch of four 404 sources proved that guessing them does not work. The platform
publishes its own directory of participating agencies, so we read that instead of guessing.

What this module does and does not do:

* It only ever READS public pages. It registers nothing, writes no `base_url`, and touches no
  database. Everything it returns is a suggestion for a person to review.
* Every request carries the crawler's browser headers (`public_page.BROWSER_REQUEST_HEADERS`)
  and is spaced by `min_interval_seconds` through an injectable sleeper — BidNet fronts every
  page with AWS WAF Bot Control and a fast sweep gets the whole host challenged.
* A challenge — HTTP 202, or the interstitial body served with any status — stops the run and
  returns what was already collected. It is never solved or worked around.

Shape of the walk (measured 2026-09-21, fixtures under `tests/fixtures/discovery/`):

    /purchasing-groups                        -> ~49 group slugs, mostly state names
    /participating-buyers/changePage?...&pageNumber=N  -> 48 agency cards + a `Next` control

Python 3.9, stdlib + `requests` only.
"""

import re
import time
from html import unescape
from urllib.parse import urlparse

import requests

from apsi_crawler.html.public_page import HtmlPageError
from apsi_crawler.html.public_page import fetch_html as _fetch_html_default


class _Challenge(Exception):
    """Internal: the platform answered with a bot challenge instead of the page we asked for."""


# What a fetch is allowed to fail with. Anything else is a bug in this module and must surface
# as itself rather than be reported as a polite "the directory ended here".
_FETCH_ERRORS = (HtmlPageError, requests.RequestException)


BIDNET_BASE_URL = "https://www.bidnetdirect.com"
PURCHASING_GROUPS_URL = BIDNET_BASE_URL + "/purchasing-groups"
DIRECTORY_PAGE_URL_TEMPLATE = (
    BIDNET_BASE_URL + "/participating-buyers/changePage"
    "?target=paginationChange&purchasingGroupContext=true&pageNumber={0}"
)
TENANT_URL_TAIL = "/solicitations/open-bids"

DEFAULT_MAX_PAGES = 400
DEFAULT_MIN_INTERVAL_SECONDS = 3.0
DEFAULT_TIMEOUT_SECONDS = 30
# A hard ceiling so a typo in `max_pages` cannot turn a polite read into a day-long sweep.
MAX_PAGES_CEILING = 5000
WAF_CHALLENGE_STATUS = 202

# Group slug -> two-letter code. BidNet names most groups after the state. `mitn` is the one
# slug on `/purchasing-groups` that is not a state name but IS a single state: verified
# 2026-09-21, `/mitn` titles itself "Michigan Bids…" and reads "Michigan Inter-governmental
# Trade Network (MITN)", and 166 of the agency names it lists resolve against Michigan
# jurisdictions. Groups absent from that page (`bgis`, ...) stay unmapped: we do not guess a
# state, the caller reports them for a person to place.
STATE_CODE_BY_GROUP = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "district-of-columbia": "DC",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL",
    "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",
    "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI", "mitn": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new-hampshire": "NH", "new-jersey": "NJ", "new-mexico": "NM", "new-york": "NY",
    "north-carolina": "NC", "north-dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR",
    "pennsylvania": "PA", "rhode-island": "RI", "south-carolina": "SC", "south-dakota": "SD",
    "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA",
    "washington": "WA", "west-virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}

# First path segments that are platform chrome, never a tenant. `robots.txt` disallows several
# of these outright; the rest are marketing, auth and tab links that share the directory page.
NON_TENANT_SEGMENTS = frozenset(
    (
        "participating-buyers", "purchasing-groups", "solicitations", "public", "private",
        "resources", "buyers", "buyer-demo", "vendor-solutions", "company", "tsandcs",
        "favorites", "dev-tools", "ws", "jawr", "cms-view", "content", "supplier", "login",
    )
)

# The cards we want. A card is an `<a>` inside the agency grid; it always carries the grid-name
# span, the organisation-logo block, or both.
_AGENCY_MARKERS = ("participatingAgencyGridName", "organizationLogo", "Organization logo of")

_ANCHOR_RE = re.compile(r"<a\b[^>]*>.*?</a>", re.I | re.S)
_HREF_RE = re.compile(r"\bhref\s*=\s*\"([^\"]*)\"", re.I)
_GRID_NAME_RE = re.compile(
    r"<span[^>]*\bclass=\"[^\"]*mets-ellipsis[^\"]*\"[^>]*>(.*?)</span>", re.I | re.S
)
_LOGO_NAME_RE = re.compile(r"Organization logo of\s*(.*?)</span>", re.I | re.S)
_SCRIPT_RE = re.compile(r"<script\b.*?</script>", re.I | re.S)
_TAG_RE = re.compile(r"<[^>]+>")
# The last page keeps the `<div class="...mets-page-navigation-next">` wrapper but empties it,
# exactly the way page 1 empties the "previous" wrapper.
_NEXT_BLOCK_RE = re.compile(r"mets-page-navigation-next[^>]*>(.*?)</div>", re.I | re.S)
_NEXT_BUTTON_RE = re.compile(
    r"<button[^>]*\bclass=\"[^\"]*\bnext\b[^\"]*mets-page-navigation-trigger", re.I
)
_GROUP_LIST_RE = re.compile(r"<ul[^>]*\bclass=\"[^\"]*txtBullet[^\"]*\"[^>]*>(.*?)</ul>", re.I | re.S)
_GROUP_LINK_RE = re.compile(r"<a\b[^>]*\bhref=\"([^\"]*)\"[^>]*>(.*?)</a>", re.I | re.S)

# Markers of the AWS WAF interstitial. Deliberately specific: a directory page that merely
# mentions "verification" must not be mistaken for a challenge.
_WAF_BODY_MARKERS = (
    "awswaf",
    "aws-waf-token",
    "awswafintegration",
    "checkforcerefresh",
    "challenge.js",
    "x-amzn-waf-action",
)


def state_code_for_group(group):
    """`"ohio"` -> `"OH"`, `"mitn"` -> `"MI"`; a group of no single state (`bgis`, ...) -> None."""
    return STATE_CODE_BY_GROUP.get((group or "").strip().lower()) or None


def directory_page_url(page_number):
    """The paging endpoint from C1. `pageNumber` starts at 1."""
    return DIRECTORY_PAGE_URL_TEMPLATE.format(int(page_number))


def tenant_url(tenant_path):
    """`/ohio/x` -> the tenant's open-bids list page, which is what a source's base_url is."""
    return BIDNET_BASE_URL + tenant_path + TENANT_URL_TAIL


def looks_like_waf_challenge(html):
    """True when the body is the bot-challenge interstitial rather than a directory page."""
    lowered = (html or "").lower()
    return any(marker in lowered for marker in _WAF_BODY_MARKERS)


def has_next_control(html):
    """True when the pagination block still offers a `Next` button."""
    block = _NEXT_BLOCK_RE.search(html or "")
    if block:
        return "<button" in block.group(1).lower()
    return bool(_NEXT_BUTTON_RE.search(html or ""))


def _clean(value):
    return " ".join(unescape(value or "").replace("\xa0", " ").split())


def _agency_name(anchor_html):
    """The visible grid name, else the accessible logo copy, else the anchor's own text.

    The markup repeats the name: an `accessibility-hidden` span reading "Organization logo of
    <name>" followed by the visible span. Taking the visible span first keeps the name clean;
    the fallbacks only matter for cards that ship one half of that pair.
    """
    marker = anchor_html.find("participatingAgencyGridName")
    if marker >= 0:
        grid = _GRID_NAME_RE.search(anchor_html, marker)
        if grid:
            name = _clean(_TAG_RE.sub(" ", _SCRIPT_RE.sub(" ", grid.group(1))))
            if name:
                return name

    logo = _LOGO_NAME_RE.search(anchor_html)
    if logo:
        name = _clean(_TAG_RE.sub(" ", logo.group(1)))
        if name:
            return name

    return _clean(_TAG_RE.sub(" ", _SCRIPT_RE.sub(" ", anchor_html))) or None


def _tenant_path(href, known_groups=None):
    """Normalize an href to `/group/slug` or `/slug`, or None when it is not a tenant link."""
    href = unescape(href or "").strip()
    if not href or not href.startswith("/") or href.startswith("//"):
        return None

    parts = urlparse(href)
    segments = [segment for segment in (parts.path or "").split("/") if segment]
    if not 1 <= len(segments) <= 2:
        return None
    if any("." in segment for segment in segments):
        return None
    if segments[0].lower() in NON_TENANT_SEGMENTS:
        return None
    # A bare `/ohio` is the purchasing group's own landing page, not an agency. The footer of
    # every directory page links all ~49 of them.
    if len(segments) == 1:
        slug = segments[0].lower()
        if slug in STATE_CODE_BY_GROUP or slug in (known_groups or ()):
            return None

    return "/" + "/".join(segments)


def parse_agency_links(html, known_groups=None):
    """Agency cards on one directory page, in page order, as C1's `HarvestedAgency` dicts.

    `known_groups` is the slug set from `/purchasing-groups`; it only ever removes links (a
    one-segment path that is really a group landing page), never adds any.
    """
    agencies = []
    for anchor in _ANCHOR_RE.findall(html or ""):
        if not any(marker in anchor for marker in _AGENCY_MARKERS):
            continue
        href = _HREF_RE.search(anchor)
        if not href:
            continue
        path = _tenant_path(href.group(1), known_groups)
        if not path:
            continue
        name = _agency_name(anchor)
        if not name:
            continue
        group = path.strip("/").split("/")[0] if path.count("/") == 2 else None
        agencies.append(
            {
                "name": name,
                "tenant_path": path,
                "tenant_url": tenant_url(path),
                "group": group,
                "state_code": state_code_for_group(group),
            }
        )
    return agencies


def parse_purchasing_groups(html):
    """`/purchasing-groups` -> `[{"slug", "label", "state_code"}]`, deduped, in page order.

    The page renders the same `txtBullet` list twice (body and footer); both copies are read and
    deduped so a markup change on either one cannot empty the list.
    """
    groups = []
    seen = set()
    for block in _GROUP_LIST_RE.findall(html or ""):
        for href, text in _GROUP_LINK_RE.findall(block):
            href = unescape(href or "").strip()
            segments = [segment for segment in urlparse(href).path.split("/") if segment]
            if len(segments) != 1 or "." in segments[0]:
                continue
            slug = segments[0].lower()
            if slug in seen or slug in NON_TENANT_SEGMENTS:
                continue
            seen.add(slug)
            groups.append(
                {
                    "slug": slug,
                    "label": _clean(_TAG_RE.sub(" ", text)) or None,
                    "state_code": state_code_for_group(slug),
                }
            )
    return groups


def _positive_int(value, default, ceiling=None):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = int(default)
    number = max(1, number)
    return min(number, ceiling) if ceiling else number


def _non_negative_float(value, default):
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = float(default)
    return max(0.0, number)


def _wanted_states(states):
    if not states:
        return None
    wanted = {str(code).strip().upper() for code in states if str(code or "").strip()}
    return wanted or None


def harvest_bidnet(request, session=None, sleep=None, fetch_html=None):
    """Contract C1. Walk BidNet's public directory and report the agencies it lists.

    Returns `{"agencies": [HarvestedAgency, ...], "stats": {...}}`. `stats.agencies` is the
    length of the list actually returned — deduped and `states`-filtered — so a consumer that
    classifies that list can keep its own counts summing to it. `stats.duplicates` records how
    many repeated tenant paths were dropped on the way, and `stats.unresolved_state_skipped` how
    many were excluded by a `states` filter because their group resolves to no state (always 0
    when no filter is active). Alongside those, `pages` and `stopped_reason`:

    * `exhausted`    — the platform offered no `Next` control; the walk finished naturally.
    * `no_new_links` — a page repeated tenant paths already seen, so paging is looping.
    * `max_pages`    — the caller's page budget ran out.
    * `waf_challenge`— HTTP 202 or the challenge interstitial. Collected pages are still
      returned; the challenge is never solved.
    * `fetch_failed` — a directory page failed for an ordinary reason (5xx, transport). C1 does
      not name this case; ending the walk and keeping the earlier pages beats both crashing and
      pretending the directory ended here.

    `request` keys: `max_pages` (400), `min_interval_seconds` (3), `timeout_seconds` (30) and
    `states` (two-letter codes; omitted/empty means all). An explicit `states` filter excludes
    agencies whose group resolves to no state (`bgis`, ...) and counts them in
    `stats.unresolved_state_skipped`; they are only returned on an unfiltered run, where the
    caller routes them into its review list.

    Nothing here writes anything anywhere.
    """
    request = request if isinstance(request, dict) else {}
    # Resolved in the body, not in the signature, so a caller can swap either one per run.
    sleep = sleep or time.sleep
    fetcher = fetch_html or _fetch_html_default

    max_pages = _positive_int(request.get("max_pages"), DEFAULT_MAX_PAGES, MAX_PAGES_CEILING)
    min_interval = _non_negative_float(
        request.get("min_interval_seconds"), DEFAULT_MIN_INTERVAL_SECONDS
    )
    timeout = _positive_int(request.get("timeout_seconds"), DEFAULT_TIMEOUT_SECONDS)
    wanted_states = _wanted_states(request.get("states"))

    client = session or requests.Session()
    close_client = session is None
    requested = [0]

    def fetch(url):
        """Politeness lives here: nothing in this module reaches the network another way.

        Both shapes of challenge come back out of here as `_Challenge`: the 202 that
        `fetch_html` raises as an `HtmlPageError`, and the interstitial body that some fronts
        serve with a 200.
        """
        if requested[0]:
            sleep(min_interval)
        requested[0] += 1
        try:
            html = fetcher(url, session=client, timeout=timeout)
        except _FETCH_ERRORS as error:
            if getattr(error, "status_code", None) == WAF_CHALLENGE_STATUS:
                raise _Challenge()
            raise
        if looks_like_waf_challenge(html):
            raise _Challenge()
        return html

    agencies = []
    seen_paths = set()
    pages = 0
    duplicates = 0
    stopped_reason = "exhausted"

    try:
        try:
            groups = parse_purchasing_groups(fetch(PURCHASING_GROUPS_URL))
            known_groups = {group["slug"] for group in groups}
        except _Challenge:
            return _result([], 0, 0, "waf_challenge", None)
        except _FETCH_ERRORS:
            # The group list only ever filters out group landing pages; losing it costs us a
            # belt-and-braces check, not the harvest. The built-in state slugs still apply.
            known_groups = set()

        while pages < max_pages:
            try:
                html = fetch(directory_page_url(pages + 1))
            except _Challenge:
                stopped_reason = "waf_challenge"
                break
            except _FETCH_ERRORS:
                stopped_reason = "fetch_failed"
                break

            pages += 1
            new_on_page = 0
            for agency in parse_agency_links(html, known_groups):
                if agency["tenant_path"] in seen_paths:
                    duplicates += 1
                    continue
                seen_paths.add(agency["tenant_path"])
                new_on_page += 1
                agencies.append(agency)

            if not has_next_control(html):
                stopped_reason = "exhausted"
                break
            if not new_on_page:
                stopped_reason = "no_new_links"
                break
            if pages >= max_pages:
                stopped_reason = "max_pages"
                break
    finally:
        if close_client:
            client.close()

    return _result(agencies, pages, duplicates, stopped_reason, wanted_states)


def _result(agencies, pages, duplicates, stopped_reason, wanted_states):
    unresolved_state_skipped = 0
    if wanted_states:
        # An operator asking for ["OH"] wants Ohio, so an agency under a group that resolves to
        # no state is excluded rather than smuggled in. It is counted, never silently dropped:
        # a large count here means the platform groups hide agencies this filter cannot reach.
        kept = []
        for agency in agencies:
            if agency["state_code"] is None:
                unresolved_state_skipped += 1
            elif agency["state_code"] in wanted_states:
                kept.append(agency)
        agencies = kept
    return {
        "agencies": agencies,
        "stats": {
            "pages": pages,
            "agencies": len(agencies),
            "stopped_reason": stopped_reason,
            "duplicates": duplicates,
            "unresolved_state_skipped": unresolved_state_skipped,
        },
    }
