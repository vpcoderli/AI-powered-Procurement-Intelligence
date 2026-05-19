import json

import pytest

from apsi_crawler.sources.registry import get_source
from apsi_crawler.sources.registry import (
    UnsupportedLiveSourceError,
    get_live_fetcher,
    supports_live_fetch,
)
from apsi_crawler.spiders.ca_caleprocure import (
    CalEProcureError,
    fetch_ca_caleprocure_opportunities,
)


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append({"url": url, "params": params, "timeout": timeout})
        return self.response


def test_registry_reports_live_support_for_reference_state():
    assert supports_live_fetch("ca_caleprocure") is True
    assert get_live_fetcher("ca_caleprocure") is fetch_ca_caleprocure_opportunities


def test_registry_reports_unsupported_live_state_sources():
    assert supports_live_fetch("tx_esbd") is False

    with pytest.raises(UnsupportedLiveSourceError) as error:
        get_live_fetcher("tx_esbd")

    assert str(error.value) == "Live fetch is not implemented for source: tx_esbd"


def test_fetch_ca_caleprocure_opportunities_normalizes_live_response():
    with open("tests/fixtures/ca_caleprocure_live_response.json") as fixture:
        payload = json.load(fixture)
    session = FakeSession(FakeResponse(payload=payload))

    bids = fetch_ca_caleprocure_opportunities(
        get_source("ca_caleprocure"),
        query="cloud",
        limit=5,
        session=session,
        timeout=10,
    )

    assert session.calls[0]["params"] == {"query": "cloud", "limit": 5}
    assert session.calls[0]["timeout"] == 10
    assert len(bids) == 1
    bid = bids[0]
    assert bid["dedupe_key"] == "ca_caleprocure:CA-LIVE-2026-001"
    assert bid["title"] == "Cloud data warehouse modernization"
    assert bid["issuer_name"] == "Department of Technology"
    assert bid["issuer_type"] == "state"
    assert bid["state_code"] == "CA"
    assert bid["source_url"] == "https://caleprocure.ca.gov/event/CA-LIVE-2026-001"


def test_fetch_ca_caleprocure_opportunities_raises_on_http_error():
    session = FakeSession(FakeResponse(status_code=503, text="maintenance"))

    with pytest.raises(CalEProcureError) as error:
        fetch_ca_caleprocure_opportunities(
            get_source("ca_caleprocure"),
            query="cloud",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "Cal eProcure request failed with status 503: maintenance"
