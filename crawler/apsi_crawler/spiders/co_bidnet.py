import re
import time
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


def _records_from_html(html, issuer_name):
    records = []
    for match in re.finditer(
        r'<tr[^>]+class="[^"]*mets-table-row[^"]*"[^>]*>(.*?)</tr>',
        html,
        flags=re.I | re.S,
    ):
        row_html = match.group(1)
        link_match = re.search(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', row_html, flags=re.I | re.S)
        if not link_match:
            continue
        href = link_match.group(1).replace("&amp;", "&")
        title = _strip_tags(link_match.group(2))
        date_values = re.findall(r'class="date-value"[^>]*>([^<]+)</span>', row_html, flags=re.I)
        source_id_match = re.search(r"/(\d{7,})(?:/|\?|$)", href)
        records.append(
            {
                "source_bid_id": source_id_match.group(1) if source_id_match else href,
                "title": title,
                "description": title,
                "published_date": date_values[0] if date_values else None,
                "deadline_date": date_values[1] if len(date_values) > 1 else None,
                "issuer_name": issuer_name,
                "source_url": absolute_url("https://www.bidnetdirect.com", href),
                "attachments": [],
            }
        )
    return records


def parse_bidnet_list_html(source, html, query=None, limit=25, issuer_name=None):
    """Parse an already-fetched BidNet list page (also the scrapling path's fallback parser)."""
    limit_count = int(limit)
    records = _records_from_html(html, issuer_name or source.source_label)
    if not records:
        empty = detect_empty_list(html, source.source_label)
        if empty["detected"]:
            # Legitimate "nothing open right now" — the CLI decides whether the tenant proof is
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

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]


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
