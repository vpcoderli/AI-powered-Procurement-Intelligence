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
from apsi_crawler.spiders.tx_esbd import (
    TxEsbdError,
    fetch_tx_esbd_opportunities,
)


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text="", json_error=None):
        self.status_code = status_code
        self._payload = payload
        self.text = text
        self._json_error = json_error

    def json(self):
        if self._json_error:
            raise self._json_error
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


def test_fetch_tx_esbd_opportunities_normalizes_live_response():
    fixture_path = FIXTURES_DIR / "tx_esbd_live_response.json"
    with fixture_path.open() as fixture:
        payload = json.load(fixture)
    session = FakeSession(FakeResponse(payload=payload))

    bids = fetch_tx_esbd_opportunities(
        get_source("tx_esbd"),
        query="data",
        limit=5,
        session=session,
        timeout=10,
    )

    assert session.calls[0]["url"] == "https://www.txsmartbuy.gov/esbd"
    assert session.calls[0]["params"] == {"query": "data", "limit": 5}
    assert session.calls[0]["timeout"] == 10
    assert len(bids) == 1
    bid = bids[0]
    assert bid["dedupe_key"] == "tx_esbd:ESBD-LIVE-2026-77"
    assert bid["title"] == "Statewide data catalog services"
    assert bid["issuer_name"] == "Texas Department of Information Resources"
    assert bid["issuer_type"] == "state"
    assert bid["state_code"] == "TX"
    assert bid["source_url"] == "https://www.txsmartbuy.gov/esbd/ESBD-LIVE-2026-77"


def test_fetch_tx_esbd_opportunities_raises_on_unexpected_payload_shape():
    session = FakeSession(FakeResponse(payload={"error": "changed"}))

    with pytest.raises(TxEsbdError) as error:
        fetch_tx_esbd_opportunities(
            get_source("tx_esbd"),
            query="data",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == (
        "Texas ESBD response did not contain opportunities or results"
    )


def test_fetch_tx_esbd_opportunities_raises_when_record_missing_source_id():
    session = FakeSession(FakeResponse(payload={"opportunities": [{"title": "Data"}]}))

    with pytest.raises(TxEsbdError) as error:
        fetch_tx_esbd_opportunities(
            get_source("tx_esbd"),
            query="data",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "Texas ESBD record is missing source id"


def test_fetch_tx_esbd_opportunities_raises_when_record_is_not_object():
    session = FakeSession(FakeResponse(payload={"opportunities": [None]}))

    with pytest.raises(TxEsbdError) as error:
        fetch_tx_esbd_opportunities(
            get_source("tx_esbd"),
            query="data",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "Texas ESBD record was not an object"


def test_fetch_tx_esbd_opportunities_preserves_normalized_aliases():
    session = FakeSession(
        FakeResponse(
            payload=[
                {
                    "source_bid_id": "TX-NORMALIZED-001",
                    "title": "Normalized data services",
                    "source_url": "https://www.txsmartbuy.gov/esbd/TX-NORMALIZED-001",
                    "published_date": "2026-05-18",
                    "deadline_date": "2026-06-10",
                    "issuer_name": "Texas Department of Information Resources",
                }
            ]
        )
    )

    bids = fetch_tx_esbd_opportunities(
        get_source("tx_esbd"),
        query="data",
        limit=5,
        session=session,
        timeout=10,
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "TX-NORMALIZED-001"
    assert bid["dedupe_key"] == "tx_esbd:TX-NORMALIZED-001"
    assert bid["source_url"] == "https://www.txsmartbuy.gov/esbd/TX-NORMALIZED-001"
    assert bid["published_date"] == "2026-05-18"
    assert bid["deadline_date"] == "2026-06-10"
    assert bid["issuer_name"] == "Texas Department of Information Resources"


def test_fetch_tx_esbd_opportunities_uses_tx_title_and_category_precedence():
    session = FakeSession(
        FakeResponse(
            payload=[
                {
                    "source_bid_id": "TX-ALIAS-001",
                    "name": "Name title wins",
                    "solicitationTitle": "Solicitation title loses",
                    "category": "Category wins",
                    "classItem": "Class item loses",
                    "commodity": "Commodity loses",
                },
                {
                    "source_bid_id": "TX-ALIAS-002",
                    "name": "Commodity-only opportunity",
                    "commodity": "Commodity fallback",
                },
            ]
        )
    )

    bids = fetch_tx_esbd_opportunities(
        get_source("tx_esbd"),
        query="data",
        limit=5,
        session=session,
        timeout=10,
    )

    assert bids[0]["title"] == "Name title wins"
    assert bids[0]["original_category"] == "Category wins"
    assert bids[1]["original_category"] == "Commodity fallback"


def test_fetch_tx_esbd_opportunities_raises_on_http_error():
    session = FakeSession(FakeResponse(status_code=503, text="maintenance"))

    with pytest.raises(TxEsbdError) as error:
        fetch_tx_esbd_opportunities(
            get_source("tx_esbd"),
            query="data",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == (
        "Texas ESBD request failed with status 503: maintenance"
    )


def test_fetch_tx_esbd_opportunities_raises_on_invalid_http_json():
    session = FakeSession(FakeResponse(json_error=ValueError("not json")))

    with pytest.raises(TxEsbdError) as error:
        fetch_tx_esbd_opportunities(
            get_source("tx_esbd"),
            query="data",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "Texas ESBD response was not valid JSON"


def test_fetch_tx_esbd_opportunities_wraps_request_errors():
    session = FakeSession(requests.Timeout("slow"))

    with pytest.raises(TxEsbdError) as error:
        fetch_tx_esbd_opportunities(
            get_source("tx_esbd"),
            query="data",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "Texas ESBD request failed: slow"


def test_fetch_tx_esbd_opportunities_replays_adapter_fixture_json():
    bids = fetch_tx_esbd_opportunities(
        get_source("tx_esbd"),
        query="data",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "tx_esbd_live_response.json"),
    )

    assert len(bids) == 1
    assert bids[0]["dedupe_key"] == "tx_esbd:ESBD-LIVE-2026-77"
