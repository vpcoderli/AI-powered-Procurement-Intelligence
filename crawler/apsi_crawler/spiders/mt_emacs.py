import re

from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    extract_table_rows,
    fetch_html,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


MT_EMACS_URL = "https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=StateOfMontana"
MT_EMACS_HEADERS = ("Status", "Details")


class MtEmacsError(Exception):
    pass


def _clean_detail_text(row):
    text = row.get("Details", "")
    title = row.get("_link_text", "") or ""
    if title and text.startswith(title):
        return text[len(title):].strip()
    return text.strip()


def _source_id_from_link(link, title):
    if title:
        return re.sub(r"[^A-Za-z0-9]+", "", title)[:80]
    return link or "montana-event"


def _record_from_row(row):
    links = row.get("_links", {})
    detail_link = links.get("Details")
    title = row.get("_link_text") or row.get("Details")
    source_bid_id = _source_id_from_link(detail_link, title)
    return {
        "source_bid_id": source_bid_id,
        "title": title,
        "description": _clean_detail_text(row) or title,
        "original_category": row.get("Status"),
        "issuer_name": "Montana eMACS",
        "source_url": absolute_url(MT_EMACS_URL, detail_link or MT_EMACS_URL),
        "attachments": [],
    }


def _rows_with_link_text(html):
    rows = extract_table_rows(html, required_headers=MT_EMACS_HEADERS)
    title_by_href = {}
    for match in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, flags=re.I | re.S):
        href = match.group(1).replace("&amp;", "&")
        text = re.sub(r"<[^>]+>", "", match.group(2))
        title_by_href[href] = " ".join(text.split())
    for row in rows:
        link = row.get("_links", {}).get("Details")
        if link:
            row["_link_text"] = title_by_href.get(link.replace("&amp;", "&"))
    return rows


def fetch_mt_emacs_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_html=None,
):
    limit_count = int(limit)
    if fixture_html:
        html = read_html_fixture(fixture_html)
    else:
        try:
            html = fetch_html(MT_EMACS_URL, session=session, timeout=timeout)
        except HtmlPageError as error:
            raise MtEmacsError(str(error)) from error

    try:
        records = [_record_from_row(row) for row in _rows_with_link_text(html) if row.get("Details")]
    except HtmlPageError as error:
        raise MtEmacsError(str(error)) from error

    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]
