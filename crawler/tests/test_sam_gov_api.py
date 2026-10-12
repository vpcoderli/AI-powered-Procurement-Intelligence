import json

import pytest
import requests

from apsi_crawler.spiders.sam_gov_api import SamGovApiError, fetch_sam_gov_opportunities


RAW_OPPORTUNITY = {
    "noticeId": "abc-123",
    "title": "Cloud analytics platform",
    "solicitationNumber": "RFQ-123",
    "description": "Build a cloud analytics platform.",
    "type": "Solicitation",
    "postedDate": "2026-05-01",
    "responseDeadLine": "2026-06-01",
    "organizationName": "Department of Health",
    "uiLink": "https://sam.gov/opp/abc-123/view",
}


class FakeResponse:
    def __init__(self, status_code, payload, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        return self._payload

    def iter_content(self, chunk_size):
        yield (self.text or json.dumps(self._payload)).encode()

    def close(self):
        pass


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, params, timeout, **kwargs):
        self.calls.append({"url": url, "params": params, "timeout": timeout, **kwargs})
        return self.responses.pop(0)


def test_fetch_sam_gov_opportunities_uses_documented_parameters():
    session = FakeSession(
        [FakeResponse(200, {"totalRecords": 1, "opportunitiesData": [RAW_OPPORTUNITY]})]
    )

    bids = fetch_sam_gov_opportunities(
        api_key="secret",
        posted_from="05/01/2026",
        posted_to="05/19/2026",
        limit=100,
        max_records=100,
        session=session,
    )

    assert len(bids) == 1
    assert bids[0]["id"] == "sam_gov:abc-123"
    assert session.calls == [
        {
            "url": "https://api.sam.gov/opportunities/v2/search",
            "params": {
                "api_key": "secret",
                "postedFrom": "05/01/2026",
                "postedTo": "05/19/2026",
                "limit": 100,
                "offset": 0,
            },
            "timeout": 30,
            "allow_redirects": False,
        }
    ]


def test_fetch_sam_gov_opportunities_paginates_until_max_records():
    second_record = {**RAW_OPPORTUNITY, "noticeId": "def-456", "title": "Security assessment"}
    session = FakeSession(
        [
            FakeResponse(200, {"totalRecords": 3, "opportunitiesData": [RAW_OPPORTUNITY]}),
            FakeResponse(200, {"totalRecords": 3, "opportunitiesData": [second_record]}),
        ]
    )

    bids = fetch_sam_gov_opportunities(
        api_key="secret",
        posted_from="05/01/2026",
        posted_to="05/19/2026",
        limit=1,
        max_records=2,
        session=session,
    )

    assert [bid["id"] for bid in bids] == ["sam_gov:abc-123", "sam_gov:def-456"]
    assert [call["params"]["offset"] for call in session.calls] == [0, 1]


def test_fetch_sam_gov_opportunities_rejects_missing_api_key():
    with pytest.raises(SamGovApiError, match="API key is required"):
        fetch_sam_gov_opportunities(
            api_key="",
            posted_from="05/01/2026",
            posted_to="05/19/2026",
        )


def test_fetch_sam_gov_opportunities_raises_for_failed_response():
    session = FakeSession([FakeResponse(400, {"error": "Bad request"}, text="Bad request")])

    with pytest.raises(SamGovApiError, match="SAM.gov request failed with status 400"):
        fetch_sam_gov_opportunities(
            api_key="secret",
            posted_from="05/01/2026",
            posted_to="05/19/2026",
            session=session,
        )


DESCRIPTION_URL = "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=abc-123"


def fetch_with(session):
    return fetch_sam_gov_opportunities(
        api_key="secret", posted_from="05/01/2026", posted_to="05/19/2026", session=session,
    )


