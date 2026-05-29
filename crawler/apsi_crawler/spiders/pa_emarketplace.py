import json

from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    extract_table_rows,
    fetch_html,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


PA_EMARKETPLACE_SEARCH_URL = "https://www.emarketplace.state.pa.us/Search.aspx/Home.aspx"

PA_EMARKETPLACE_HEADERS = (
    "Solicitation Number",
    "Title",
    "Agency",
    "Bid Opening Date",
    "Posted Date",
    "Type",
    "Documents",
)

PA_EMARKETPLACE_CURRENT_HEADERS = (
    "Solicitation #",
    "Types",
    "Solicitation Title",
    "Description",
    "Agency",
    "Solicitation Start Date",
    "Solicitation Due Date",
    "Bid Opening Date",
)


class PaEmarketplaceError(Exception):
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
    source_bid_id = _first_present(row, ("Solicitation Number", "Solicitation #"))
    if not source_bid_id:
        raise PaEmarketplaceError(
            "Pennsylvania eMarketplace row is missing solicitation number"
        )

    links = row.get("_links", {})
    attachments = []
    document_link = links.get("Documents")
    if document_link:
        attachments.append(_attachment(row.get("Documents"), document_link, source, 0))

    return {
        "source_bid_id": source_bid_id,
        "title": _first_present(row, ("Title", "Solicitation Title", "Description")),
        "description": _first_present(
            row,
            ("Description", "Title", "Solicitation Title"),
        ),
        "issuer_name": row.get("Agency"),
        "deadline_date": _first_present(
            row,
            ("Bid Opening Date", "Solicitation Due Date"),
        ),
        "published_date": _first_present(row, ("Posted Date", "Solicitation Start Date")),
        "original_category": _first_present(row, ("Type", "Types")),
        "source_url": absolute_url(
            source.base_url,
            links.get("Solicitation Number")
            or links.get("Solicitation #")
            or links.get("Title")
            or links.get("Solicitation Title")
            or "",
        )
        or source.base_url,
        "attachments": [attachment for attachment in attachments if attachment],
    }


def _record_from_json(record, source):
    source_bid_id = _first_present(
        record,
        ("source_bid_id", "solicitationNumber", "solicitation_number", "id"),
    )
    if not source_bid_id:
        raise PaEmarketplaceError("Pennsylvania eMarketplace record is missing source id")

    return {
        "source_bid_id": source_bid_id,
        "title": _first_present(record, ("title", "name")),
        "description": _first_present(record, ("description", "summary", "title")),
        "issuer_name": _first_present(record, ("issuer_name", "agency", "department")),
        "deadline_date": _first_present(
            record,
            ("deadline_date", "bidOpeningDate", "bid_opening_date", "due_date"),
        ),
        "published_date": _first_present(
            record,
            ("published_date", "postedDate", "posted_date"),
        ),
        "original_category": _first_present(record, ("original_category", "type", "category")),
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
        raise PaEmarketplaceError(
            "Pennsylvania eMarketplace fixture JSON did not contain opportunities"
        )
    return [_record_from_json(record, source) for record in records]


def _records_from_html(html, source):
    for headers in (PA_EMARKETPLACE_HEADERS, PA_EMARKETPLACE_CURRENT_HEADERS):
        try:
            rows = extract_table_rows(html, required_headers=headers)
        except HtmlPageError:
            continue
        records = []
        for row in rows:
            try:
                records.append(_record_from_row(row, source))
            except PaEmarketplaceError:
                continue
        if records:
            return records
    raise PaEmarketplaceError(
        "Pennsylvania eMarketplace page missing expected solicitation table headers"
    )


def fetch_pa_emarketplace_opportunities(
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
                html = fetch_html(
                    PA_EMARKETPLACE_SEARCH_URL,
                    session=session,
                    timeout=timeout,
                )
            except HtmlPageError as error:
                raise PaEmarketplaceError(str(error)) from error
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
