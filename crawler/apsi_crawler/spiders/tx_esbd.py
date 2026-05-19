import json

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


TX_ESBD_SEARCH_URL = "https://www.txsmartbuy.gov/esbd"


class TxEsbdError(Exception):
    pass


def _records_from_payload(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("opportunities", "results"):
            records = payload.get(key)
            if isinstance(records, list):
                return records
    raise TxEsbdError("Texas ESBD response did not contain opportunities or results")


def _first_present(record, keys):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return None


def _normalize_record(record):
    if not isinstance(record, dict):
        raise TxEsbdError("Texas ESBD record was not an object")

    source_bid_id = _first_present(
        record,
        ("source_bid_id", "solicitationId", "solicitation_id", "id", "bid_id"),
    )
    if not source_bid_id:
        raise TxEsbdError("Texas ESBD record is missing source id")

    return {
        "source_bid_id": source_bid_id,
        "title": _first_present(record, ("title", "name", "solicitationTitle")),
        "description": _first_present(record, ("description", "summary")),
        "original_category": _first_present(
            record,
            ("category", "classItem", "commodity"),
        ),
        "published_date": _first_present(
            record,
            ("published_date", "postedDate", "posted_date"),
        ),
        "deadline_date": _first_present(
            record,
            ("deadline_date", "dueDate", "due_date", "response_deadline"),
        ),
        "issuer_name": _first_present(record, ("issuer_name", "agency", "department")),
        "source_url": _first_present(record, ("source_url", "url", "link")),
    }


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
    else:
        client = session or requests.Session()
        close_client = session is None
        params = {"query": query or "", "limit": limit_count}
        try:
            try:
                response = client.get(TX_ESBD_SEARCH_URL, params=params, timeout=timeout)
            except requests.RequestException as error:
                raise TxEsbdError(f"Texas ESBD request failed: {error}") from error

            if response.status_code != 200:
                raise TxEsbdError(
                    f"Texas ESBD request failed with status {response.status_code}: {response.text}"
                )

            try:
                payload = response.json()
            except ValueError as error:
                raise TxEsbdError("Texas ESBD response was not valid JSON") from error
        finally:
            if close_client:
                client.close()

    records = _records_from_payload(payload)[:limit_count]
    return [
        normalize_state_opportunity(_normalize_record(record), source)
        for record in records
    ]