def test_fetches_notice_description_instead_of_persisting_its_url():
    record = {**RAW_OPPORTUNITY, "description": DESCRIPTION_URL}
    session = FakeSession([
        FakeResponse(200, {"totalRecords": 1, "opportunitiesData": [record]}),
        FakeResponse(200, {"description": "<p>Provide cloud &amp; data services.</p><script>noise</script><p>Include training.</p>"}),
    ])
    bid = fetch_with(session)[0]
    assert bid["full_description"] == "Provide cloud & data services.\nInclude training."
    assert bid["description"] == bid["full_description"]
    assert bid["detail_fetched_at"]
    assert bid["raw_payload"]["description"] == DESCRIPTION_URL
    assert bid["raw_payload"]["enrichment"]["applied_fields"] == ["description", "full_description"]
    assert session.calls[1] == {
        "url": DESCRIPTION_URL, "params": {"api_key": "secret"}, "timeout": 30,
        "allow_redirects": False, "stream": True,
    }
    assert "secret" not in json.dumps(bid)


@pytest.mark.parametrize("url", [
    "https://untrusted.example/noticedesc?noticeid=abc-123",
    "http://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=abc-123",
    "https://api.sam.gov@untrusted.example/prod/opportunities/v1/noticedesc?noticeid=abc-123",
    "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=other",
])
def test_never_sends_the_api_key_to_an_untrusted_or_wrong_notice_description(url):
    session = FakeSession([FakeResponse(200, {"totalRecords": 1, "opportunitiesData": [{**RAW_OPPORTUNITY, "description": url}]})])
    bid = fetch_with(session)[0]
    assert len(session.calls) == 1
    assert not bid["full_description"]
    assert "description_fetch_failed" in bid["quality_flags_json"]


@pytest.mark.parametrize("response", [
    FakeResponse(404, {"message": "Description not found"}),
    FakeResponse(302, None, "Redirecting"),
    FakeResponse(200, {"description": "Description not found"}),
    FakeResponse(200, {"error": "Invalid API key secret"}),
])
def test_description_failure_preserves_the_opportunity_without_error_copy_or_a_url_body(response):
    session = FakeSession([
        FakeResponse(200, {"totalRecords": 1, "opportunitiesData": [{**RAW_OPPORTUNITY, "description": DESCRIPTION_URL}]}),
        response,
    ])
    bid = fetch_with(session)[0]
    assert bid["id"] == "sam_gov:abc-123"
    assert not bid["full_description"]
    assert bid["detail_fetched_at"] is None
    assert "description_fetch_failed" in bid["quality_flags_json"]
    assert "secret" not in json.dumps(bid)


def test_a_description_rate_limit_stops_further_detail_requests():
    records = [
        {**RAW_OPPORTUNITY, "description": DESCRIPTION_URL},
        {**RAW_OPPORTUNITY, "noticeId": "def-456", "description": DESCRIPTION_URL.replace("abc-123", "def-456")},
    ]
    session = FakeSession([
        FakeResponse(200, {"totalRecords": 2, "opportunitiesData": records}),
        FakeResponse(429, {"message": "Rate limit"}),
    ])
    bids = fetch_with(session)
    assert len(bids) == 2
    assert len(session.calls) == 2
    assert all(not bid["full_description"] for bid in bids)
    assert all("description_fetch_failed" in bid["quality_flags_json"] for bid in bids)


def test_uses_page_indexes_for_multi_record_search_pages():
    records = [{**RAW_OPPORTUNITY, "noticeId": f"notice-{index}"} for index in range(4)]
    session = FakeSession([
        FakeResponse(200, {"totalRecords": 4, "opportunitiesData": records[:2]}),
        FakeResponse(200, {"totalRecords": 4, "opportunitiesData": records[2:]}),
    ])
    assert len(fetch_sam_gov_opportunities("secret", "05/01/2026", "05/19/2026", limit=2, session=session)) == 4
    assert [call["params"]["offset"] for call in session.calls] == [0, 1]


