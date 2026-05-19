import json

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


FL_MFMP_SEARCH_URL = "https://vendor.myfloridamarketplace.com/mfmp/pub/search/bids"
FL_MFMP_DETAIL_URL_TEMPLATE = (
    "https://vendor.myfloridamarketplace.com/search/bids/detail/{source_bid_id}"
)


class FlMfmpError(Exception):
    pass


def _records_from_payload(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("opportunities", "results"):
            records = payload.get(key)
            if isinstance(records, list):
                return records
    raise FlMfmpError(
        "MyFloridaMarketPlace response did not contain opportunities or results"
    )


def _first_present(record, keys):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return None


def _normalize_record(record):
    if not isinstance(record, dict):
        raise FlMfmpError("MyFloridaMarketPlace record was not an object")

    source_bid_id = _first_present(
        record,
        (
            "source_bid_id",
            "advertisementId",
            "id",
            "advertisement_id",
            "adNumber",
            "agencyAdNumber",
            "bid_id",
            "solicitation_id",
        ),
    )
    if not source_bid_id:
        raise FlMfmpError("MyFloridaMarketPlace record is missing source id")

    return {
        "source_bid_id": source_bid_id,
        "title": _first_present(
            record,
            (
                "title",
                "uniqueName",
                "name",
                "advertisementTitle",
                "solicitationTitle",
            ),
        ),
        "description": _first_present(record, ("description", "summary")),
        "original_category": _first_present(
            record,
            ("category", "type", "commodity"),
        ),
        "published_date": _first_present(
            record,
            (
                "published_date",
                "publishDate",
                "postedDate",
                "posted_date",
                "advertisementDate",
                "openDate",
            ),
        ),
        "deadline_date": _first_present(
            record,
            (
                "deadline_date",
                "closeDate",
                "dueDate",
                "due_date",
                "response_deadline",
                "endDate",
            ),
        ),
        "issuer_name": _first_present(
            record,
            ("issuer_name", "agency", "organization", "department", "buyer"),
        ),
        "source_url": _first_present(record, ("source_url", "url", "link"))
        or FL_MFMP_DETAIL_URL_TEMPLATE.format(source_bid_id=source_bid_id),
    }


def fetch_fl_mfmp_opportunities(
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
        payload = {
            "pageSize": limit_count,
            "type": [],
            "status": [],
            "agency": [],
            "adNumber": "",
            "agencyAdvertisementNumber": "",
            "title": query or "",
            "publishedDate": "",
            "openDate": "",
            "endDate": "",
            "commodityCodes": [],
            "intendsToParticipate": "",
            "assignee": "",
            "page": 1,
        }
        try:
            try:
                response = client.post(
                    FL_MFMP_SEARCH_URL,
                    json=payload,
                    timeout=timeout,
                )
            except requests.RequestException as error:
                raise FlMfmpError(
                    f"MyFloridaMarketPlace request failed: {error}"
                ) from error

            if response.status_code != 200:
                raise FlMfmpError(
                    "MyFloridaMarketPlace request failed with status "
                    f"{response.status_code}: {response.text}"
                )

            try:
                payload = response.json()
            except ValueError as error:
                raise FlMfmpError(
                    "MyFloridaMarketPlace response was not valid JSON"
                ) from error
        finally:
            if close_client:
                client.close()

    records = _records_from_payload(payload)[:limit_count]
    return [
        normalize_state_opportunity(_normalize_record(record), source)
        for record in records
    ]
