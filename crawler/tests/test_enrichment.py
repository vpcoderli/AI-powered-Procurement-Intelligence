import pytest

from apsi_crawler.adapters.task import TaskSource
from apsi_crawler.enrichment import (
    ENRICHMENT_FIELDS,
    ExtractorClient,
    ExtractorError,
    detect_off_target_redirect,
    enrich_bids,
    merge_enrichment,
    parse_enrichment_config,
    resolve_attachment_url,
)
from apsi_crawler.html.public_page import HtmlPageError


def _source(**fetch_config):
    return TaskSource(id="il_bidbuy", name="IL", source_label="Illinois BidBuy", jurisdiction="state", state_code="IL", fetch_config=fetch_config)


def _bid(**overrides):
    bid = {
        "id": "il_bidbuy:1", "source_bid_id": "1", "title": "Road Repair", "description": "Road Repair",
        "full_description": None, "original_category": "", "published_date": None,
        "contact_name": None, "contact_email": None, "contact_phone": None,
        "source_url": "https://portal.example.gov/bid/1", "attachments": [],
    }
    bid.update(overrides)
    return bid


class FakeExtractor:
    def __init__(self, result=None, version="0.4.15", error=None):
        self.result = result or {"fields": {}, "attachments": [], "diagnostics": {}}
        self.version = version
        self.error = error
        self.calls = []

    def health(self, timeout=3.0):
        return self.version

    def extract(self, html, url, fields, selectors, timeout=10.0):
        self.calls.append({"html": html, "url": url, "fields": fields, "selectors": selectors})
        if self.error:
            raise self.error
        return self.result


class FakeSession:
    def __init__(self, responses):
        self.responses = dict(responses)
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "timeout": timeout})
        response = self.responses[url]
        if isinstance(response, Exception):
            raise response
        return response


class FakeResponse:
    def __init__(self, text="<html></html>", status_code=200, content_type="text/html", url=None, history=()):
        self.text = text
        self.status_code = status_code
        self.headers = {"Content-Type": content_type}
        # `requests` always exposes the FINAL url plus the redirect chain; url=None here means
        # "no redirect", and fetch_page falls back to the requested url.
        self.url = url
        self.history = list(history)


ENRICHED = {
    "fields": {
        "description": "Full scope text", "full_description": "Full scope text",
        "original_category": "Construction", "contact_name": "Jane", "contact_email": "jane@example.gov",
        "contact_phone": "555-0100", "published_date": "08/14/2026",
    },
    "attachments": [
        {"name": "Spec.pdf", "url": "https://portal.example.gov/docs/spec.pdf", "raw_href": "/docs/spec.pdf", "size_label": None, "mime_type": "application/pdf", "sort_order": 0},
        {"name": "Drawings.zip", "url": None, "raw_href": "javascript:downloadFile('998877')", "size_label": None, "mime_type": "application/zip", "sort_order": 1},
    ],
    "diagnostics": {"description": "heuristic"},
}


def test_parse_config_defaults_to_disabled_with_spec_values():
    config = parse_enrichment_config({"base_url": "https://x"})
    assert config == {
        "enabled": False, "fields": list(ENRICHMENT_FIELDS), "max_details_per_run": 25,
        "min_interval_seconds": 3.0, "timeout_seconds": 20, "detail_selectors": {}, "attachment_url_template": None,
    }


def test_parse_config_reads_and_clamps_values():
    config = parse_enrichment_config({"enrichment": {"enabled": True, "fields": ["description", "bogus"], "max_details_per_run": 999, "min_interval_seconds": -1, "timeout_seconds": 1, "detail_selectors": {"description": "div.x", "bogus": "p"}, "attachment_url_template": "https://x/{id}"}})
    assert config["enabled"] is True
    assert config["fields"] == ["description"]
    assert config["max_details_per_run"] == 200
    assert config["min_interval_seconds"] == 0.0
    assert config["timeout_seconds"] == 5
    assert config["detail_selectors"] == {"description": "div.x"}
    assert config["attachment_url_template"] == "https://x/{id}"


def test_resolve_attachment_url_fills_template_from_first_digit_run():
    template = "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?downloadFileNbr={id}&docId={source_bid_id}&mode=download"
    assert resolve_attachment_url("javascript:downloadFile('998877')", "26-350", template) == (
        "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?downloadFileNbr=998877&docId=26-350&mode=download"
    )
    assert resolve_attachment_url("javascript:void(0)", "26-350", template) is None
    assert resolve_attachment_url("javascript:downloadFile('1')", "26-350", None) is None
    assert resolve_attachment_url("javascript:downloadFile('1')", "26-350", "ftp://bad/{id}") is None


