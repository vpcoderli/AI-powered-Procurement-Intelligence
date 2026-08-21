"""California Cal eProcure (CSCR) spider.

Fetches the public "Response Bid Inquiry" PeopleSoft component that backs Cal
eProcure's event search (https://caleprocure.ca.gov/pages/Events-BS3/event-search.aspx).
A plain guest GET renders the full grid of posted events server-side — no login and
no search POST needed. Two access quirks, both verified live on 2026-08-21:

- The site returns 403 for default library User-Agents (python-requests/curl), so a
  standard browser UA is sent. This is public, no-login data; no CAPTCHA or auth is
  involved.
- PeopleSoft requires cookies ("ckreq" check): the first request of a fresh session
  primes the cookie jar via redirects, so a cookie-less first response is retried once
  on the same session.
"""

import html as html_lib
import re

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


CA_CALEPROCURE_EVENTS_URL = (
    "https://caleprocure.ca.gov/psc/psfpd1/SUPPLIER/ERP/c/AUC_MANAGE_BIDS.AUC_RESP_INQ_AUC.GBL"
)
CA_EVENT_URL_TEMPLATE = "https://caleprocure.ca.gov/event/{business_unit}/{event_id}"

# The portal answers 403 to default HTTP-library User-Agents; standard browser headers
# are required for this public page.
CA_REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
}

# The rendered grid is ~1.1MB and the component is slow; allow more than the generic
# 30s spider default.
CA_DEFAULT_TIMEOUT = 90

_GRID_MARKER = "win0divAUC_ID_COL$"

# PeopleSoft grid cell ids, one per column, suffixed with the 0-based row index.
_FIELD_EVENT_ID = r"AUC_ID_COL\$"
_FIELD_TITLE = r"RESP_INQA1_WK_ZZ_AUC_NAME\$"
_FIELD_DEPARTMENT = r"BUS_UNIT_TBL_FS_DESCR\$201\$\$"
_FIELD_BUSINESS_UNIT = r"RESP_INQA1_WK_BUSINESS_UNIT\$"
_FIELD_END_DATE = r"RESP_INQA1_WK_AUC_DTTM_FINISH\$"
_FIELD_EVENT_TYPE = r"RESP_INQA1_WK_AUC_TYPE\$"
_FIELD_STATUS = r"ZZ_DERIVED_DESCR254\$"


class CalEProcureError(Exception):
    pass


def _cell_text(page_html, field_pattern, row_index):
    match = re.search(
        rf"<DIV\s+id='win0div{field_pattern}{row_index}'.*?</DIV>",
        page_html,
        re.S,
    )
    if not match:
        return None
    text = re.sub(r"<[^>]+>", " ", match.group(0))
    text = html_lib.unescape(text)
    normalized = " ".join(text.split())
    return normalized or None


def _rows_from_page(page_html):
    rows = []
    index = 0
    while True:
        event_id = _cell_text(page_html, _FIELD_EVENT_ID, index)
        if not event_id:
            break
        rows.append(
            {
                "event_id": event_id,
                "title": _cell_text(page_html, _FIELD_TITLE, index),
                "department": _cell_text(page_html, _FIELD_DEPARTMENT, index),
                "business_unit": _cell_text(page_html, _FIELD_BUSINESS_UNIT, index),
                "end_date": _cell_text(page_html, _FIELD_END_DATE, index),
                "event_type": _cell_text(page_html, _FIELD_EVENT_TYPE, index),
                "status": _cell_text(page_html, _FIELD_STATUS, index),
            }
        )
        index += 1
    return rows


def _record_from_row(row):
    event_id = row["event_id"]
    business_unit = row.get("business_unit") or ""
    return {
        "source_bid_id": event_id,
        "title": row.get("title") or event_id,
        "description": row.get("title"),
        "original_category": row.get("event_type"),
        # The public grid carries no posted/start date — only the response deadline.
        "published_date": None,
        "deadline_date": row.get("end_date"),
        "issuer_name": row.get("department") or business_unit or None,
        "source_url": CA_EVENT_URL_TEMPLATE.format(
            business_unit=business_unit, event_id=event_id
        ),
        "attachments": [],
    }


def _fetch_events_html(client, timeout):
    last_response = None
    # First request of a fresh session may bounce off PeopleSoft's cookie check; the
    # redirect chain primes the session cookies, so one retry on the same session is
    # enough. No credentials involved — this is the public guest view.
    for _ in range(2):
        try:
            response = client.get(
                CA_CALEPROCURE_EVENTS_URL,
                headers=CA_REQUEST_HEADERS,
                timeout=timeout,
            )
        except requests.RequestException as error:
            raise CalEProcureError(f"Cal eProcure request failed: {error}") from error

        last_response = response
        if response.status_code == 200 and _GRID_MARKER in response.text:
            return response.text

    if last_response is not None and last_response.status_code != 200:
        raise CalEProcureError(
            f"Cal eProcure request failed with status {last_response.status_code}: "
            f"{last_response.text[:200]}"
        )
    raise CalEProcureError(
        "Cal eProcure response did not contain the public event grid"
    )


def fetch_ca_caleprocure_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=CA_DEFAULT_TIMEOUT,
    fixture_html=None,
):
    limit_count = int(limit)
    if fixture_html:
        with open(fixture_html) as fixture:
            page_html = fixture.read()
    else:
        client = session or requests.Session()
        close_client = session is None
        try:
            page_html = _fetch_events_html(client, timeout)
        finally:
            if close_client:
                client.close()

    rows = _rows_from_page(page_html)
    if not rows:
        raise CalEProcureError(
            "Cal eProcure response did not contain the public event grid"
        )

    records = [_record_from_row(row) for row in rows]
    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text
            in " ".join(str(value) for value in record.values() if value).lower()
        ]

    return [
        normalize_state_opportunity(record, source)
        for record in records[:limit_count]
    ]
