import json

from apsi_crawler.content_quality import detect_empty_list
from apsi_crawler.errors import VerifiedEmptyListError
from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    extract_table_rows,
    fetch_page,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


GENERIC_HEADER_SETS = (
    ("Bid Number", "Title", "Agency", "Due Date", "Posted Date"),
    ("Solicitation Number", "Title", "Agency", "Due Date", "Posted Date"),
    ("Opportunity ID", "Title", "Agency", "Close Date", "Posted Date"),
    ("Number", "Description", "Department", "Due Date"),
)


def _first_present(row, keys, default=""):
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return value
    return default


def _records_from_json(path):
    with open(path, encoding="utf-8") as fixture:
        payload = json.load(fixture)
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("opportunities", "results", "bids"):
            records = payload.get(key)
            if isinstance(records, list):
                return records
    return []


def _rows_from_html(html):
    for headers in GENERIC_HEADER_SETS:
        try:
            return extract_table_rows(html, required_headers=headers)
        except HtmlPageError:
            continue
    return []


def _record_from_row(row, source):
    source_bid_id = _first_present(
        row,
        ("Bid Number", "Solicitation Number", "Opportunity ID", "Number"),
    )
    title = _first_present(row, ("Title", "Description", "Name"))
    agency = _first_present(row, ("Agency", "Department", "Organization"))
    deadline = _first_present(row, ("Due Date", "Close Date", "Closing Date"))
    posted = _first_present(row, ("Posted Date", "Publish Date"))
    links = row.get("_links", {})
    href = ""
    for key in ("Bid Number", "Solicitation Number", "Opportunity ID", "Number", "Title"):
        if links.get(key):
            href = links[key]
            break

    return {
        "source_bid_id": source_bid_id,
        "title": title,
        "description": title,
        "issuer_name": agency,
        "deadline_date": deadline,
        "published_date": posted,
        "source_url": absolute_url(source.base_url, href) if href else source.base_url,
    }


def fetch_generic_state_list_html(source, url, session=None, timeout=30):
    """List-HTML fetcher for the scrapling list path: `(html, final_url, status_code)`."""
    page = fetch_page(url or source.base_url, session=session, timeout=timeout)
    return page.html, page.final_url, 200


def _filter_and_normalize(records, source, query, limit_count):
    records = [record for record in records if record.get("source_bid_id")]
    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    return [
        normalize_state_opportunity(record, source)
        for record in records[:limit_count]
    ]


def parse_generic_state_list_html(source, html, query=None, limit=25):
    """Parse an already-fetched generic list page (also the scrapling path's fallback parser)."""
    records = [_record_from_row(row, source) for row in _rows_from_html(html)]
    bids = _filter_and_normalize(records, source, query, int(limit))
    if not bids and not records:
        empty = detect_empty_list(html, source.source_label)
        if empty["detected"]:
            raise VerifiedEmptyListError(empty["marker"], empty["tenant_confirmed"], method="adapter")
    return bids


def fetch_generic_state_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_html=None,
    fixture_json=None,
):
    if fixture_json:
        return _filter_and_normalize(_records_from_json(fixture_json), source, query, int(limit))

    if fixture_html:
        html = read_html_fixture(fixture_html)
    else:
        html = fetch_generic_state_list_html(source, source.base_url, session=session, timeout=timeout)[0]

    return parse_generic_state_list_html(source, html, query=query, limit=limit)
