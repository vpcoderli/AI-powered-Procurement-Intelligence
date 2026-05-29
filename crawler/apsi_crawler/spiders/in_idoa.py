import hashlib

from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    extract_html_tables,
    fetch_html,
    normalize_space,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


IN_IDOA_URL = "https://www.in.gov/idoa/procurement/current-business-opportunities/"
IN_IDOA_HEADERS = (
    "Event Name",
    "Agency",
    "Event ID",
    "Event Description",
    "Response Due By",
    "Contact",
)


class InIdoaError(Exception):
    pass


def _title_from_event_name(row):
    text = row.get("Event Name", "")
    return text.replace("Bid Documents", "").strip()


def _record_from_row(row):
    source_bid_id = row.get("Event ID")
    if not source_bid_id or source_bid_id == "NA":
        title_key = _title_from_event_name(row) or row.get("Event Description")
        if title_key:
            source_bid_id = hashlib.sha1(
                f"{title_key}|{row.get('Response Due By', '')}".encode("utf-8")
            ).hexdigest()[:12]
    if not source_bid_id:
        raise InIdoaError("Indiana opportunity row is missing event id")
    links = row.get("_links", {})
    doc_link = links.get("Event Name")
    attachments = []
    if doc_link and "files/" in doc_link:
        attachments.append(
            {
                "name": "Bid Documents",
                "url": absolute_url("https://www.in.gov", doc_link),
                "size_label": None,
                "mime_type": None,
                "sort_order": 0,
            }
        )
    return {
        "source_bid_id": source_bid_id,
        "title": _title_from_event_name(row),
        "description": row.get("Event Description"),
        "issuer_name": row.get("Agency"),
        "deadline_date": row.get("Response Due By"),
        "contact_name": row.get("Contact"),
        "source_url": absolute_url(IN_IDOA_URL, links.get("Event Description") or ""),
        "attachments": attachments,
    }


def _rows_with_all_links(html):
    tables = extract_html_tables(html)
    for table in tables:
        if not table:
            continue
        header_index = None
        headers = []
        for index, row in enumerate(table):
            row_headers = [cell["text"] for cell in row]
            if all(header in row_headers for header in IN_IDOA_HEADERS):
                header_index = index
                headers = row_headers
                break
        if header_index is None:
            continue

        rows = []
        for row in table[header_index + 1:]:
            values = {}
            links = {}
            for index, header in enumerate(headers):
                cell = row[index] if index < len(row) else {"text": "", "links": []}
                values[header] = normalize_space(cell["text"])
                if cell["links"]:
                    links[header] = cell["links"][0]
                    links[f"{header}__all"] = list(cell["links"])
            values["_links"] = links
            rows.append(values)
        return rows
    raise HtmlPageError("HTML table was missing required headers: " + ", ".join(IN_IDOA_HEADERS))


def _record_from_row_with_all_links(row):
    record = _record_from_row(row)
    all_event_links = row.get("_links", {}).get("Event Name__all") or []
    for link in all_event_links:
        if "files/" in link:
            record["attachments"] = [
                {
                    "name": "Bid Documents",
                    "url": absolute_url("https://www.in.gov", link),
                    "size_label": None,
                    "mime_type": None,
                    "sort_order": 0,
                }
            ]
            break
    return record


def fetch_in_idoa_opportunities(
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
            html = fetch_html(IN_IDOA_URL, session=session, timeout=timeout)
        except HtmlPageError as error:
            raise InIdoaError(str(error)) from error

    try:
        rows = _rows_with_all_links(html)
    except HtmlPageError as error:
        raise InIdoaError(str(error)) from error
    records = [
        _record_from_row_with_all_links(row)
        for row in rows
        if _title_from_event_name(row)
    ]

    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]
