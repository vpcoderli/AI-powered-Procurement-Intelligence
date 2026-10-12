import json
from pathlib import Path

import pytest

from apsi_crawler.content_quality import body_issue
from apsi_crawler.detail_backfill import valid_body_text

CONTRACT = json.loads((Path(__file__).parent / "fixtures/description_quality_contract.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CONTRACT["cases"], ids=lambda case: case["name"])
def test_shared_description_contract(case):
    assert body_issue(case["text"], CONTRACT["title"]) == case["issue"]
    assert valid_body_text(case["text"], CONTRACT["title"]) is (case["issue"] is None)
