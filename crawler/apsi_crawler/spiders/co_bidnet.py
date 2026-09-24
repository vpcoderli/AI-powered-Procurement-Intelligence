import re
import time
from collections import namedtuple
from html import unescape

from apsi_crawler.content_quality import detect_empty_list
from apsi_crawler.errors import VerifiedEmptyListError
from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    fetch_page,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


CO_BIDNET_URL = "https://www.bidnetdirect.com/colorado/solicitations/open-bids?selectedContent=BUYER"

BIDNET_ORIGIN = "https://www.bidnetdirect.com"

#: The three public tenant lists (verified 2026-09-24 on Denver): `open-bids` is the stored
#: base_url; `closed-bids` and `awarded-bids` are linked from every tenant page.
BIDNET_LIST_KINDS = ("open", "closed", "awarded")
_LIST_KIND_PATHS = {"open": "open-bids", "closed": "closed-bids", "awarded": "awarded-bids"}

#: Locked behind BidNet membership on every detail page (verified 2026-09-24): issuing
#: organization, description, bid documents and buyer contact. Carried on each record so the UI
#: can say so instead of rendering blanks -- we never log in to fetch them.
BIDNET_DETAIL_ACCESS = {"restricted": ["description", "documents", "contact"], "platform": "BidNet"}

BidnetListPage = namedtuple("BidnetListPage", ("records", "next_url", "next_page"))

_ROW_RE = re.compile(r'<tr[^>]+class="[^"]*mets-table-row[^"]*"[^>]*>(.*?)</tr>', re.I | re.S)
_LINK_RE = re.compile(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.I | re.S)
_SOL_NUM_RE = re.compile(r'class="sol-num"[^>]*>(.*?)</div>', re.I | re.S)
_REGION_RE = re.compile(r'class="sol-region-item"[^>]*>(.*?)</span>', re.I | re.S)
_PUBLISHED_RE = re.compile(r'class="sol-publication-date".*?class="date-value"[^>]*>([^<]+)<', re.I | re.S)
_CLOSING_RE = re.compile(r'class="sol-closing-date[^"]*".*?class="date-value"[^>]*>([^<]+)<', re.I | re.S)
_AWARDED_RE = re.compile(r'class="sol-award-date[^"]*".*?class="date-value"[^>]*>([^<]+)<', re.I | re.S)
_DATE_VALUE_RE = re.compile(r'class="date-value"[^>]*>([^<]+)</span>', re.I)
_BID_ID_RE = re.compile(r"/(\d{7,})(?:/|\?|$)")
# The last page keeps the `mets-page-navigation-next` wrapper but empties it.
_NEXT_BLOCK_RE = re.compile(r"mets-page-navigation-next[^>]*>(.*?)</div>", re.I | re.S)
_HREF_RE = re.compile(r'href="([^"]+)"', re.I)
_PAGE_NUMBER_RE = re.compile(r'data-page-number="(\d+)"', re.I)
_PAGE_PARAM_RE = re.compile(r"(?:[?&]pageNumber=|/page)(\d+)", re.I)

# bidnetdirect.com fronts every state/county tenant page with AWS WAF Bot Control. Rapid
# back-to-back sweeps (dozens of tenant pages within seconds — verified 2026-08-21 after
# three same-day full sweeps) trigger a JavaScript challenge: HTTP 202 with
# `x-amzn-waf-action: challenge`, which then blocks automated access for a while. We never
# bypass the challenge; instead every live BidNet request in this process is spaced out to
# keep the access pattern polite, and a challenge is surfaced as its own error class so
# source health can classify it as "throttled, retry later" rather than a parser failure.
BIDNET_MIN_REQUEST_INTERVAL_SECONDS = 3.0
_last_live_request_at = 0.0


class CoBidnetError(Exception):
    pass


class BidNetChallengeError(CoBidnetError):
    pass


def bidnet_politeness_delay_seconds(
    now,
    last_request_at,
    min_interval=BIDNET_MIN_REQUEST_INTERVAL_SECONDS,
):
    """Seconds to wait before the next live BidNet request (0 when enough time passed)."""
    if last_request_at <= 0:
        return 0.0
    return max(0.0, min_interval - (now - last_request_at))


def _fetch_bidnet_page(url, session, timeout):
    global _last_live_request_at
    delay = bidnet_politeness_delay_seconds(time.monotonic(), _last_live_request_at)
    if delay > 0:
        time.sleep(delay)
    try:
        return fetch_page(url, session=session, timeout=timeout)
    except HtmlPageError as error:
        if getattr(error, "status_code", None) == 202:
            raise BidNetChallengeError(
                "BidNet is serving an AWS WAF bot challenge (HTTP 202): the platform is "
                "temporarily rate-limiting automated access. Re-run this source later at a "
                "lower frequency — challenges are never bypassed."
            ) from error
        raise
    finally:
        _last_live_request_at = time.monotonic()


def _fetch_bidnet_html(url, session, timeout):
    return _fetch_bidnet_page(url, session, timeout).html


def fetch_bidnet_list_html(source, url, session=None, timeout=30):
    """List-HTML fetcher for the scrapling list path: `(html, final_url, status_code)`.

    Same request as the adapter makes — same politeness window, same WAF classification — so
    routing a source through the sidecar never changes how we touch the portal.
    """
    page = _fetch_bidnet_page(url, session, timeout)
    return page.html, page.final_url, 200


def _strip_tags(value):
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", value or "")).split())


def _match_text(pattern, text):
    match = pattern.search(text)
    return (_strip_tags(match.group(1)) or None) if match else None


