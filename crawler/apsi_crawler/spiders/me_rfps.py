from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    extract_table_rows,
    fetch_html,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


ME_RFPS_URL = "https://www.maine.gov/dafs/bbm/procurementservices/vendors/rfps"
ME_RFP_HEADERS = (
    "Title",
    "RFP #",
    "Issuing Dept.",
    "Date Posted",
    "Q/A Summary and Amendment",
    "Proposal Due Date",
    "RFP Status",
)


class MeRfpError(Exception):
    pass


def _record_from_row(row, source):
    source_bid_id = row.get("RFP #")
    if not source_bid_id:
        raise MeRfpError("Maine RFP row is missing RFP number")

    links = row.get("_links", {})
    attachments = []
    amendment_link = links.get("Q/A Summary and Amendment")
    if amendment_link:
        attachments.append(
            {
                "name": row.get("Q/A Summary and Amendment") or "Q/A Summary and Amendment",
                "url": absolute_url(source.base_url, amendment_link),
                "size_label": None,
                "mime_type": None,
                "sort_order": 0,
            }
        )

    return {
        "source_bid_id": source_bid_id,
        "title": row.get("Title"),
        "description": row.get("Title"),
        "issuer_name": row.get("Issuing Dept."),
        "published_date": row.get("Date Posted"),
        "deadline_date": row.get("Proposal Due Date"),
        "original_category": row.get("RFP Status"),
        "source_url": absolute_url(source.base_url, links.get("Title") or links.get("RFP #") or ME_RFPS_URL),
        "attachments": attachments,
    }


def fetch_me_rfp_opportunities(
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
            html = fetch_html(ME_RFPS_URL, session=session, timeout=timeout)
        except HtmlPageError as error:
            raise MeRfpError(str(error)) from error

    try:
        rows = extract_table_rows(html, required_headers=ME_RFP_HEADERS)
    except HtmlPageError as error:
        raise MeRfpError(str(error)) from error
    records = [_record_from_row(row, source) for row in rows if row.get("RFP #")]

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
