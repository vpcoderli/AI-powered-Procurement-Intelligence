import json
from pathlib import Path

import pytest
import requests

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
from apsi_crawler.spiders.tx_esbd import fetch_tx_esbd_opportunities


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
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_registry_reports_live_support_for_reference_state():
    assert supports_live_fetch("ca_caleprocure") is True
    assert get_live_fetcher("ca_caleprocure") is fetch_ca_caleprocure_opportunities


def test_registry_reports_live_support_for_texas_esbd():
    assert supports_live_fetch("tx_esbd") is True
    assert get_live_fetcher("tx_esbd") is fetch_tx_esbd_opportunities


def test_registry_reports_unsupported_live_state_sources():
    assert supports_live_fetch("ny_contract_reporter") is False

    with pytest.raises(UnsupportedLiveSourceError) as error:
        get_live_fetcher("ny_contract_reporter")

    assert (
        str(error.value)
        == "Live fetch is not implemented for source: ny_contract_reporter"
    )


def test_fetch_ca_caleprocure_opportunities_normalizes_live_response():
    fixture_path = FIXTURES_DIR / "ca_caleprocure_live_response.json"
    with fixture_path.open() as fixture:
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


def test_fetch_ca_caleprocure_opportunities_raises_on_unexpected_payload_shape():
    session = FakeSession(FakeResponse(payload={"error": "changed"}))

    with pytest.raises(CalEProcureError) as error:
        fetch_ca_caleprocure_opportunities(
            get_source("ca_caleprocure"),
            query="cloud",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == (
        "Cal eProcure response did not contain opportunities or results"
    )


def test_fetch_ca_caleprocure_opportunities_raises_when_record_missing_source_id():
    session = FakeSession(FakeResponse(payload={"opportunities": [{"title": "Cloud"}]}))

    with pytest.raises(CalEProcureError) as error:
        fetch_ca_caleprocure_opportunities(
            get_source("ca_caleprocure"),
            query="cloud",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "Cal eProcure record is missing source id"


def test_fetch_ca_caleprocure_opportunities_preserves_normalized_aliases():
    session = FakeSession(
        FakeResponse(
            payload=[
                {
                    "source_bid_id": "CA-NORMALIZED-001",
                    "title": "Normalized cloud services",
                    "source_url": "https://caleprocure.ca.gov/event/CA-NORMALIZED-001",
                    "published_date": "2026-05-18",
                    "deadline_date": "2026-06-10",
                    "issuer_name": "Department of General Services",
                }
            ]
        )
    )

    bids = fetch_ca_caleprocure_opportunities(
        get_source("ca_caleprocure"),
        query="cloud",
        limit=5,
        session=session,
        timeout=10,
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "CA-NORMALIZED-001"
    assert bid["dedupe_key"] == "ca_caleprocure:CA-NORMALIZED-001"
    assert bid["source_url"] == "https://caleprocure.ca.gov/event/CA-NORMALIZED-001"
    assert bid["published_date"] == "2026-05-18"
    assert bid["deadline_date"] == "2026-06-10"
    assert bid["issuer_name"] == "Department of General Services"


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


def test_fetch_ca_caleprocure_opportunities_wraps_request_errors():
    session = FakeSession(requests.Timeout("slow"))

    with pytest.raises(CalEProcureError) as error:
        fetch_ca_caleprocure_opportunities(
            get_source("ca_caleprocure"),
            query="cloud",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "Cal eProcure request failed: slow"
