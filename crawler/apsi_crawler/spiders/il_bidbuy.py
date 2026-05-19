import json

from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    extract_table_rows,
    fetch_html,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


IL_BIDBUY_OPEN_BIDS_URL = (
    "https://www.bidbuy.illinois.gov/bso/view/search/external/"
    "advancedSearchBid.xhtml"
)
IL_BIDBUY_OPEN_BIDS_PARAMS = {"openBids": "true"}
IL_BIDBUY_OPEN_BIDS_DISPLAY_URL = f"{IL_BIDBUY_OPEN_BIDS_URL}?openBids=true"
IL_BIDBUY_BASE_URL = "https://www.bidbuy.illinois.gov"
IL_BIDBUY_HEADERS = (
    "Bid Solicitation #",
    "Description",
    "Organization Name",
    "Bid Opening Date",
    "Status",
    "Alternate Id",
)


class IlBidBuyError(Exception):
    pass


def _row_to_record(row):
    source_bid_id = row.get("Bid Solicitation #")
    if not source_bid_id:
        raise IlBidBuyError("Illinois BidBuy row is missing bid solicitation number")

    links = row.get("_links", {})
    detail_href = links.get("Bid Solicitation #")
    return {
        "source_bid_id": source_bid_id,
        "title": row.get("Description"),
        "description": row.get("Description"),
        "deadline_date": row.get("Bid Opening Date"),
        "issuer_name": row.get("Organization Name"),
        "source_url": absolute_url(IL_BIDBUY_BASE_URL, detail_href)
        if detail_href
        else IL_BIDBUY_OPEN_BIDS_DISPLAY_URL,
        "status": row.get("Status"),
        "alternate_id": row.get("Alternate Id"),
    }


def _records_from_html(html):
    try:
        rows = extract_table_rows(html, required_headers=IL_BIDBUY_HEADERS)
    except HtmlPageError as error:
        raise IlBidBuyError(
            "Illinois BidBuy page missing expected bid table headers"
        ) from error
    return [_row_to_record(row) for row in rows]


def _records_from_json(path):
    with open(path, encoding="utf-8") as fixture:
        payload = json.load(fixture)
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("opportunities", "results"):
            records = payload.get(key)
            if isinstance(records, list):
                return records
    raise IlBidBuyError(
        "Illinois BidBuy fixture JSON did not contain opportunities or results"
    )


def fetch_il_bidbuy_opportunities(
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
        records = _records_from_json(fixture_json)
    else:
        if fixture_html:
            html = read_html_fixture(fixture_html)
        else:
            try:
                html = fetch_html(
                    IL_BIDBUY_OPEN_BIDS_URL,
                    session=session,
                    timeout=timeout,
                    params=IL_BIDBUY_OPEN_BIDS_PARAMS,
                )
            except HtmlPageError as error:
                raise IlBidBuyError(str(error)) from error
        records = _records_from_html(html)

    return [
        normalize_state_opportunity(record, source)
        for record in records[:limit_count]
        if not query
        or query.lower() in " ".join(str(value) for value in record.values()).lower()
    ]
