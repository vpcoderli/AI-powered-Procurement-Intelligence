import json
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


MS_BID_DATA_URL = "https://www.ms.gov/dfa/contract_bid_search/Bid/BidData?AppId=1"
MS_BID_REFERER = "https://www.ms.gov/dfa/contract_bid_search/Bid?autoloadGrid=true"
MS_PROCUREMENT_TIMEZONE = ZoneInfo("America/Chicago")


class MsContractBidSearchError(Exception):
    pass


def _date_from_ms(value):
    if not value:
        return None
    match = re.search(r"/Date\((\d+)\)/", str(value))
    if not match:
        return value
    return (
        datetime.fromtimestamp(int(match.group(1)) / 1000, timezone.utc)
        .astimezone(MS_PROCUREMENT_TIMEZONE)
        .date()
        .isoformat()
    )


def _records_from_payload(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        value = payload.get("aaData") or payload.get("data") or payload.get("results")
        if isinstance(value, list):
            return value
    return []


def _attachments_from_record(record):
    attachments = []
    for item in record.get("Attachments") or []:
        url = item.get("Url")
        if url:
            attachments.append(
                {
                    "name": item.get("Description") or f"Attachment {len(attachments) + 1}",
                    "url": url,
                    "size_label": None,
                    "mime_type": None,
                    "sort_order": len(attachments),
                }
            )
    if record.get("PDFUrl"):
        attachments.append(
            {
                "name": "Bid PDF",
                "url": record.get("PDFUrl"),
                "size_label": None,
                "mime_type": None,
                "sort_order": len(attachments),
            }
        )
    return attachments


def _record_from_json(record):
    source_bid_id = str(record.get("BidID") or record.get("BidNumber") or "")
    if not source_bid_id:
        raise MsContractBidSearchError("Mississippi bid record is missing bid id")
    return {
        "source_bid_id": source_bid_id,
        "title": record.get("BidDescription") or record.get("BidNumber"),
        "description": record.get("BidDescription"),
        "issuer_name": record.get("Agency") or "Statewide",
        "published_date": _date_from_ms(record.get("AdvertiseDate")),
        "deadline_date": _date_from_ms(record.get("SubmissionDate") or record.get("OpeningDate")),
        "original_category": record.get("BidType") or record.get("BidStatus"),
        "contact_name": record.get("BuyerName"),
        "contact_email": record.get("BuyerEmail"),
        "contact_phone": record.get("BuyerPhone"),
        "source_url": f"https://www.ms.gov/dfa/contract_bid_search/Bid/Details/{source_bid_id}",
        "attachments": _attachments_from_record(record),
    }


def _datatable_payload(limit):
    columns = [
        "Agency",
        "BidID",
        "BidNumber",
        "BidDescription",
        "BidStatus",
        "BidType",
        "AdvertiseDate",
        "SubmissionDate",
        "OpeningDate",
    ]
    payload = {
        "sEcho": "1",
        "iColumns": str(len(columns)),
        "iDisplayStart": "0",
        "iDisplayLength": str(int(limit)),
        "sSearch": "",
        "bRegex": "false",
        "iSortCol_0": "0",
        "sSortDir_0": "asc",
        "iSortingCols": "1",
    }
    for index, column in enumerate(columns):
        payload[f"mDataProp_{index}"] = column
        payload[f"sSearch_{index}"] = ""
        payload[f"bRegex_{index}"] = "false"
        payload[f"bSearchable_{index}"] = "true"
        payload[f"bSortable_{index}"] = "true"
    return payload


def _load_payload(fixture_json=None, session=None, limit=25, timeout=30):
    if fixture_json:
        with open(fixture_json, encoding="utf-8") as fixture:
            return json.load(fixture)
    client = session or requests.Session()
    close_client = session is None
    try:
        response = client.post(
            MS_BID_DATA_URL,
            data=_datatable_payload(limit),
            headers={
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": MS_BID_REFERER,
                "User-Agent": "Mozilla/5.0",
            },
            timeout=timeout,
        )
        if response.status_code != 200:
            raise MsContractBidSearchError(
                f"Mississippi bid search request failed with status {response.status_code}: {response.text}"
            )
        return response.json()
    except requests.RequestException as error:
        raise MsContractBidSearchError(f"Mississippi bid search request failed: {error}") from error
    except ValueError as error:
        raise MsContractBidSearchError("Mississippi bid search response was not valid JSON") from error
    finally:
        if close_client:
            client.close()


def fetch_ms_contract_bid_search_opportunities(
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
    if not records:
        raise MsContractBidSearchError("Mississippi bid search response did not contain opportunities")

    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]