def test_merge_only_fills_empty_values_and_keeps_existing_richer_data():
    bid = _bid(description="Road Repair", original_category="Existing", published_date="01/01/2026")
    changed = merge_enrichment(bid, ENRICHED, None)
    assert changed is True
    assert bid["description"] == "Full scope text"          # was equal to title → filled
    assert bid["full_description"] == "Full scope text"
    assert bid["original_category"] == "Existing"           # non-empty → kept
    assert bid["published_date"] == "01/01/2026"            # non-empty → kept
    assert bid["contact_email"] == "jane@example.gov"
    assert [a["url"] for a in bid["attachments"]] == ["https://portal.example.gov/docs/spec.pdf"]  # javascript link dropped without template
    assert bid["attachments"][0] == {"name": "Spec.pdf", "url": "https://portal.example.gov/docs/spec.pdf", "size_label": None, "mime_type": "application/pdf", "sort_order": 0}
    assert bid["raw_payload"]["enrichment"] == {"fields": {"description": "heuristic"}}


def test_merge_resolves_javascript_attachment_through_template():
    bid = _bid()
    merge_enrichment(bid, ENRICHED, "https://x/download?f={id}&d={source_bid_id}")
    assert [a["url"] for a in bid["attachments"]] == ["https://portal.example.gov/docs/spec.pdf", "https://x/download?f=998877&d=1"]
    assert bid["attachments"][1]["sort_order"] == 1


def test_merge_does_not_replace_existing_attachments():
    bid = _bid(attachments=[{"name": "Old.pdf", "url": "https://x/old.pdf", "size_label": None, "mime_type": None, "sort_order": 0}])
    merge_enrichment(bid, ENRICHED, None)
    assert [a["name"] for a in bid["attachments"]] == ["Old.pdf"]


def test_disabled_config_skips_everything():
    bids = [_bid()]
    out, stats = enrich_bids(bids, _source(), {"base_url": "https://x"}, extractor=FakeExtractor())
    assert out == bids
    assert stats == {"attempted": 0, "enriched": 0, "failed": 0, "skipped": 1, "reason": "disabled", "extractor": None}


def test_missing_extractor_configuration_skips(monkeypatch):
    monkeypatch.delenv("SCRAPLING_EXTRACTOR_URL", raising=False)
    _, stats = enrich_bids([_bid()], _source(enrichment={"enabled": True}), {"enrichment": {"enabled": True}})
    assert stats["reason"] == "extractor_not_configured"
    assert stats["skipped"] == 1


def test_unhealthy_extractor_skips_whole_stage():
    extractor = FakeExtractor(version=None)
    _, stats = enrich_bids([_bid()], _source(), {"enrichment": {"enabled": True}}, extractor=extractor)
    assert stats["reason"] == "extractor_unavailable"
    assert extractor.calls == []


def test_enriches_records_respecting_cap_and_throttle():
    extractor = FakeExtractor(result=ENRICHED)
    session = FakeSession({"https://portal.example.gov/bid/1": FakeResponse("<html>1</html>"), "https://portal.example.gov/bid/2": FakeResponse("<html>2</html>")})
    sleeps = []
    clock = iter([100.0, 100.0, 100.5, 100.5, 104.0, 104.0])
    bids = [_bid(), _bid(id="il_bidbuy:2", source_bid_id="2", source_url="https://portal.example.gov/bid/2"), _bid(id="il_bidbuy:3", source_bid_id="3", source_url="https://portal.example.gov/bid/3")]
    out, stats = enrich_bids(
        bids, _source(), {"enrichment": {"enabled": True, "max_details_per_run": 2, "min_interval_seconds": 3, "timeout_seconds": 7}},
        extractor=extractor, session=session, sleep=sleeps.append, now=lambda: "2026-09-15T00:00:00+00:00", monotonic=lambda: next(clock),
    )
    assert stats["attempted"] == 2 and stats["enriched"] == 2 and stats["skipped"] == 1 and stats["failed"] == 0
    assert stats["extractor"] == "0.4.15"
    assert out[0]["description"] == "Full scope text" and out[1]["description"] == "Full scope text"
    assert out[2]["description"] == "Road Repair"
    assert out[0]["detail_fetched_at"] == "2026-09-15T00:00:00+00:00"
    assert session.calls[0]["timeout"] == 7 and "Mozilla/5.0" in session.calls[0]["headers"]["User-Agent"]
    assert extractor.calls[0]["fields"] == list(ENRICHMENT_FIELDS) and extractor.calls[0]["url"] == "https://portal.example.gov/bid/1"
    assert sleeps == [2.5]  # second request came 0.5s after the first → wait the remaining 2.5s


