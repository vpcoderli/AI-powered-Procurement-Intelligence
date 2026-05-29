import json

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


CT_CTSOURCE_SEARCH_URL = "https://webprocure.proactiscloud.com/wp-full-text-search/search/sols"
CT_CTSOURCE_DETAIL_URL = "https://webprocure.proactiscloud.com/wp-web-public/#/bidboard/bid/{bid_id}"


class CtCtsourceError(Exception):
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
    if isinstance(payload, dict):
        for key in ("records", "results", "hits", "data", "solicitations"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []


def _record_from_json(record):
    bid_id = _first_present(record, ("bidid", "bidId", "id"))
    if not bid_id:
        raise CtCtsourceError("CTsource record is missing bid id")
    bid_class = record.get("orgBidClassType") or {}
    creator = record.get("creatorOrg") or record.get("ownerOrg") or {}
    return {
        "source_bid_id": str(bid_id),
        "title": record.get("title"),
        "description": record.get("description") or record.get("title"),
        "issuer_name": creator.get("name"),
        "published_date": record.get("startDate"),
        "deadline_date": record.get("statusDate"),
        "original_category": bid_class.get("description") or bid_class.get("code"),
        "source_url": CT_CTSOURCE_DETAIL_URL.format(bid_id=bid_id),
        "attachments": [],
    }


def _load_payload(fixture_json=None, session=None, query=None, limit=25, timeout=30):
    if fixture_json:
        with open(fixture_json, encoding="utf-8") as fixture:
            return json.load(fixture)
    client = session or requests.Session()
    close_client = session is None
    try:
        response = client.get(
            CT_CTSOURCE_SEARCH_URL,
            params={
                "customerid": 51,
                "q": query or "*",
                "from": 0,
                "sort": "r",
                "f": "ps=Open",
                "oids": "",
            },
            headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"},
            timeout=timeout,
        )
        if response.status_code != 200:
            raise CtCtsourceError(
                f"CTsource search request failed with status {response.status_code}: {response.text}"
            )
        return response.json()
    except requests.RequestException as error:
        raise CtCtsourceError(f"CTsource search request failed: {error}") from error
    except ValueError as error:
        raise CtCtsourceError("CTsource search response was not valid JSON") from error
    finally:
        if close_client:
            client.close()


def fetch_ct_ctsource_opportunities(
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
    records = [_record_from_json(record) for record in _records_from_payload(payload)]
    if not records:
        raise CtCtsourceError("CTsource search response did not contain opportunities")

    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]
