import json
import re
from datetime import datetime, timezone
from urllib.parse import urlencode

import requests

from apsi_crawler.html.public_page import absolute_url
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


IA_BID_SEARCH_URL = "https://bidopportunities.iowa.gov/Home/DT_HostedBidsSearch"
IA_BID_DETAIL_PATH = "/Home/BidInfo"


class IaBidOpportunitiesError(Exception):
    pass


def _first_present(record, keys, default=None):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return default


def _date_from_ms_date(value):
    if not value:
        return None
    match = re.search(r"/Date\((\d+)\)/", str(value))
    if not match:
        return value
    timestamp = int(match.group(1)) / 1000
    return datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat()


def _records_from_payload(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("aaData", "data", "opportunities", "results", "bids"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return []


def _detail_url(source, bid_id):
    return absolute_url(
        source.base_url,
        f"{IA_BID_DETAIL_PATH}?{urlencode({'bidId': bid_id})}",
    )


def _record_from_json(record, source):
    bid_id = _first_present(record, ("ID", "id"))
    source_bid_id = _first_present(record, ("BidNumber", "bidNumber", "source_bid_id", "id"))
    if not source_bid_id:
        raise IaBidOpportunitiesError("Iowa bid record is missing bid number")

    return {
        "source_bid_id": source_bid_id,
        "title": _first_present(record, ("Solicitation", "title", "name")),
        "description": _first_present(record, ("Description", "summary", "Solicitation")),
        "issuer_name": _first_present(record, ("AgencyName", "agency", "department")),
        "published_date": _date_from_ms_date(_first_present(record, ("EffectiveDate", "published_date"))),
        "deadline_date": _date_from_ms_date(_first_present(record, ("ExpirationDate", "deadline_date"))),
        "original_category": _first_present(record, ("Status", "category")),
        "contact_name": _first_present(record, ("AgencyContactName", "contact_name")),
        "contact_email": _first_present(record, ("AgencyContactEmail", "contact_email")),
        "contact_phone": _first_present(record, ("AgencyContactPhoneNumber", "contact_phone")),
        "source_url": _detail_url(source, bid_id) if bid_id else source.base_url,
        "attachments": [],
    }


def _load_payload(fixture_json=None, session=None, query=None, limit=25, timeout=30):
    if fixture_json:
        with open(fixture_json, encoding="utf-8") as fixture:
            return json.load(fixture)

    client = session or requests.Session()
    close_client = session is None
    try:
        params = {
            "agencyId": "",
            "enteredSearchText": query or "",
            "draw": 1,
            "start": 0,
            "length": int(limit),
            "search[value]": "",
            "order[0][column]": 5,
            "order[0][dir]": "desc",
        }
        response = client.get(
            IA_BID_SEARCH_URL,
            params=params,
            headers={
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": source_url_for_referer(),
                "User-Agent": "Mozilla/5.0",
            },
            timeout=timeout,
        )
        if response.status_code != 200:
            raise IaBidOpportunitiesError(
                f"Iowa bid API request failed with status {response.status_code}: {response.text}"
            )
        return response.json()
    except requests.RequestException as error:
        raise IaBidOpportunitiesError(f"Iowa bid API request failed: {error}") from error
    except ValueError as error:
        raise IaBidOpportunitiesError("Iowa bid API response was not valid JSON") from error
    finally:
        if close_client:
            client.close()


def source_url_for_referer():
    return "https://bidopportunities.iowa.gov/"


def fetch_ia_bid_opportunities(
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
        raise IaBidOpportunitiesError("Iowa bid API response did not contain opportunities")

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