def test_detail_fetch_failure_counts_failed_and_continues():
    extractor = FakeExtractor(result=ENRICHED)
    session = FakeSession({"https://portal.example.gov/bid/1": HtmlPageError("HTML request failed with status 403: nope"), "https://portal.example.gov/bid/2": FakeResponse("<html>2</html>")})
    bids = [_bid(), _bid(id="il_bidbuy:2", source_bid_id="2", source_url="https://portal.example.gov/bid/2")]
    out, stats = enrich_bids(bids, _source(), {"enrichment": {"enabled": True, "min_interval_seconds": 0}}, extractor=extractor, session=session, sleep=lambda s: None)
    assert stats["failed"] == 1 and stats["enriched"] == 1
    assert out[0]["description"] == "Road Repair" and out[1]["description"] == "Full scope text"


def test_extractor_error_counts_failed_never_raises():
    extractor = FakeExtractor(error=ExtractorError("boom"))
    session = FakeSession({"https://portal.example.gov/bid/1": FakeResponse()})
    _, stats = enrich_bids([_bid()], _source(), {"enrichment": {"enabled": True, "min_interval_seconds": 0}}, extractor=extractor, session=session, sleep=lambda s: None)
    assert stats == {"attempted": 1, "enriched": 0, "failed": 1, "skipped": 0, "reason": None, "extractor": "0.4.15"}


def test_failed_record_emits_diagnostic_line_to_stderr_not_stdout(capsys):
    extractor = FakeExtractor(error=ExtractorError("boom"))
    session = FakeSession({"https://portal.example.gov/bid/1": FakeResponse()})
    source = _source()
    enrich_bids([_bid()], source, {"enrichment": {"enabled": True, "min_interval_seconds": 0}}, extractor=extractor, session=session, sleep=lambda s: None)
    captured = capsys.readouterr()
    assert captured.out == ""
    assert source.id in captured.err
    assert "https://portal.example.gov/bid/1" in captured.err
    assert "ExtractorError: boom" in captured.err


def test_records_without_detail_url_are_skipped():
    extractor = FakeExtractor(result=ENRICHED)
    _, stats = enrich_bids([_bid(source_url=""), _bid(source_url="https://portal.example.gov/list")], _source(base_url="https://portal.example.gov/list"), {"base_url": "https://portal.example.gov/list", "enrichment": {"enabled": True}}, extractor=extractor, session=FakeSession({}), sleep=lambda s: None)
    assert stats["skipped"] == 2 and stats["attempted"] == 0


def test_records_already_complete_for_requested_fields_are_skipped():
    extractor = FakeExtractor(result=ENRICHED)
    complete = _bid(description="Real scope text", original_category="Construction", attachments=[{"name": "A.pdf", "url": "https://x/a.pdf", "size_label": None, "mime_type": None, "sort_order": 0}])
    _, stats = enrich_bids([complete], _source(), {"enrichment": {"enabled": True, "fields": ["description", "attachments", "category"]}}, extractor=extractor, session=FakeSession({}), sleep=lambda s: None)
    assert stats == {"attempted": 0, "enriched": 0, "failed": 0, "skipped": 1, "reason": None, "extractor": "0.4.15"}
    assert extractor.calls == []


def test_detect_off_target_redirect_covers_host_login_and_dropped_id():
    detail = "https://www.nyscr.ny.gov/Ads/Details/2139024"
    # (1) host changed
    assert detect_off_target_redirect(detail, "https://sso.example.com/Ads/Details/2139024", True)
    # (2) login marker appeared in the final path
    assert detect_off_target_redirect(detail, "https://www.nyscr.ny.gov/Account/Login?ReturnUrl=%2FAds%2FDetails%2F2139024", True)
    assert detect_off_target_redirect(detail, "https://www.nyscr.ny.gov/SignIn", True)
    # (3) redirected away from the requested ad id
    assert detect_off_target_redirect(detail, "https://www.nyscr.ny.gov/Ads/Search", True)
    # on-target answers stay on target
    assert detect_off_target_redirect(detail, detail, False) is None
    assert detect_off_target_redirect(detail, detail + "/", True) is None
    assert detect_off_target_redirect(detail, "https://www.nyscr.ny.gov/Ads/Details/2139024?tab=docs", True) is None
    # a source whose own detail path is under /auth is not mistaken for a login bounce
    assert detect_off_target_redirect("https://x.gov/auth/bid/7", "https://x.gov/auth/bid/7", False) is None


