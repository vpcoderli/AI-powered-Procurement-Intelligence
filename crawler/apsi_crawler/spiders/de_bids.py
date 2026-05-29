import json

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


DE_BIDS_PAGE_URL = "https://contracts.delaware.gov/Bids"
DE_BIDS_SEARCH_URL = "https://contracts.delaware.gov/Bids/GetBids?status=Open"
DE_BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


class DeBidsError(Exception):
    pass


def _records_from_payload(payload):
    if isinstance(payload, dict) and isinstance(payload.get("rows"), list):
        return payload["rows"]
    raise DeBidsError("Delaware bids response did not contain jqGrid rows")


def _first_present(record, keys):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return None


def _record_from_json(record):
    source_bid_id = _first_present(record, ("ContractNumber", "Id"))
    if not source_bid_id:
        raise DeBidsError("Delaware bid record is missing contract number")
    return {
        "source_bid_id": str(source_bid_id),
        "title": record.get("Title") or str(source_bid_id),
        "description": record.get("Title") or str(source_bid_id),
        "issuer_name": record.get("AgencyCode") or "State of Delaware",
        "published_date": record.get("OpenDate"),
        "deadline_date": record.get("DeadlineDate") or record.get("DeadlineTime"),
        "original_category": record.get("BidUnspscCodesString"),
        "contact_email": record.get("ContactEmail"),
        "source_url": DE_BIDS_PAGE_URL,
        "attachments": [],
    }


def _load_payload(fixture_json=None, session=None, query=None, limit=25, timeout=30):
    if fixture_json:
        with open(fixture_json, encoding="utf-8") as fixture:
            return json.load(fixture)

    client = session or requests.Session()
    close_client = session is None
    headers = {
        "User-Agent": DE_BROWSER_USER_AGENT,
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json; charset=utf-8",
        "X-Requested-With": "XMLHttpRequest",
        "Origin": "https://contracts.delaware.gov",
        "Referer": DE_BIDS_PAGE_URL,
    }
    try:
        client.get(
            DE_BIDS_PAGE_URL,
            headers={
                "User-Agent": DE_BROWSER_USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=timeout,
        )
        response = client.post(
            DE_BIDS_SEARCH_URL,
            json={
                "_search": False,
                "rows": int(limit),
                "page": 1,
                "sidx": "OpenDate",
                "sord": "desc",
            },
            headers=headers,
            timeout=timeout,
        )
        if response.status_code != 200:
            raise DeBidsError(
                f"Delaware bids request failed with status {response.status_code}: {response.text}"
            )
        content_type = response.headers.get("Content-Type", "")
        if "json" not in content_type.lower():
            raise DeBidsError(f"Delaware bids response was not JSON: {response.text}")
        return response.json()
    except requests.RequestException as error:
        raise DeBidsError(f"Delaware bids request failed: {error}") from error
    except ValueError as error:
        raise DeBidsError("Delaware bids response was not valid JSON") from error
    finally:
        if close_client:
            client.close()


def fetch_de_bids_opportunities(
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
        raise DeBidsError("Delaware bids response did not contain opportunities")

    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]
