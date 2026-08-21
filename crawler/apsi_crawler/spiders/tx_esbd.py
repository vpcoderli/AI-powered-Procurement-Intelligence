import json

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


# txsmartbuy.gov is a NetSuite SuiteCommerce site. The public ESBD search page
# (https://www.txsmartbuy.gov/esbd — "Sign in is NOT required") loads its data by
# POSTing the search model to this extension service; c/n identify the public
# NetSuite site and are required for the service to route.
TX_ESBD_SEARCH_URL = "https://www.txsmartbuy.gov/esbd"
TX_ESBD_SERVICE_URL = (
    "https://www.txsmartbuy.gov/app/extensions/CPA/CPAMain/1.0.0/services/ESBD.Service.ss"
    "?c=852252&n=2"
)
TX_ESBD_DETAIL_URL_TEMPLATE = "https://www.txsmartbuy.gov/esbd/{record_id}"
# Server-fixed page size observed from the service response's recordsPerPage.
TX_ESBD_RECORDS_PER_PAGE = 24
# status "1" == "Posted" (open solicitations) in the ESBD search model.
TX_ESBD_POSTED_STATUS = "1"


class TxEsbdError(Exception):
    pass


def _records_from_payload(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("lines", "opportunities", "results"):
            records = payload.get(key)
            if isinstance(records, list):
                return records
    raise TxEsbdError("Texas ESBD response did not contain solicitation lines")


def _first_present(record, keys):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return None


def _deadline_from_record(record):
    due_date = _first_present(
        record,
        ("deadline_date", "responseDue", "dueDate", "due_date", "response_deadline"),
    )
    due_time = _first_present(record, ("responseTime",))
    if due_date and due_time:
        return f"{due_date} {due_time}"
    return due_date


def _source_url_from_record(record, source_bid_id):
    explicit = _first_present(record, ("source_url", "url", "link", "repostURL"))
    if explicit:
        return explicit
    record_id = _first_present(record, ("internalid",)) or source_bid_id
    return TX_ESBD_DETAIL_URL_TEMPLATE.format(record_id=record_id)


def _normalize_record(record):
    if not isinstance(record, dict):
        raise TxEsbdError("Texas ESBD record was not an object")

    source_bid_id = _first_present(
        record,
        ("source_bid_id", "solicitationId", "solicitation_id", "internalid", "id", "bid_id"),
    )
    if not source_bid_id:
        raise TxEsbdError("Texas ESBD record is missing source id")

    return {
        "source_bid_id": source_bid_id,
        "title": _first_present(record, ("title", "name", "solicitationTitle")),
        "description": _first_present(record, ("description", "summary", "nigpCodes")),
        "original_category": _first_present(
            record,
            ("category", "classItem", "commodity", "statusName"),
        ),
        "published_date": _first_present(
            record,
            ("published_date", "postingDate", "postedDate", "posted_date"),
        ),
        "deadline_date": _deadline_from_record(record),
        "issuer_name": _first_present(
            record,
            ("issuer_name", "agencyName", "agency", "department"),
        ),
        "source_url": _source_url_from_record(record, source_bid_id),
    }


def _fetch_service_page(client, page, query, timeout):
    body = {
        "status": TX_ESBD_POSTED_STATUS,
        "solicitations": "solicitations",
        "page": page,
    }
    if query:
        body["keyword"] = query

    try:
        response = client.post(
            TX_ESBD_SERVICE_URL,
            json=body,
            headers={"Accept": "application/json"},
            timeout=timeout,
        )
    except requests.RequestException as error:
        raise TxEsbdError(f"Texas ESBD request failed: {error}") from error

    if response.status_code != 200:
        raise TxEsbdError(
            f"Texas ESBD request failed with status {response.status_code}: {response.text}"
        )

    try:
        return response.json()
    except ValueError as error:
        raise TxEsbdError("Texas ESBD response was not valid JSON") from error


def fetch_tx_esbd_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_json=None,
):
    limit_count = int(limit)
    if fixture_json:
        with open(fixture_json) as fixture:
            payload = json.load(fixture)
        records = _records_from_payload(payload)[:limit_count]
    else:
        client = session or requests.Session()
        close_client = session is None
        records = []
        page = 1
        try:
            while len(records) < limit_count:
                payload = _fetch_service_page(client, page, query, timeout)
                page_records = _records_from_payload(payload)
                records.extend(page_records)
                if len(page_records) < TX_ESBD_RECORDS_PER_PAGE:
                    break
                page += 1
        finally:
            if close_client:
                client.close()
        records = records[:limit_count]

    return [
        normalize_state_opportunity(_normalize_record(record), source)
        for record in records
    ]
