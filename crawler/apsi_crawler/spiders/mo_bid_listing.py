import re

from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    extract_table_rows,
    fetch_html,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


MO_BID_LISTING_URL = "https://oa.mo.gov/facilities/bid-opportunities/bid-listing-electronic-plans"
MO_BID_HEADERS = (
    "Project Number",
    "Project Title",
    "Bid Date/ IFB/ RFQ/Electronic Plans",
)


class MoBidListingError(Exception):
    pass


def _first_date(text):
    match = re.search(r"\d{1,2}/\d{1,2}/\d{4}", text or "")
    return match.group(0) if match else text


def _without_first_date(text):
    return re.sub(r"^\s*\d{1,2}/\d{1,2}/\d{4}\s*", "", text or "").strip()


def _record_from_row(row, source):
    source_bid_id = row.get("Project Number")
    if not source_bid_id:
        raise MoBidListingError("Missouri bid row is missing project number")

    document_text = row.get("Bid Date/ IFB/ RFQ/Electronic Plans", "")
    links = row.get("_links", {})
    document_link = links.get("Bid Date/ IFB/ RFQ/Electronic Plans")
    attachments = []
    if document_link:
        attachments.append(
            {
                "name": _without_first_date(document_text) or "Bid documents",
                "url": absolute_url(MO_BID_LISTING_URL, document_link),
                "size_label": None,
                "mime_type": None,
                "sort_order": 0,
            }
        )

    return {
        "source_bid_id": source_bid_id,
        "title": row.get("Project Title"),
        "description": row.get("Project Title"),
        "deadline_date": _first_date(document_text),
        "issuer_name": "Missouri Office of Administration",
        "source_url": absolute_url(
            MO_BID_LISTING_URL,
            links.get("Project Number") or links.get("Project Title") or MO_BID_LISTING_URL,
        ),
        "attachments": attachments,
    }


def fetch_mo_bid_listing_opportunities(
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
            html = fetch_html(MO_BID_LISTING_URL, session=session, timeout=timeout)
        except HtmlPageError as error:
            raise MoBidListingError(str(error)) from error

    try:
        rows = extract_table_rows(html, required_headers=MO_BID_HEADERS)
    except HtmlPageError as error:
        raise MoBidListingError(str(error)) from error
    records = [_record_from_row(row, source) for row in rows if row.get("Project Number")]

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
