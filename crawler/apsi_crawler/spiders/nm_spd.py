from apsi_crawler.html.public_page import (
    HtmlPageError,
    extract_table_rows,
    fetch_html,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


NM_SPD_URL = "https://spd.gsd.state.nm.us/WebPortal/Modules/Procurement/Public/ProcurementsWebView.aspx"
NM_SPD_HEADERS = (
    "Type",
    "Due Date",
    "Procurement ID",
    "Agency Name",
    "Title",
)


class NmSpdError(Exception):
    pass


def _record_from_row(row):
    source_bid_id = row.get("Procurement ID")
    if not source_bid_id:
        raise NmSpdError("New Mexico procurement row is missing procurement id")
    return {
        "source_bid_id": source_bid_id,
        "title": row.get("Title"),
        "description": row.get("Title"),
        "issuer_name": row.get("Agency Name"),
        "deadline_date": row.get("Due Date"),
        "original_category": row.get("Type"),
        "source_url": NM_SPD_URL,
        "attachments": [],
    }


def fetch_nm_spd_opportunities(
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
            html = fetch_html(NM_SPD_URL, session=session, timeout=timeout)
        except HtmlPageError as error:
            raise NmSpdError(str(error)) from error

    try:
        rows = extract_table_rows(html, required_headers=NM_SPD_HEADERS)
    except HtmlPageError as error:
        raise NmSpdError(str(error)) from error
    records = [
        _record_from_row(row)
        for row in rows
        if row.get("Procurement ID") and row.get("Title") and row.get("Due Date")
    ]

    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]
