import json

from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    extract_table_rows,
    fetch_html,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


SC_BUSINESS_OPPORTUNITIES_HEADERS = (
    "Ad Publish Date",
    "Solicitation #",
    "Description",
    "Agency",
    "Bid Opening Date",
    "Bid Opening Time",
    "Documents",
)


class ScBusinessOpportunitiesError(Exception):
    pass


def _first_present(record, keys, default=None):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return default


def _deadline(date_value, time_value):
    if date_value and time_value:
        return f"{date_value} {time_value}"
    return date_value or time_value


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
    source_bid_id = row.get("Solicitation #")
    if not source_bid_id:
        raise ScBusinessOpportunitiesError(
            "South Carolina business opportunity row is missing solicitation number"
        )

    links = row.get("_links", {})
    attachments = []
    document_link = links.get("Documents")
    if document_link:
        attachments.append(_attachment(row.get("Documents"), document_link, source, 0))

    return {
        "source_bid_id": source_bid_id,
        "title": row.get("Description"),
        "description": row.get("Description"),
        "issuer_name": row.get("Agency"),
        "deadline_date": _deadline(
            row.get("Bid Opening Date"),
            row.get("Bid Opening Time"),
        ),
        "published_date": row.get("Ad Publish Date"),
        "source_url": absolute_url(
            source.base_url,
            links.get("Solicitation #") or links.get("Description") or "",
        ),
        "attachments": [attachment for attachment in attachments if attachment],
    }


def _record_from_json(record, source):
    source_bid_id = _first_present(
        record,
        ("source_bid_id", "solicitation_number", "solicitationNumber", "id"),
    )
    if not source_bid_id:
        raise ScBusinessOpportunitiesError(
            "South Carolina business opportunity record is missing source id"
        )

    return {
        "source_bid_id": source_bid_id,
        "title": _first_present(record, ("title", "description", "name")),
        "description": _first_present(record, ("description", "summary", "title")),
        "issuer_name": _first_present(record, ("issuer_name", "agency", "department")),
        "deadline_date": _deadline(
            _first_present(record, ("deadline_date", "bid_opening_date", "bidOpeningDate")),
            _first_present(record, ("bid_opening_time", "bidOpeningTime")),
        ),
        "published_date": _first_present(
            record,
            ("published_date", "ad_publish_date", "adPublishDate", "posted_date"),
        ),
        "source_url": absolute_url(
            source.base_url,
            _first_present(record, ("source_url", "detail_url", "detailUrl", "url"), ""),
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
        raise ScBusinessOpportunitiesError(
            "South Carolina fixture JSON did not contain opportunities"
        )
    return [_record_from_json(record, source) for record in records]


def _records_from_html(html, source):
    try:
        rows = extract_table_rows(
            html,
            required_headers=SC_BUSINESS_OPPORTUNITIES_HEADERS,
        )
    except HtmlPageError as error:
        raise ScBusinessOpportunitiesError(
            "South Carolina page missing expected business opportunity table headers"
        ) from error
    return [_record_from_row(row, source) for row in rows]


def fetch_sc_business_opportunities(
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
                html = fetch_html(source.base_url, session=session, timeout=timeout)
            except HtmlPageError as error:
                raise ScBusinessOpportunitiesError(str(error)) from error
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
