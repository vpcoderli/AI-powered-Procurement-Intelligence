import json
from pathlib import Path

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


def load_state_fixture_opportunities(path, source):
    payload = json.loads(Path(path).read_text())
    records = payload.get("opportunities", payload if isinstance(payload, list) else [])

    return [normalize_state_opportunity(record, source) for record in records]