def test_description_requests_observe_the_start_interval(monkeypatch):
    from apsi_crawler.spiders import sam_gov_api
    waits = []
    monkeypatch.setattr(sam_gov_api, "monotonic", lambda: 10)
    monkeypatch.setattr(sam_gov_api, "sleep", waits.append)
    records = [
        {**RAW_OPPORTUNITY, "description": DESCRIPTION_URL},
        {**RAW_OPPORTUNITY, "noticeId": "def-456", "description": DESCRIPTION_URL.replace("abc-123", "def-456")},
    ]
    session = FakeSession([
        FakeResponse(200, {"totalRecords": 2, "opportunitiesData": records}),
        FakeResponse(200, {"description": "Cloud services scope."}),
        FakeResponse(200, {"description": "Security services scope."}),
    ])
    assert len(fetch_with(session)) == 2
    assert waits == [3]


def test_rejects_an_oversized_description():
    from apsi_crawler.spiders.sam_gov_api import MAX_DESCRIPTION_BYTES
    session = FakeSession([
        FakeResponse(200, {"totalRecords": 1, "opportunitiesData": [{**RAW_OPPORTUNITY, "description": DESCRIPTION_URL}]}),
        FakeResponse(200, None, "x" * (MAX_DESCRIPTION_BYTES + 1)),
    ])
    bid = fetch_with(session)[0]
    assert not bid["full_description"]
    assert bid["raw_payload"]["enrichment"]["fields"]["description"] == "response_too_large"


def test_bad_description_url_does_not_abort_the_list():
    session = FakeSession([FakeResponse(200, {"totalRecords": 1, "opportunitiesData": [{**RAW_OPPORTUNITY, "description": "https://[bad-ip]/noticedesc"}]})])
    bid = fetch_with(session)[0]
    assert not bid["full_description"]
    assert "description_fetch_failed" in bid["quality_flags_json"]


def test_login_html_is_not_a_sam_description():
    session = FakeSession([
        FakeResponse(200, {"totalRecords": 1, "opportunitiesData": [{**RAW_OPPORTUNITY, "description": DESCRIPTION_URL}]}),
        FakeResponse(200, None, '<h1>Sign in</h1><form action="/login"><input type="password">Please log in</form>'),
    ])
    assert not fetch_with(session)[0]["full_description"]


def test_long_notice_body_has_a_bounded_summary_and_full_body():
    session = FakeSession([
        FakeResponse(200, {"totalRecords": 1, "opportunitiesData": [{**RAW_OPPORTUNITY, "description": DESCRIPTION_URL}]}),
        FakeResponse(200, {"description": "Detailed cloud service requirements. " * 1000}),
    ])
    bid = fetch_with(session)[0]
    assert len(bid["description"]) == 500
    assert len(bid["full_description"]) == 20000


def test_search_errors_never_expose_the_api_key():
    class FailingSession:
        def get(self, *args, **kwargs):
            raise requests.ConnectionError("Failed: https://api.sam.gov/search?api_key=secret")

    with pytest.raises(SamGovApiError) as caught:
        fetch_with(FailingSession())
    assert "secret" not in str(caught.value)
    assert caught.value.__suppress_context__


def test_search_error_body_never_enters_the_error_log():
    with pytest.raises(SamGovApiError) as caught:
        fetch_with(FakeSession([FakeResponse(403, {}, "Invalid api_key secret")]))
    assert "secret" not in str(caught.value)


def test_description_budget_preserves_all_list_rows(monkeypatch):
    from apsi_crawler.spiders import sam_gov_api
    monkeypatch.setattr(sam_gov_api, "sleep", lambda _: None)
    records = [{**RAW_OPPORTUNITY, "noticeId": str(index), "description": DESCRIPTION_URL.replace("abc-123", str(index))} for index in range(27)]
    session = FakeSession([
        FakeResponse(200, {"totalRecords": 27, "opportunitiesData": records}),
        *[FakeResponse(200, {"description": "Procurement scope."}) for _ in range(25)],
    ])
    bids = fetch_with(session)
    assert len(bids) == 27
    assert len(session.calls) == 26
    assert all(bid["full_description"] for bid in bids[:25])
    assert all("description_not_fetched" in bid["quality_flags_json"] for bid in bids[25:])


