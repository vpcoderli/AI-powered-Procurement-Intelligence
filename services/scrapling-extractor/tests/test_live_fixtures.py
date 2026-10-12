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


@pytest.mark.parametrize(
    "fixture,title",
    [
        ("il_bidbuy_detail.html", "Changeorder Notice- JP - ISP Temporary Services for ISP Defined Positions IFB - JTR"),
        ("or_oregonbuys_detail.html", "Medical Third-Party Administration Services"),
    ],
)
def test_buyspeed_bulletin_survives_the_crawler_title_echo_gate(monkeypatch, fixture, title):
    monkeypatch.syspath_prepend(str(pathlib.Path(__file__).resolve().parents[3] / "crawler"))
    from apsi_crawler.enrichment import merge_enrichment

    case = next(case for case in CASES if case["fixture"] == fixture)
    result = extract((LIVE / fixture).read_text(encoding="utf-8"), case["url"], ["description"])
    bid = {"title": title, "description": title, "full_description": None}
    assert merge_enrichment(bid, result, None, ["description"]) is True
    assert case["expect"]["description"] in bid["description"]
    assert "description" in bid["raw_payload"]["enrichment"]["applied_fields"]


def test_pa_reimport_keeps_body_and_attachment_urls_stable(monkeypatch):
    monkeypatch.syspath_prepend(str(pathlib.Path(__file__).resolve().parents[3] / "crawler"))
    from apsi_crawler.enrichment import merge_enrichment

    case = next(case for case in CASES if case["fixture"] == "pa_emarketplace_detail.html")
    html = (LIVE / case["fixture"]).read_text(encoding="utf-8")
    fields = ["description", "attachments"]
    result = extract(html, case["url"], fields)
    bid = {"title": "Allegheny OVR Enhanced Driving and Ancillary Services", "description": None, "attachments": []}
    assert merge_enrichment(bid, result, None, fields) is True
    scope = bid["full_description"]
    urls = [item["url"] for item in bid["attachments"]]
    assert len(urls) == 16
    assert all("file=6100066394-1/Solicitation_" in url for url in urls)

    result = extract(html, case["url"], fields)
    assert merge_enrichment(bid, result, None, fields) is False
    assert bid["full_description"] == scope
    assert [item["url"] for item in bid["attachments"]] == urls
