import json
import re

from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    extract_html_tables,
    extract_table_rows,
    fetch_html,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


WA_DES_BID_CALENDAR_URL = "https://pr-webs-vendor.des.wa.gov/BidCalendar.aspx"

WA_DES_HEADERS = (
    "Solicitation Number",
    "Title",
    "Agency",
    "Posted Date",
    "Closing Date",
    "Commodity",
    "Documents",
)


class WaDesError(Exception):
    pass


def _first_present(record, keys, default=None):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return default


def _attachment(name, url, source, sort_order):
    if not url:
        return None
    return {
        "name": name or f"Attachment {sort_order + 1}",
        "url": absolute_url(source.base_url, url),
        "size_label": None,
        "mime_type": None,
        "sort_order": sort_order,
    }


def _attachments_from_items(items, source):
    attachments = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        attachment = _attachment(
            _first_present(item, ("name", "title", "label")),
            _first_present(item, ("url", "href", "link")),
            source,
            len(attachments),
        )
        if attachment:
            attachments.append(attachment)
    return attachments


def _record_from_row(row, source):
    source_bid_id = row.get("Solicitation Number")
    if not source_bid_id:
        raise WaDesError("Washington DES row is missing solicitation number")

    links = row.get("_links", {})
    attachments = []
    document_link = links.get("Documents")
    if document_link:
        attachments.append(_attachment(row.get("Documents"), document_link, source, 0))

    return {
        "source_bid_id": source_bid_id,
        "title": row.get("Title"),
        "description": row.get("Title"),
        "issuer_name": row.get("Agency"),
        "published_date": row.get("Posted Date"),
        "deadline_date": row.get("Closing Date"),
        "original_category": row.get("Commodity"),
        "source_url": absolute_url(
            source.base_url,
            links.get("Solicitation Number") or links.get("Title") or "",
        ),
        "attachments": [attachment for attachment in attachments if attachment],
    }


def _cell_text(row, index):
    if index >= len(row):
        return ""
    return row[index]["text"]


def _cell_link(row, index):
    if index >= len(row):
        return ""
    links = row[index]["links"]
    return links[0] if links else ""


def _bid_calendar_record_from_table(table, source):
    if not table:
        return None

    first_row = table[0]
    if len(first_row) < 2:
        return None

    title_ref_text = _cell_text(first_row, 1)
    match = re.search(r"(?P<title>.*?)\s+Ref #:\s*(?P<ref>.+)$", title_ref_text)
    if not match:
        return None

    description = ""
    if len(table) > 1:
        description = " ".join(_cell_text(cell_row, 0) for cell_row in table[1:])

    return {
        "source_bid_id": match.group("ref").strip(),
        "title": match.group("title").strip(),
        "description": description.strip() or match.group("title").strip(),
        "issuer_name": "Washington Department of Enterprise Services",
        "published_date": None,
        "deadline_date": _cell_text(first_row, 0),
        "original_category": None,
        "source_url": absolute_url(source.base_url, _cell_link(first_row, 1)),
        "attachments": [],
    }


def _records_from_bid_calendar_html(html, source):
    records = []
    for table in extract_html_tables(html):
        record = _bid_calendar_record_from_table(table, source)
        if record:
            records.append(record)
    if not records:
        raise WaDesError("Washington DES BidCalendar page did not contain opportunities")
    return records


def _record_from_json(record, source):
    source_bid_id = _first_present(
        record,
        ("source_bid_id", "solicitationNumber", "solicitation_number", "id"),
    )
    if not source_bid_id:
        raise WaDesError("Washington DES record is missing source id")

    return {
        "source_bid_id": source_bid_id,
        "title": _first_present(record, ("title", "name")),
        "description": _first_present(record, ("description", "summary", "title")),
        "issuer_name": _first_present(record, ("issuer_name", "agency", "department")),
        "published_date": _first_present(
            record,
            ("published_date", "postedDate", "posted_date"),
        ),
        "deadline_date": _first_present(
            record,
            ("deadline_date", "closingDate", "closing_date", "due_date"),
        ),
        "original_category": _first_present(
            record,
            ("original_category", "commodity", "category"),
        ),
        "source_url": absolute_url(
            source.base_url,
            _first_present(record, ("source_url", "detailUrl", "detail_url", "url"), ""),
        ),
        "attachments": _attachments_from_items(
            _first_present(record, ("attachments", "documents"), []),
            source,
        ),
    }


def _records_from_payload(payload, source):
    if isinstance(payload, list):
        records = payload
    elif isinstance(payload, dict):
        records = []
        for key in ("opportunities", "results", "bids"):
            value = payload.get(key)
            if isinstance(value, list):
                records = value
                break
    else:
        records = []
    if not records:
        raise WaDesError("Washington DES fixture JSON did not contain opportunities")
    return [_record_from_json(record, source) for record in records]


def _records_from_html(html, source):
    try:
        rows = extract_table_rows(html, required_headers=WA_DES_HEADERS)
        return [_record_from_row(row, source) for row in rows]
    except (HtmlPageError, WaDesError):
        return _records_from_bid_calendar_html(html, source)


def fetch_wa_des_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_html=None,
    fixture_json=None,
):
    limit_count = int(limit)
    if fixture_json:
        with open(fixture_json, encoding="utf-8") as fixture:
            records = _records_from_payload(json.load(fixture), source)
    else:
        if fixture_html:
            html = read_html_fixture(fixture_html)
        else:
            try:
                html = fetch_html(WA_DES_BID_CALENDAR_URL, session=session, timeout=timeout)
            except HtmlPageError as error:
                raise WaDesError(str(error)) from error
        records = _records_from_html(html, source)

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
