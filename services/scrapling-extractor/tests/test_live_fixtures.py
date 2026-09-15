"""Extraction against real detail pages captured from the portals (see fixtures/live/README.md).

Each case pins substrings copied from the live page at capture time, so a heuristic or
selector regression against a real portal layout fails here rather than in production.
"""

import json
import pathlib

import pytest

pytest.importorskip("scrapling")

from extractors import SUPPORTED_FIELDS, extract  # noqa: E402

LIVE = pathlib.Path(__file__).parent / "fixtures" / "live"
# One row per captured page. `expect` holds substrings that MUST appear in the extracted
# value (copied from the real page while capturing it); `selectors` are the per-source
# overrides needed where the heuristics alone came back not_found.
CASES = json.loads((LIVE / "expectations.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[case["fixture"] for case in CASES])
def test_live_page_yields_expected_fields(case):
    html = (LIVE / case["fixture"]).read_text(encoding="utf-8")
    result = extract(html, case["url"], list(SUPPORTED_FIELDS), case.get("selectors") or None)
    fields = result["fields"]
    for key, expected_substring in case["expect"].items():
        assert fields[key] is not None, f"{key} not extracted: {result['diagnostics']}"
        assert expected_substring in fields[key], f"{key}={fields[key]!r}"
    assert len(result["attachments"]) >= case["min_attachments"], result["attachments"]
    for attachment in result["attachments"]:
        # javascript: download links stay url=None (resolved crawler-side via the source's
        # attachment_url_template); anything else must already be an absolute http(s) URL.
        assert attachment["url"] is None or attachment["url"].startswith("http")
        assert attachment["raw_href"]


def test_buyspeed_javascript_attachment_links_are_reported_not_faked():
    """IL BidBuy / OregonBuys serve `javascript:downloadFile('N')` links: the extractor must
    surface them (name + raw_href) with url=None instead of inventing a download URL."""
    case = next(c for c in CASES if c["fixture"] == "il_bidbuy_detail.html")
    html = (LIVE / case["fixture"]).read_text(encoding="utf-8")
    result = extract(html, case["url"], ["attachments"], None)
    javascript_links = [a for a in result["attachments"] if a["raw_href"].lower().startswith("javascript:")]
    assert javascript_links, result["attachments"]
    assert all(a["url"] is None for a in javascript_links)
    assert javascript_links[0]["name"].lower().endswith(".pdf")
    assert javascript_links[0]["mime_type"] == "application/pdf"
