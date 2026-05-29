import json

import requests

from apsi_crawler.html.public_page import absolute_url
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


GA_GPR_INDEX_URL = "https://ssl.doas.state.ga.us/gpr/index"
GA_GPR_SEARCH_URL = "https://ssl.doas.state.ga.us/gpr/eventSearch"


class GaProcurementRegistryError(Exception):
    pass


def _first_present(record, keys, default=None):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return default


def _records_from_payload(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("data", "opportunities", "results", "bids"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return []


def _detail_url(source, record):
    source_number_key = _first_present(record, ("esourceNumberKey", "esourceNumber"))
    source_system_type = _first_present(record, ("sourceId", "sourceSystemType"))
    if not source_number_key or not source_system_type:
        return source.base_url
    return absolute_url(
        source.base_url,
        f"/gpr/eventDetails?eSourceNumber={source_number_key}&sourceSystemType={source_system_type}",
    )


def _record_from_json(record, source):
    source_bid_id = _first_present(record, ("esourceNumber", "source_bid_id", "id"))
    if not source_bid_id:
        raise GaProcurementRegistryError("Georgia registry record is missing event id")

    return {
        "source_bid_id": source_bid_id,
        "title": _first_present(record, ("title", "name")),
        "description": _first_present(record, ("esourceDescription", "description", "title")),
        "issuer_name": _first_present(record, ("agencyName", "agency", "department")),
        "published_date": _first_present(record, ("postingDateStr", "postingDate", "published_date")),
        "deadline_date": _first_present(record, ("closingDateStr", "closingDate", "deadline_date")),
        "original_category": _first_present(record, ("bidProcessType", "status", "category")),
        "source_url": _detail_url(source, record),
        "attachments": [],
    }


def _datatable_payload(query, limit):
    columns = ["", "esourceNumber", "title", "agencyName", "postingDateStr", "closingDateStr", "endingIn", "status"]
    payload = {
        "draw": "1",
        "start": "0",
        "length": str(int(limit)),
        "search[value]": "",
        "search[regex]": "false",
        "responseType": "ALL",
        "eventStatus": "OPEN",
        "eventIdTitle": query or "",
        "govType": "",
        "govEntity": "",
        "catType": "",
        "eventProcessType": "",
        "dateRangeType": "",
        "rangeStartDate": "",
        "rangeEndDate": "",
        "isReset": "false",
        "persisted": "",
        "refreshSearchData": "false",
        "order[0][column]": "5",
        "order[0][dir]": "asc",
    }
    for index, column in enumerate(columns):
        payload[f"columns[{index}][data]"] = column
        payload[f"columns[{index}][name]"] = ""
        payload[f"columns[{index}][searchable]"] = "true"
        payload[f"columns[{index}][orderable]"] = "true"
        payload[f"columns[{index}][search][value]"] = ""
        payload[f"columns[{index}][search][regex]"] = "false"
    return payload


def _load_payload(fixture_json=None, session=None, query=None, limit=25, timeout=30):
    if fixture_json:
        with open(fixture_json, encoding="utf-8") as fixture:
            return json.load(fixture)

    client = session or requests.Session()
    close_client = session is None
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": GA_GPR_INDEX_URL,
        "Origin": "https://ssl.doas.state.ga.us",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    }
    try:
        client.get(GA_GPR_INDEX_URL, headers={"User-Agent": headers["User-Agent"]}, timeout=timeout)
        response = client.post(
            GA_GPR_SEARCH_URL,
            data=_datatable_payload(query, limit),
            headers=headers,
            timeout=timeout,
        )
        if response.status_code != 200:
            raise GaProcurementRegistryError(
                f"Georgia registry request failed with status {response.status_code}: {response.text}"
            )
        return response.json()
    except requests.RequestException as error:
        raise GaProcurementRegistryError(f"Georgia registry request failed: {error}") from error
    except ValueError as error:
        raise GaProcurementRegistryError("Georgia registry response was not valid JSON") from error
    finally:
        if close_client:
            client.close()


def fetch_ga_procurement_registry_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_json=None,
):
    limit_count = int(limit)
    payload = _load_payload(
        fixture_json=fixture_json,
        session=session,
        query=query,
        limit=limit_count,
        timeout=timeout,
    )
    records = [_record_from_json(record, source) for record in _records_from_payload(payload)]
    if not records:
        raise GaProcurementRegistryError("Georgia registry response did not contain opportunities")

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
