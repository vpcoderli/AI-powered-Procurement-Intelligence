import pytest

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


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, params, timeout):
        self.calls.append({"url": url, "params": params, "timeout": timeout})
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
