import re

from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    fetch_html,
    normalize_space,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


AR_PROCUREMENT_URL = "https://www.arkansas.gov/tss/procurement/bids/"
AR_PROCUREMENT_HEADERS = (
    "Description",
    "Agency",
    "Opening Date/Time",
    "Bid Number",
    "Buyer Email",
)


class ArProcurementError(Exception):
    pass


def _record_from_row(row):
    source_bid_id = row.get("Bid Number")
    if not source_bid_id:
        raise ArProcurementError("Arkansas solicitation row is missing bid number")
    links = row.get("_links", {})
    contact_email = (links.get("Buyer Email") or "").replace("mailto:", "") or None
    return {
        "source_bid_id": source_bid_id,
        "title": row.get("Description"),
        "description": row.get("Description"),
        "issuer_name": row.get("Agency"),
        "deadline_date": row.get("Opening Date/Time"),
        "contact_email": contact_email,
        "source_url": absolute_url(AR_PROCUREMENT_URL, links.get("Bid Number") or ""),
        "attachments": [],
    }


def _strip_tags(value):
    return normalize_space(re.sub(r"<[^>]+>", " ", value or ""))


def _extract_rows(html):
    rows = []
    for table_match in re.finditer(r"<table[^>]*>(.*?)</table>", html, flags=re.I | re.S):
        table_html = table_match.group(1)
        header_text = _strip_tags(table_html)
        if "Description" not in header_text or "Bid Number" not in header_text:
            continue
        for row_match in re.finditer(r"<tr[^>]*>(.*?)</tr>", table_html, flags=re.I | re.S):
            row_html = row_match.group(1)
            if "<th" in row_html.lower():
                continue
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row_html, flags=re.I | re.S)
            if len(cells) < 5:
                continue
            offset = 1 if len(cells) >= 6 else 0
            bid_cell = cells[offset + 3]
            bid_link = re.search(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', bid_cell, flags=re.I | re.S)
            email_link = re.search(r'href="mailto:([^"]+)"', cells[offset + 4], flags=re.I)
            if not bid_link:
                continue
            rows.append(
                {
                    "Description": _strip_tags(cells[offset]),
                    "Agency": _strip_tags(cells[offset + 1]),
                    "Opening Date/Time": _strip_tags(cells[offset + 2]),
                    "Bid Number": _strip_tags(bid_link.group(2)),
                    "_links": {
                        "Bid Number": bid_link.group(1).replace("&amp;", "&"),
                        "Buyer Email": f"mailto:{email_link.group(1)}" if email_link else "",
                    },
                }
            )
    return rows


def fetch_ar_procurement_opportunities(
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
            html = fetch_html(AR_PROCUREMENT_URL, session=session, timeout=timeout)
        except HtmlPageError as error:
            raise ArProcurementError(str(error)) from error

    rows = _extract_rows(html)
    if not rows:
        raise ArProcurementError("Arkansas procurement page did not contain current solicitations")

    records = [_record_from_row(row) for row in rows if row.get("Bid Number")]
    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]
