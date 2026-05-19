import json

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


CA_CALEPROCURE_SEARCH_URL = "https://caleprocure.ca.gov/pages/public-search.aspx"


class CalEProcureError(Exception):
    pass


def _records_from_payload(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("opportunities", "results"):
            records = payload.get(key)
            if isinstance(records, list):
                return records
    raise CalEProcureError(
        "Cal eProcure response did not contain opportunities or results"
    )


def _first_present(record, keys):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return None


def _normalize_record(record):
    source_bid_id = _first_present(
        record,
        ("source_bid_id", "eventId", "id", "bid_id", "solicitation_id"),
    )
    if not source_bid_id:
        raise CalEProcureError("Cal eProcure record is missing source id")

    return {
        "source_bid_id": source_bid_id,
        "title": record.get("title") or record.get("name"),
        "description": record.get("description") or record.get("summary"),
        "original_category": record.get("category") or record.get("type"),
        "published_date": _first_present(record, ("published_date", "postedDate", "posted_date")),
        "deadline_date": _first_present(
            record,
            ("deadline_date", "dueDate", "due_date", "response_deadline"),
        ),
        "issuer_name": _first_present(record, ("issuer_name", "department", "agency")),
        "source_url": _first_present(record, ("source_url", "url", "link")),
    }


def fetch_ca_caleprocure_opportunities(
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
                response = client.get(CA_CALEPROCURE_SEARCH_URL, params=params, timeout=timeout)
            except requests.RequestException as error:
                raise CalEProcureError(f"Cal eProcure request failed: {error}") from error

            if response.status_code != 200:
                raise CalEProcureError(
                    f"Cal eProcure request failed with status {response.status_code}: {response.text}"
                )

            try:
                payload = response.json()
            except ValueError as error:
                raise CalEProcureError("Cal eProcure response was not valid JSON") from error
        finally:
            if close_client:
                client.close()

    records = _records_from_payload(payload)[:limit_count]
    return [
        normalize_state_opportunity(_normalize_record(record), source)
        for record in records
    ]
