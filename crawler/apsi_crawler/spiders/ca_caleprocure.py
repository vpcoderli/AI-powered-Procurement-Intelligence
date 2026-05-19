import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


CA_CALEPROCURE_SEARCH_URL = "https://caleprocure.ca.gov/pages/search.aspx"


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
    return []


def _normalize_record(record):
    return {
        "source_bid_id": record.get("eventId") or record.get("id"),
        "title": record.get("title") or record.get("name"),
        "description": record.get("description") or record.get("summary"),
        "original_category": record.get("category") or record.get("type"),
        "published_date": record.get("postedDate"),
        "deadline_date": record.get("dueDate"),
        "issuer_name": record.get("department") or record.get("agency"),
        "source_url": record.get("url"),
    }


def fetch_ca_caleprocure_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
):
    client = session or requests.Session()
    limit_count = int(limit)
    params = {"query": query or "", "limit": limit_count}
    response = client.get(CA_CALEPROCURE_SEARCH_URL, params=params, timeout=timeout)

    if response.status_code != 200:
        raise CalEProcureError(
            f"Cal eProcure request failed with status {response.status_code}: {response.text}"
        )

    try:
        payload = response.json()
    except ValueError as error:
        raise CalEProcureError("Cal eProcure response was not valid JSON") from error

    records = _records_from_payload(payload)[:limit_count]
    return [
        normalize_state_opportunity(_normalize_record(record), source)
        for record in records
    ]
