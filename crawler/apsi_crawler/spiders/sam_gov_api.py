import requests

from apsi_crawler.normalizers.bids import normalize_sam_gov_opportunity


SAM_GOV_OPPORTUNITIES_URL = "https://api.sam.gov/opportunities/v2/search"


class SamGovApiError(Exception):
    """Raised when the SAM.gov opportunities API cannot be fetched."""


def _page_limit(limit):
    return max(1, min(int(limit), 1000))


def fetch_sam_gov_opportunities(
    api_key,
    posted_from,
    posted_to,
    limit=100,
    max_records=None,
    session=None,
    timeout=30,
):
    if not api_key:
        raise SamGovApiError("SAM.gov API key is required")
    if not posted_from or not posted_to:
        raise SamGovApiError("posted_from and posted_to are required")

    client = session or requests.Session()
    page_size = _page_limit(limit)
    target_count = int(max_records) if max_records is not None else None
    offset = 0
    bids = []

    while True:
        params = {
            "api_key": api_key,
            "postedFrom": posted_from,
            "postedTo": posted_to,
            "limit": page_size,
            "offset": offset,
        }
        response = client.get(SAM_GOV_OPPORTUNITIES_URL, params=params, timeout=timeout)

        if response.status_code != 200:
            raise SamGovApiError(
                f"SAM.gov request failed with status {response.status_code}: {response.text}"
            )

        payload = response.json()
        records = payload.get("opportunitiesData", [])
        total_records = int(payload.get("totalRecords", len(records)) or 0)

        for record in records:
            if target_count is not None and len(bids) >= target_count:
                return bids
            bids.append(normalize_sam_gov_opportunity(record))

        if not records:
            return bids
        if target_count is not None and len(bids) >= target_count:
            return bids

        offset += page_size
        if offset >= total_records:
            return bids
