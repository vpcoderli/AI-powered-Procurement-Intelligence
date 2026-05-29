from apsi_crawler.html.public_page import (
    HtmlPageError,
    extract_html_tables,
    fetch_html,
    normalize_space,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


OK_ESUPPLIER_URL = "https://financials.ok.gov/psc/SOKLFP1DS/SUPPLIER/ERP/c/SCP_PUBLIC_MENU_FL.SCP_PUB_BID_CMP_FL.GBL"
OK_ESUPPLIER_HEADERS = (
    "Event Name",
    "Business Unit",
    "Event ID",
    "Event Format",
    "Event Type",
    "Start Date",
    "End Date",
)


class OkEsupplierError(Exception):
    pass


def _extract_opportunity_rows(html):
    tables = extract_html_tables(html)
    for table in tables:
        if not table:
            continue
        header_index = None
        headers = []
        for index, row in enumerate(table):
            row_headers = [cell["text"] for cell in row]
            if all(header in row_headers for header in OK_ESUPPLIER_HEADERS):
                header_index = index
                headers = row_headers
                break
        if header_index is None or len(table) <= header_index + 1:
            continue

        rows = []
        for row in table[header_index + 1:]:
            values = {}
            for index, header in enumerate(headers):
                cell = row[index] if index < len(row) else {"text": ""}
                values[header] = normalize_space(cell["text"])
            rows.append(values)
        return rows
    raise HtmlPageError("HTML table was missing required Oklahoma event headers")


def _record_from_row(row):
    source_bid_id = row.get("Event ID")
    if not source_bid_id:
        raise OkEsupplierError("Oklahoma event row is missing event id")
    return {
        "source_bid_id": source_bid_id,
        "title": row.get("Event Name"),
        "description": row.get("Event Name"),
        "issuer_name": row.get("Business Unit"),
        "published_date": row.get("Start Date"),
        "deadline_date": row.get("End Date"),
        "original_category": row.get("Event Type") or row.get("Event Format"),
        "source_url": OK_ESUPPLIER_URL,
        "attachments": [],
    }


def fetch_ok_esupplier_opportunities(
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
            html = fetch_html(OK_ESUPPLIER_URL, session=session, timeout=timeout)
        except HtmlPageError as error:
            raise OkEsupplierError(str(error)) from error

    records = [_record_from_row(row) for row in _extract_opportunity_rows(html) if row.get("Event ID")]
    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]
