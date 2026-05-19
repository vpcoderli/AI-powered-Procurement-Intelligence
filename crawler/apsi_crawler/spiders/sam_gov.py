import json
from pathlib import Path

from apsi_crawler.normalizers.bids import normalize_sam_gov_opportunity


def load_fixture_opportunities(path):
    payload = json.loads(Path(path).read_text())
    records = payload.get("opportunitiesData", payload if isinstance(payload, list) else [])

    return [normalize_sam_gov_opportunity(record) for record in records]
