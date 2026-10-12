import json
from pathlib import Path

import pytest

from apsi_crawler.data_quality import body_of, core_issues, prepare_persisted_bid

CONTRACT = json.loads((Path(__file__).parent / "fixtures/data_quality_contract.json").read_text())


@pytest.mark.parametrize("case", CONTRACT["cases"], ids=lambda case: case["name"])
def test_shared_publication_quality_contract(case):
    row = {**CONTRACT["base"], **case["override"]}
    assert core_issues(row) == case["coreIssues"]
    assert bool(body_of(row)) == case["bodyValid"]


def test_refresh_preserves_known_optional_source_identity():
    existing = {
        "title": "Road repairs",
        "source_bid_id": "1",
        "dedupe_key": "city:1",
        "jurisdiction_level": "city",
        "fips_code": "1714000",
    }
    incoming = {"title": "Road repairs", **{field: None for field in existing if field != "title"}}

    merged = prepare_persisted_bid(incoming, existing, "2026-10-01T00:00:00Z")

    for field in ("source_bid_id", "dedupe_key", "jurisdiction_level", "fips_code"):
        assert merged[field] == existing[field]