def test_can_disable_description_requests_explicitly():
    session = FakeSession([FakeResponse(200, {"totalRecords": 1, "opportunitiesData": [{**RAW_OPPORTUNITY, "description": DESCRIPTION_URL}]})])
    bids = fetch_sam_gov_opportunities("secret", "05/01/2026", "05/19/2026", session=session, max_descriptions=0)
    assert len(bids) == 1
    assert len(session.calls) == 1
    assert "description_not_fetched" in bids[0]["quality_flags_json"]


def test_sam_details_use_persisted_history_to_avoid_retry_starvation():
    first = {**RAW_OPPORTUNITY, "description": DESCRIPTION_URL}
    second = {**RAW_OPPORTUNITY, "noticeId": "def-456", "description": DESCRIPTION_URL.replace("abc-123", "def-456")}
    history = [{"id": "sam_gov:abc-123", "source_bid_id": "abc-123", "dedupe_key": "sam_gov:abc-123", "issuer_name": "Department of Health", "issuer_type": "federal", "state_code": "US", "title": RAW_OPPORTUNITY["title"], "source_url": RAW_OPPORTUNITY["uiLink"], "raw_payload": {"enrichment": {"outcome": {"attempt_count": 1, "attempted_at": "2026-10-01T00:00:00+00:00", "next_retry_at": "2026-10-01T01:00:00+00:00"}}}}]
    session = FakeSession([FakeResponse(200, {"totalRecords": 2, "opportunitiesData": [first, second]}), FakeResponse(200, {"description": "Provide hardware, software, support, migration planning, staff training, installation, and ongoing technical maintenance for all departmental offices during the coming fiscal year. Include deployment milestones and service response requirements."})])
    bids = fetch_sam_gov_opportunities("secret", "05/01/2026", "05/19/2026", max_descriptions=1, session=session, detail_history=history, now=lambda: "2026-10-01T00:05:00+00:00")
    assert session.calls[1]["url"] == second["description"]
    assert bids[0]["raw_payload"]["enrichment"]["outcome"]["status"] == "deferred"
    assert bids[1]["raw_payload"]["enrichment"]["outcome"]["valid_body"] is True


def test_one_malformed_sam_candidate_does_not_abort_valid_records(monkeypatch):
    from apsi_crawler.spiders import sam_gov_api
    normalize = sam_gov_api.normalize_sam_gov_opportunity
    def checked(record):
        if not record.get("noticeId"):
            raise ValueError("SAM opportunity is missing noticeId")
        return normalize(record)
    monkeypatch.setattr(sam_gov_api, "normalize_sam_gov_opportunity", checked)
    session = FakeSession([FakeResponse(200, {"totalRecords": 2, "opportunitiesData": [{"title": "Malformed row"}, RAW_OPPORTUNITY]})])
    rows = fetch_with(session)
    assert len(rows) == 2
    assert rows[0]["raw_payload"]["normalization_error"] == "ValueError"
    assert not rows[0].get("id")
    assert rows[1]["id"] == "sam_gov:abc-123"


def test_sam_history_retry_records_missing_key_without_contacting_the_api():
    from apsi_crawler.spiders.sam_gov_api import enrich_sam_gov_bids
    row = {"id": "sam_gov:abc-123", "source_bid_id": "abc-123", "title": "Cloud analytics platform", "description": "", "raw_payload": {"description": DESCRIPTION_URL}}
    bids = enrich_sam_gov_bids([row], "", session=FakeSession([]), now=lambda: "2026-10-01T00:00:00Z")
    assert bids[0]["raw_payload"]["enrichment"]["outcome"]["status"] == "not_configured"
    assert bids[0]["raw_payload"]["enrichment"]["outcome"]["reason"] == "sam_api_key_not_configured"
