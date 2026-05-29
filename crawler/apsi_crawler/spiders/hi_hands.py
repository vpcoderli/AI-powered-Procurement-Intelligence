import json

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


HI_HANDS_API_URL = "https://hands.ehawaii.gov/hands/api/bidding-opportunities"
HI_HANDS_DETAIL_URL = "https://hands.ehawaii.gov/hands/opportunities/opportunity-details/{id}"


class HiHandsError(Exception):
    pass


def _search_payload(query):
    return {
        "query": query or "",
        "showClosed": False,
        "showCancelled": False,
        "omitPagination": False,
        "categories": [],
        "procurementCategory": "",
        "department": "",
        "islands": [],
        "statuses": ["POSTED"],
        "publishDate": "",
        "offerDueDate": "",
        "jurisdiction": "",
    }


def _records_from_payload(payload):
    if not isinstance(payload, dict):
        raise HiHandsError("Hawaii HANDS response was not an object")
    search_result = payload.get("data", {}).get("searchResult", {})
    records = search_result.get("content")
    if not isinstance(records, list):
        raise HiHandsError("Hawaii HANDS response did not contain searchResult content")
    return records, bool(search_result.get("last", True))


def _load_payload(page, query=None, session=None, timeout=30, fixture_json=None, size=25):
    if fixture_json:
        with open(fixture_json, encoding="utf-8") as fixture:
            return json.load(fixture)

    client = session or requests.Session()
    close_client = session is None
    try:
        response = client.post(
            HI_HANDS_API_URL,
            params={"size": size, "page": page, "sort": "publish_date_dt,desc"},
            json=_search_payload(query),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 APSI crawler",
            },
            timeout=timeout,
        )
        if response.status_code != 200:
            raise HiHandsError(
                f"Hawaii HANDS request failed with status {response.status_code}: {response.text}"
            )
        return response.json()
    except requests.RequestException as error:
        raise HiHandsError(f"Hawaii HANDS request failed: {error}") from error
    except ValueError as error:
        raise HiHandsError("Hawaii HANDS response was not valid JSON") from error
    finally:
        if close_client:
            client.close()


def _first_present(record, keys):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return None


def _detail_url(record):
    details_url = record.get("detailsUrl")
    if details_url:
        return details_url
    if record.get("id") not in (None, ""):
        return HI_HANDS_DETAIL_URL.format(id=record["id"])
    return "https://hands.ehawaii.gov/hands"


def _record_from_json(record):
    if not isinstance(record, dict):
        raise HiHandsError("Hawaii HANDS record was not an object")

    source_bid_id = _first_present(record, ("solicitionNo", "solicitationNo", "id"))
    if not source_bid_id:
        raise HiHandsError("Hawaii HANDS record is missing solicitation id")

    title = _first_present(record, ("title", "solicitionNo", "id"))
    description_parts = [
        part
        for part in (
            record.get("title"),
            record.get("department"),
            record.get("division"),
            record.get("island"),
            record.get("system"),
        )
        if part
    ]
    return {
        "source_bid_id": str(source_bid_id),
        "title": str(title).strip(),
        "description": " | ".join(str(part).strip() for part in description_parts),
        "issuer_name": record.get("department") or "State of Hawaii",
        "published_date": record.get("publishDate"),
        "deadline_date": record.get("dueDate"),
        "original_category": record.get("category"),
        "source_url": _detail_url(record),
        "division": record.get("division"),
        "jurisdiction": record.get("jurisdiction"),
        "island": record.get("island"),
        "status": record.get("status"),
        "system": record.get("system"),
        "attachments": [],
    }


def fetch_hi_hands_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_json=None,
):
    limit_count = int(limit)
    records = []
    page = 0
    page_size = max(limit_count, 25)
    while len(records) < limit_count:
        payload = _load_payload(
            page,
            query=query,
            session=session,
            timeout=timeout,
            fixture_json=fixture_json,
            size=page_size,
        )
        page_records, is_last = _records_from_payload(payload)
        records.extend(_record_from_json(record) for record in page_records)
        if fixture_json or is_last:
            break
        page += 1

    if not records:
        raise HiHandsError("Hawaii HANDS response did not contain opportunities")

    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]
