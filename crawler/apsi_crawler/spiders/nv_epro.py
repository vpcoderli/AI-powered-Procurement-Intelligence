from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    extract_table_rows,
    fetch_html,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


NV_EPRO_SEARCH_URL = (
    "https://www.nevadaepro.com/bso/view/search/external/"
    "advancedSearchBid.xhtml?openBids=true"
)
NV_EPRO_HEADERS = (
    "Bid Solicitation #",
    "Organization Name",
    "Description",
    "Bid Opening Date",
    "Status",
)


class NvEproError(Exception):
    pass


def _record_from_row(row, source):
    source_bid_id = row.get("Bid Solicitation #")
    if not source_bid_id:
        raise NvEproError("Nevada ePro row is missing solicitation number")

    links = row.get("_links", {})
    detail_link = links.get("Bid Solicitation #") or links.get("Description")
    if not detail_link:
        detail_link = f"/bso/external/bidDetail.sda?docId={source_bid_id}"

    return {
        "source_bid_id": source_bid_id,
        "title": row.get("Description"),
        "description": row.get("Description"),
        "issuer_name": row.get("Organization Name"),
        "deadline_date": row.get("Bid Opening Date"),
        "original_category": row.get("Status"),
        "source_url": absolute_url("https://www.nevadaepro.com", detail_link),
        "attachments": [],
    }


def fetch_nv_epro_opportunities(
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
            html = fetch_html(NV_EPRO_SEARCH_URL, session=session, timeout=timeout)
        except HtmlPageError as error:
            raise NvEproError(str(error)) from error

    try:
        rows = extract_table_rows(html, required_headers=NV_EPRO_HEADERS)
    except HtmlPageError as error:
        raise NvEproError(str(error)) from error
    records = [_record_from_row(row, source) for row in rows if row.get("Bid Solicitation #")]

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
