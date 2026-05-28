import json

from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    extract_table_rows,
    fetch_html,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


OR_OREGONBUYS_HEADERS = (
    "Opportunity No.",
    "Opportunity Title",
    "Organization",
    "Published Date",
    "Closing Date",
    "Commodity",
    "Attachments",
)


class OrOregonBuysError(Exception):
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
    source_bid_id = row.get("Opportunity No.")
    if not source_bid_id:
        raise OrOregonBuysError("OregonBuys row is missing opportunity number")

    links = row.get("_links", {})
    attachments = []
    attachment_link = links.get("Attachments")
    if attachment_link:
        attachments.append(_attachment(row.get("Attachments"), attachment_link, source, 0))

    return {
        "source_bid_id": source_bid_id,
        "title": row.get("Opportunity Title"),
        "description": row.get("Opportunity Title"),
        "issuer_name": row.get("Organization"),
        "published_date": row.get("Published Date"),
        "deadline_date": row.get("Closing Date"),
        "original_category": row.get("Commodity"),
        "source_url": absolute_url(
            source.base_url,
            links.get("Opportunity No.") or links.get("Opportunity Title") or "",
        ),
        "attachments": [attachment for attachment in attachments if attachment],
    }


def _record_from_json(record, source):
    source_bid_id = _first_present(
        record,
        ("source_bid_id", "opportunity_number", "opportunityNumber", "id"),
    )
    if not source_bid_id:
        raise OrOregonBuysError("OregonBuys record is missing source id")

    return {
        "source_bid_id": source_bid_id,
        "title": _first_present(record, ("title", "opportunity_title", "opportunityTitle")),
        "description": _first_present(
            record,
            ("description", "summary", "opportunity_title", "opportunityTitle"),
        ),
        "issuer_name": _first_present(record, ("issuer_name", "organization", "agency")),
        "published_date": _first_present(
            record,
            ("published_date", "publishedDate", "posted_date"),
        ),
        "deadline_date": _first_present(
            record,
            ("deadline_date", "closing_date", "closingDate", "due_date"),
        ),
        "original_category": _first_present(
            record,
            ("original_category", "commodity", "category"),
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
        raise OrOregonBuysError("OregonBuys fixture JSON did not contain opportunities")
    return [_record_from_json(record, source) for record in records]


def _records_from_html(html, source):
    try:
        rows = extract_table_rows(html, required_headers=OR_OREGONBUYS_HEADERS)
    except HtmlPageError as error:
        raise OrOregonBuysError(
            "OregonBuys page missing expected opportunity table headers"
        ) from error
    return [_record_from_row(row, source) for row in rows]


def fetch_or_oregonbuys_opportunities(
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
                raise OrOregonBuysError(str(error)) from error
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
