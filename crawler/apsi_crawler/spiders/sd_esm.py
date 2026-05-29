import json

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


SD_ESM_BOARD_ID = "3444a404-3818-494f-84c5-2a850acd7779"
SD_ESM_EVENTS_URL = f"https://postingboard.esmsolutions.com/api/postingBoard/{SD_ESM_BOARD_ID}/currentevents"
SD_ESM_DETAIL_URL = f"https://postingboard.esmsolutions.com/{SD_ESM_BOARD_ID}/eventDetail/{{event_id}}"


class SdEsmError(Exception):
    pass


def _records_from_payload(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        value = payload.get("data") or payload.get("results")
        if isinstance(value, list):
            return value
    return []


def _record_from_json(record):
    event_id = record.get("eventId")
    if not event_id:
        raise SdEsmError("South Dakota ESM event is missing event id")
    invitation_type = record.get("invitationType") or {}
    status = record.get("status") or {}
    title = record.get("eventName")
    return {
        "source_bid_id": str(event_id),
        "title": title,
        "description": title,
        "issuer_name": "South Dakota ESM Posting Board",
        "published_date": record.get("publishedDate"),
        "deadline_date": record.get("eventDueDate"),
        "original_category": invitation_type.get("description") or status.get("description"),
        "source_url": SD_ESM_DETAIL_URL.format(event_id=event_id),
        "attachments": [],
    }


def _load_payload(fixture_json=None, session=None, limit=25, timeout=30):
    if fixture_json:
        with open(fixture_json, encoding="utf-8") as fixture:
            return json.load(fixture)
    client = session or requests.Session()
    close_client = session is None
    try:
        response = client.get(
            SD_ESM_EVENTS_URL,
            params={
                "pageNo": 0,
                "recordsPerPage": int(limit),
                "browserGlobalTimeZoneNameId": "Coordinated Universal Time",
                "browserGlobalTimeZoneName": "UTC",
                "browserOffset": "+00:00:00",
            },
            headers={"Accept": "application/json, text/plain, */*","User-Agent": "Mozilla/5.0"},
            timeout=timeout,
        )
        if response.status_code != 200:
            raise SdEsmError(f"South Dakota ESM request failed with status {response.status_code}: {response.text}")
        return response.json()
    except requests.RequestException as error:
        raise SdEsmError(f"South Dakota ESM request failed: {error}") from error
    except ValueError as error:
        raise SdEsmError("South Dakota ESM response was not valid JSON") from error
    finally:
        if close_client:
            client.close()


def fetch_sd_esm_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_json=None,
):
    limit_count = int(limit)
    payload = _load_payload(fixture_json=fixture_json, session=session, limit=limit_count, timeout=timeout)
    records = [_record_from_json(record) for record in _records_from_payload(payload)]
    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]
