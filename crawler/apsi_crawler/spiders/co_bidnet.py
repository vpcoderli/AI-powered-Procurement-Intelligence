import re

from apsi_crawler.html.public_page import absolute_url, fetch_html, read_html_fixture
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


CO_BIDNET_URL = "https://www.bidnetdirect.com/colorado/solicitations/open-bids?selectedContent=BUYER"


class CoBidnetError(Exception):
    pass


def _strip_tags(value):
    return " ".join(re.sub(r"<[^>]+>", " ", value or "").split())


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
    limit_count = int(limit)
    if fixture_html:
        html = read_html_fixture(fixture_html)
    else:
        html = fetch_html(url, session=session, timeout=timeout)

    records = _records_from_html(html, issuer_name or source.source_label)
    if not records:
        raise CoBidnetError(f"{source.id} BidNet page did not contain open solicitations")

    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]


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