def test_redirect_to_login_page_counts_failed_without_calling_extractor(capsys):
    extractor = FakeExtractor(result=ENRICHED)
    detail_url = "https://www.nyscr.ny.gov/Ads/Details/2139024"
    session = FakeSession(
        {
            detail_url: FakeResponse(
                "<html>New York State Contract Reporter Find Bids Advertise Bids Business Registry</html>",
                url="https://www.nyscr.ny.gov/Account/Login?ReturnUrl=%2FAds%2FDetails%2F2139024",
                history=[FakeResponse(status_code=302)],
            )
        }
    )
    bid = _bid(source_url=detail_url)
    out, stats = enrich_bids([bid], _source(), {"enrichment": {"enabled": True, "min_interval_seconds": 0}}, extractor=extractor, session=session, sleep=lambda s: None)
    assert stats == {"attempted": 1, "enriched": 0, "failed": 1, "skipped": 0, "reason": None, "extractor": "0.4.15"}
    assert extractor.calls == []                       # the login page never reaches the extractor
    assert out[0]["description"] == "Road Repair"      # and nothing is merged
    assert "detail_fetched_at" not in out[0]
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "RedirectedOffTarget: final url https://www.nyscr.ny.gov/Account/Login" in captured.err


def test_redirect_to_another_host_counts_failed():
    extractor = FakeExtractor(result=ENRICHED)
    session = FakeSession(
        {
            "https://portal.example.gov/bid/1": FakeResponse(
                "<html>elsewhere</html>", url="https://cdn.example.com/bid/1", history=[FakeResponse(status_code=302)]
            )
        }
    )
    _, stats = enrich_bids([_bid()], _source(), {"enrichment": {"enabled": True, "min_interval_seconds": 0}}, extractor=extractor, session=session, sleep=lambda s: None)
    assert stats["failed"] == 1 and stats["enriched"] == 0 and extractor.calls == []


def test_redirect_dropping_the_requested_id_counts_failed():
    extractor = FakeExtractor(result=ENRICHED)
    session = FakeSession(
        {
            "https://portal.example.gov/bid/1": FakeResponse(
                "<html>search</html>", url="https://portal.example.gov/bids/search", history=[FakeResponse(status_code=302)]
            )
        }
    )
    _, stats = enrich_bids([_bid()], _source(), {"enrichment": {"enabled": True, "min_interval_seconds": 0}}, extractor=extractor, session=session, sleep=lambda s: None)
    assert stats["failed"] == 1 and stats["enriched"] == 0 and extractor.calls == []


def test_benign_redirect_that_keeps_the_detail_path_still_enriches():
    extractor = FakeExtractor(result=ENRICHED)
    session = FakeSession(
        {
            "https://portal.example.gov/bid/1": FakeResponse(
                "<html>1</html>", url="https://portal.example.gov/bid/1/", history=[FakeResponse(status_code=301)]
            )
        }
    )
    out, stats = enrich_bids([_bid()], _source(), {"enrichment": {"enabled": True, "min_interval_seconds": 0}}, extractor=extractor, session=session, sleep=lambda s: None)
    assert stats["enriched"] == 1 and stats["failed"] == 0
    assert out[0]["description"] == "Full scope text"


def test_extractor_success_that_writes_nothing_counts_skipped_not_enriched():
    # CA shape: the extractor answered, but every value it returned is already present, so
    # merge_enrichment writes nothing. That is a skip, not an enrichment.
    extractor = FakeExtractor(
        result={
            "fields": {"description": "Real scope text", "full_description": "Real scope text", "original_category": "Construction"},
            "attachments": [],
            "diagnostics": {"description": "selector", "contact": "not_found", "published_date": "not_found"},
        }
    )
    session = FakeSession({"https://portal.example.gov/bid/1": FakeResponse("<html>1</html>")})
    bid = _bid(
        description="Real scope text", full_description="Real scope text", original_category="Construction",
        attachments=[{"name": "A.pdf", "url": "https://x/a.pdf", "size_label": None, "mime_type": None, "sort_order": 0}],
    )
    out, stats = enrich_bids(
        [bid], _source(), {"enrichment": {"enabled": True, "min_interval_seconds": 0}},
        extractor=extractor, session=session, sleep=lambda s: None, now=lambda: "2026-09-15T00:00:00+00:00",
    )
    assert stats == {"attempted": 1, "enriched": 0, "failed": 0, "skipped": 1, "reason": None, "extractor": "0.4.15"}
    assert extractor.calls != []                       # the extractor really ran (not the pre-fetch skip path)
    assert out[0]["detail_fetched_at"] == "2026-09-15T00:00:00+00:00"   # the page was fetched
    assert out[0]["raw_payload"]["enrichment"] == {"fields": {"description": "selector", "contact": "not_found", "published_date": "not_found"}}