def _lifecycle_for(list_kind, awarded_date):
    if list_kind == "open":
        return "open"
    # A closed-list row that was later awarded shows both dates (Denver 50018, 2026-09-24).
    return "awarded" if awarded_date or list_kind == "awarded" else "closed"


def _record_from_row(row_html, issuer_name, list_kind):
    link_match = _LINK_RE.search(row_html)
    if not link_match:
        return None
    href = link_match.group(1).replace("&amp;", "&")
    title = _strip_tags(link_match.group(2))
    dates = [value.strip() for value in _DATE_VALUE_RE.findall(row_html)]
    published = _match_text(_PUBLISHED_RE, row_html) or (dates[0] if dates else None)
    closing = _match_text(_CLOSING_RE, row_html)
    awarded = _match_text(_AWARDED_RE, row_html)
    if closing is None and awarded is None and len(dates) > 1:
        # Markup without the dated-span classes (trimmed pages, older fixtures): the second date is
        # the closing date on the open and closed lists and the award date on the awarded list.
        if list_kind == "awarded":
            awarded = dates[1]
        else:
            closing = dates[1]
    bid_id = _BID_ID_RE.search(href)
    return {
        "source_bid_id": bid_id.group(1) if bid_id else href,
        "title": title,
        "description": title,
        "published_date": published,
        "deadline_date": closing,
        "awarded_date": awarded,
        "solicitation_number": _match_text(_SOL_NUM_RE, row_html),
        "region": _match_text(_REGION_RE, row_html),
        "lifecycle_status": _lifecycle_for(list_kind, awarded),
        "list_kind": list_kind,
        "detail_access": {
            "restricted": list(BIDNET_DETAIL_ACCESS["restricted"]),
            "platform": BIDNET_DETAIL_ACCESS["platform"],
        },
        "issuer_name": issuer_name,
        "source_url": absolute_url(BIDNET_ORIGIN, href),
        "attachments": [],
    }


def _records_from_html(html, issuer_name, list_kind="open"):
    records = []
    for match in _ROW_RE.finditer(html or ""):
        record = _record_from_row(match.group(1), issuer_name, list_kind)
        if record is not None:
            records.append(record)
    return records


def bidnet_next_page(html):
    """`(absolute next-page URL, page number)` from the pagination block, `(None, None)` on the last page."""
    block = _NEXT_BLOCK_RE.search(html or "")
    if not block:
        return None, None
    href = _HREF_RE.search(block.group(1))
    if not href:
        return None, None
    url = absolute_url(BIDNET_ORIGIN, unescape(href.group(1)))
    number = _PAGE_NUMBER_RE.search(block.group(1)) or _PAGE_PARAM_RE.search(url)
    return url, int(number.group(1)) if number else None


def read_bidnet_list_page(source, html, list_kind="open"):
    """One fetched BidNet list page: its raw records and where the next page is."""
    next_url, next_page = bidnet_next_page(html)
    return BidnetListPage(_records_from_html(html, source.source_label, list_kind), next_url, next_page)


def bidnet_list_url(base_url, list_kind="open", page=1):
    """The tenant list URL for a list kind and page, derived from the tenant's stored open-bids URL.

    Page 1 of the open list is the stored URL itself, byte for byte, so existing sources fetch
    exactly what they always fetched. Other pages use BidNet's own `pageNumber` link format
    (verified on Denver's closed and awarded lists, 2026-09-24).
    """
    if list_kind not in _LIST_KIND_PATHS:
        raise ValueError("list_kind must be one of: {0}".format(", ".join(BIDNET_LIST_KINDS)))
    page = int(page)
    if page < 1:
        raise ValueError("page must be 1 or greater")
    if list_kind == "open" and page == 1:
        return base_url
    root = re.split(r"/solicitations(?:/|\?|$)", base_url, maxsplit=1)[0].rstrip("/")
    params = (["pageNumber={0}".format(page)] if page > 1 else []) + ["selectedContent=BUYER"]
    return "{0}/solicitations/{1}?{2}".format(root, _LIST_KIND_PATHS[list_kind], "&".join(params))


def parse_bidnet_list_html(source, html, query=None, limit=25, issuer_name=None, list_kind="open"):
    """Parse an already-fetched BidNet list page (also the scrapling path's fallback parser)."""
    records = _records_from_html(html, issuer_name or source.source_label, list_kind)
    if not records:
        empty = detect_empty_list(html, source.source_label)
        if empty["detected"]:
            # Legitimate "nothing listed right now" — the CLI decides whether the tenant proof is
            # strong enough to call this a zero-row success.
            raise VerifiedEmptyListError(empty["marker"], empty["tenant_confirmed"], method="adapter")
        raise CoBidnetError(f"{source.id} BidNet page did not contain open solicitations")

    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    if limit is not None:
        records = records[: int(limit)]
    return [normalize_state_opportunity(record, source) for record in records]


def fetch_bidnet_opportunities(
    source,
    url,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_html=None,
    issuer_name=None,
):
    if fixture_html:
        html = read_html_fixture(fixture_html)
    else:
        html = _fetch_bidnet_html(url, session=session, timeout=timeout)

    return parse_bidnet_list_html(source, html, query=query, limit=limit, issuer_name=issuer_name)


def fetch_co_bidnet_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_html=None,
):
    return fetch_bidnet_opportunities(
        source,
        url=CO_BIDNET_URL,
        query=query,
        limit=limit,
        session=session,
        timeout=timeout,
        fixture_html=fixture_html,
        issuer_name="BidNet Colorado",
    )
