import csv
from io import StringIO

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


WY_AI_BIDS_CSV_URL = "https://docs.google.com/spreadsheets/d/1-ZtjsKt7rwFf07FKUPNk_E-YFe-ld7eT/export?format=csv"
WY_AI_BIDS_PAGE_URL = "https://ai.wyo.gov/divisions/general-services/purchasing/non-construction-bids"


class WyAiBidsError(Exception):
    pass


def _load_csv_text(fixture_csv=None, session=None, timeout=30):
    if fixture_csv:
        with open(fixture_csv, encoding="utf-8") as fixture:
            return fixture.read()
    client = session or requests.Session()
    close_client = session is None
    try:
        response = client.get(
            WY_AI_BIDS_CSV_URL,
            headers={"Accept": "text/csv", "User-Agent": "Mozilla/5.0"},
            timeout=timeout,
        )
        if response.status_code != 200:
            raise WyAiBidsError(f"Wyoming bids CSV request failed with status {response.status_code}: {response.text}")
        if not response.text.strip():
            raise WyAiBidsError("Wyoming bids CSV response was empty")
        return response.text
    except requests.RequestException as error:
        raise WyAiBidsError(f"Wyoming bids CSV request failed: {error}") from error
    finally:
        if close_client:
            client.close()


def _record_from_row(row):
    source_bid_id = row.get("Bid Number")
    if not source_bid_id:
        raise WyAiBidsError("Wyoming bid row is missing bid number")
    return {
        "source_bid_id": source_bid_id,
        "title": row.get("DESCRIPTION"),
        "description": row.get("DESCRIPTION"),
        "issuer_name": row.get("AGENCY NAME"),
        "published_date": row.get("DATE BID SENT OUT"),
        "deadline_date": row.get("OPENING DATE"),
        "contact_email": row.get("AGENGY CONTACT EMAIL"),
        "original_category": row.get("AWARDED TO (Vendor)") or "Bid status",
        "amount": row.get("DOLLAR AMOUNT"),
        "source_url": WY_AI_BIDS_PAGE_URL,
        "attachments": [],
    }


def fetch_wy_ai_bid_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_csv=None,
):
    limit_count = int(limit)
    csv_text = _load_csv_text(fixture_csv=fixture_csv, session=session, timeout=timeout)
    records = [_record_from_row(row) for row in csv.DictReader(StringIO(csv_text)) if row.get("Bid Number")]
    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]