def test_extractor_client_posts_json_and_maps_errors():
    class PostSession:
        def __init__(self, status=200, payload=None):
            self.status = status
            self.payload = payload or {"fields": {}, "attachments": [], "diagnostics": {}}
            self.calls = []

        def post(self, url, json=None, timeout=None):
            self.calls.append({"url": url, "json": json, "timeout": timeout})
            return FakeJsonResponse(self.status, self.payload)

        def get(self, url, timeout=None):
            return FakeJsonResponse(200, {"ok": True, "scrapling": "0.4.15"})

    class FakeJsonResponse:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self._payload = payload

        def json(self):
            return self._payload

    session = PostSession()
    client = ExtractorClient("http://localhost:8091/", session=session)
    assert client.health() == "0.4.15"
    client.extract("<p/>", "https://x/1", ["description"], {"description": "p"})
    assert session.calls[0]["url"] == "http://localhost:8091/extract"
    assert session.calls[0]["json"] == {"html": "<p/>", "url": "https://x/1", "fields": ["description"], "selectors": {"description": "p"}}
    with pytest.raises(ExtractorError):
        ExtractorClient("http://localhost:8091", session=PostSession(status=500, payload={"error": {"code": "EXTRACT_FAILED", "message": "x"}})).extract("<p/>", "https://x/1", ["description"], None)


def test_requests_re_quoting_the_url_is_not_treated_as_an_off_target_redirect():
    detail = "https://x.gov/bid/RFP 26-101"
    quoted = "https://x.gov/bid/RFP%2026-101"
    # No redirect ran: `requests` merely percent-encoded the space while preparing the request.
    assert detect_off_target_redirect(detail, quoted, False) is None
    # And a real redirect that keeps the id is still on target once both paths are unquoted.
    assert detect_off_target_redirect(detail, quoted, True) is None


def test_login_markers_match_whole_path_segments_only():
    # `/authority/...` merely CONTAINS "/auth"; it is not a login bounce.
    assert detect_off_target_redirect("https://x.gov/bid/7", "https://x.gov/authority/bid/7", True) is None
    assert detect_off_target_redirect("https://x.gov/bid/7", "https://x.gov/loginpage/7", True) is None
    # the real markers still fire, including the two-segment /account/login
    assert detect_off_target_redirect("https://x.gov/bid/7", "https://x.gov/auth/bid/7", True) == "login page"
    assert detect_off_target_redirect("https://x.gov/bid/7", "https://x.gov/account/login", True) == "login page"
    assert detect_off_target_redirect("https://x.gov/bid/7", "https://x.gov/sign-in", True) == "login page"


def test_space_in_the_detail_path_still_enriches_end_to_end():
    extractor = FakeExtractor(result=ENRICHED)
    detail_url = "https://portal.example.gov/bid/RFP 26-101"
    session = FakeSession(
        # requests answers with the percent-encoded URL and an EMPTY history: no redirect ran.
        {detail_url: FakeResponse("<html>bid</html>", url="https://portal.example.gov/bid/RFP%2026-101")}
    )
    out, stats = enrich_bids(
        [_bid(source_url=detail_url)], _source(), {"enrichment": {"enabled": True, "min_interval_seconds": 0}},
        extractor=extractor, session=session, sleep=lambda s: None,
    )
    assert stats["enriched"] == 1 and stats["failed"] == 0
    assert out[0]["description"] == "Full scope text"
    assert len(extractor.calls) == 1


def test_real_redirect_keeping_a_quoted_id_still_enriches():
    extractor = FakeExtractor(result=ENRICHED)
    detail_url = "https://portal.example.gov/bid/RFP 26-101"
    session = FakeSession(
        {
            detail_url: FakeResponse(
                "<html>bid</html>",
                url="https://portal.example.gov/bid/RFP%2026-101?tab=docs",
                history=[FakeResponse(status_code=301)],
            )
        }
    )
    _, stats = enrich_bids(
        [_bid(source_url=detail_url)], _source(), {"enrichment": {"enabled": True, "min_interval_seconds": 0}},
        extractor=extractor, session=session, sleep=lambda s: None,
    )
    assert stats["enriched"] == 1 and stats["failed"] == 0
