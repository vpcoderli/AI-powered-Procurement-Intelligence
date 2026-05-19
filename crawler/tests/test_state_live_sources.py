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
from apsi_crawler.spiders.fl_mfmp import (
    FlMfmpError,
    fetch_fl_mfmp_opportunities,
)
from apsi_crawler.spiders.ny_contract_reporter import (
    NyContractReporterError,
    fetch_ny_contract_reporter_opportunities,
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

    def post(self, url, json=None, timeout=None):
        self.calls.append({"url": url, "json": json, "timeout": timeout})
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


def test_registry_reports_live_support_for_ny_contract_reporter():
    assert supports_live_fetch("ny_contract_reporter") is True
    assert get_live_fetcher("ny_contract_reporter") is fetch_ny_contract_reporter_opportunities


def test_registry_reports_live_support_for_fl_mfmp():
    assert supports_live_fetch("fl_mfmp") is True
    assert get_live_fetcher("fl_mfmp") is fetch_fl_mfmp_opportunities


def test_registry_reports_unsupported_live_state_sources():
    assert supports_live_fetch("il_bidbuy") is False

    with pytest.raises(UnsupportedLiveSourceError) as error:
        get_live_fetcher("il_bidbuy")

    assert str(error.value) == "Live fetch is not implemented for source: il_bidbuy"


def test_fetch_ny_contract_reporter_opportunities_normalizes_live_response():
    fixture_path = FIXTURES_DIR / "ny_contract_reporter_live_response.json"
    with fixture_path.open() as fixture:
        payload = json.load(fixture)
    session = FakeSession(FakeResponse(payload=payload))

    bids = fetch_ny_contract_reporter_opportunities(
        get_source("ny_contract_reporter"),
        query="records",
        limit=5,
        session=session,
        timeout=10,
    )

    assert session.calls[0]["url"] == "https://www.nyscr.ny.gov/home/contracts"
    assert session.calls[0]["params"] == {"query": "records", "limit": 5}
    assert session.calls[0]["timeout"] == 10
    assert len(bids) == 1
    bid = bids[0]
    assert bid["dedupe_key"] == "ny_contract_reporter:NYSCR-LIVE-2026-310"
    assert bid["title"] == "Digital records archive"
    assert bid["issuer_name"] == "New York State Archives"
    assert bid["issuer_type"] == "state"
    assert bid["state_code"] == "NY"
    assert (
        bid["source_url"]
        == "https://www.nyscr.ny.gov/adsOpen.cfm?ID=NYSCR-LIVE-2026-310"
    )


def test_fetch_ny_contract_reporter_opportunities_raises_on_unexpected_payload_shape():
    session = FakeSession(FakeResponse(payload={"error": "changed"}))

    with pytest.raises(NyContractReporterError) as error:
        fetch_ny_contract_reporter_opportunities(
            get_source("ny_contract_reporter"),
            query="records",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == (
        "NY Contract Reporter response did not contain opportunities or results"
    )


def test_fetch_ny_contract_reporter_opportunities_raises_when_record_is_not_object():
    session = FakeSession(FakeResponse(payload={"opportunities": [None]}))

    with pytest.raises(NyContractReporterError) as error:
        fetch_ny_contract_reporter_opportunities(
            get_source("ny_contract_reporter"),
            query="records",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "NY Contract Reporter record was not an object"


def test_fetch_ny_contract_reporter_opportunities_raises_when_record_missing_source_id():
    session = FakeSession(FakeResponse(payload={"opportunities": [{"title": "Records"}]}))

    with pytest.raises(NyContractReporterError) as error:
        fetch_ny_contract_reporter_opportunities(
            get_source("ny_contract_reporter"),
            query="records",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "NY Contract Reporter record is missing source id"


def test_fetch_ny_contract_reporter_opportunities_preserves_normalized_aliases():
    session = FakeSession(
        FakeResponse(
            payload=[
                {
                    "source_bid_id": "NY-NORMALIZED-001",
                    "title": "Normalized records services",
                    "source_url": "https://www.nyscr.ny.gov/adsOpen.cfm?ID=NY-NORMALIZED-001",
                    "published_date": "2026-05-18",
                    "deadline_date": "2026-06-10",
                    "issuer_name": "New York State Archives",
                }
            ]
        )
    )

    bids = fetch_ny_contract_reporter_opportunities(
        get_source("ny_contract_reporter"),
        query="records",
        limit=5,
        session=session,
        timeout=10,
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "NY-NORMALIZED-001"
    assert bid["dedupe_key"] == "ny_contract_reporter:NY-NORMALIZED-001"
    assert bid["source_url"] == "https://www.nyscr.ny.gov/adsOpen.cfm?ID=NY-NORMALIZED-001"
    assert bid["published_date"] == "2026-05-18"
    assert bid["deadline_date"] == "2026-06-10"
    assert bid["issuer_name"] == "New York State Archives"


def test_fetch_ny_contract_reporter_opportunities_uses_ny_title_and_category_precedence():
    session = FakeSession(
        FakeResponse(
            payload=[
                {
                    "source_bid_id": "NY-ALIAS-001",
                    "title": "Title wins",
                    "name": "Name loses",
                    "contractTitle": "Contract title loses",
                    "category": "Category wins",
                    "type": "Type loses",
                    "classification": "Classification loses",
                },
                {
                    "source_bid_id": "NY-ALIAS-002",
                    "name": "Name wins",
                    "contractTitle": "Contract title loses",
                    "type": "Type wins",
                    "classification": "Classification loses",
                },
                {
                    "source_bid_id": "NY-ALIAS-003",
                    "contractTitle": "Contract title fallback",
                    "classification": "Classification fallback",
                },
            ]
        )
    )

    bids = fetch_ny_contract_reporter_opportunities(
        get_source("ny_contract_reporter"),
        query="records",
        limit=5,
        session=session,
        timeout=10,
    )

    assert bids[0]["title"] == "Title wins"
    assert bids[0]["original_category"] == "Category wins"
    assert bids[1]["title"] == "Name wins"
    assert bids[1]["original_category"] == "Type wins"
    assert bids[2]["title"] == "Contract title fallback"
    assert bids[2]["original_category"] == "Classification fallback"


def test_fetch_ny_contract_reporter_opportunities_raises_on_http_error():
    session = FakeSession(FakeResponse(status_code=503, text="maintenance"))

    with pytest.raises(NyContractReporterError) as error:
        fetch_ny_contract_reporter_opportunities(
            get_source("ny_contract_reporter"),
            query="records",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == (
        "NY Contract Reporter request failed with status 503: maintenance"
    )


def test_fetch_ny_contract_reporter_opportunities_raises_on_invalid_http_json():
    session = FakeSession(FakeResponse(json_error=ValueError("not json")))

    with pytest.raises(NyContractReporterError) as error:
        fetch_ny_contract_reporter_opportunities(
            get_source("ny_contract_reporter"),
            query="records",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "NY Contract Reporter response was not valid JSON"


def test_fetch_ny_contract_reporter_opportunities_wraps_request_errors():
    session = FakeSession(requests.Timeout("slow"))

    with pytest.raises(NyContractReporterError) as error:
        fetch_ny_contract_reporter_opportunities(
            get_source("ny_contract_reporter"),
            query="records",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "NY Contract Reporter request failed: slow"


def test_fetch_ny_contract_reporter_opportunities_replays_adapter_fixture_json():
    bids = fetch_ny_contract_reporter_opportunities(
        get_source("ny_contract_reporter"),
        query="records",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "ny_contract_reporter_live_response.json"),
    )

    assert len(bids) == 1
    assert bids[0]["dedupe_key"] == "ny_contract_reporter:NYSCR-LIVE-2026-310"


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


def test_fetch_fl_mfmp_opportunities_normalizes_live_response():
    fixture_path = FIXTURES_DIR / "fl_mfmp_live_response.json"
    with fixture_path.open() as fixture:
        payload = json.load(fixture)
    session = FakeSession(FakeResponse(payload=payload))

    bids = fetch_fl_mfmp_opportunities(
        get_source("fl_mfmp"),
        query="communications",
        limit=5,
        session=session,
        timeout=10,
    )

    assert session.calls[0]["url"] == (
        "https://vendor.myfloridamarketplace.com/mfmp/pub/search/bids"
    )
    assert session.calls[0]["json"] == {
        "pageSize": 5,
        "type": [],
        "status": [],
        "agency": [],
        "adNumber": "",
        "agencyAdvertisementNumber": "",
        "title": "communications",
        "publishedDate": "",
        "openDate": "",
        "endDate": "",
        "commodityCodes": [],
        "intendsToParticipate": "",
        "assignee": "",
        "page": 1,
    }
    assert session.calls[0]["timeout"] == 10
    assert len(bids) == 1
    bid = bids[0]
    assert bid["dedupe_key"] == "fl_mfmp:FL-MFMP-LIVE-2026-42"
    assert bid["title"] == "Emergency communications assessment"
    assert bid["issuer_name"] == "Florida Department of Management Services"
    assert bid["issuer_type"] == "state"
    assert bid["state_code"] == "FL"
    assert bid["source_url"] == (
        "https://vendor.myfloridamarketplace.com/search/bids/detail/"
        "FL-MFMP-LIVE-2026-42"
    )


def test_fetch_fl_mfmp_opportunities_raises_on_unexpected_payload_shape():
    session = FakeSession(FakeResponse(payload={"error": "changed"}))

    with pytest.raises(FlMfmpError) as error:
        fetch_fl_mfmp_opportunities(
            get_source("fl_mfmp"),
            query="communications",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "MyFloridaMarketPlace response did not contain opportunities or results"


def test_fetch_fl_mfmp_opportunities_raises_when_record_is_not_object():
    session = FakeSession(FakeResponse(payload={"opportunities": [None]}))

    with pytest.raises(FlMfmpError) as error:
        fetch_fl_mfmp_opportunities(
            get_source("fl_mfmp"),
            query="communications",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "MyFloridaMarketPlace record was not an object"


def test_fetch_fl_mfmp_opportunities_raises_when_record_missing_source_id():
    session = FakeSession(FakeResponse(payload={"opportunities": [{"title": "Comms"}]}))

    with pytest.raises(FlMfmpError) as error:
        fetch_fl_mfmp_opportunities(
            get_source("fl_mfmp"),
            query="communications",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "MyFloridaMarketPlace record is missing source id"


def test_fetch_fl_mfmp_opportunities_preserves_normalized_aliases():
    session = FakeSession(
        FakeResponse(
            payload=[
                {
                    "source_bid_id": "FL-NORMALIZED-001",
                    "title": "Normalized communications services",
                    "source_url": "https://vendor.myfloridamarketplace.com/bids/FL-NORMALIZED-001",
                    "published_date": "2026-05-18",
                    "deadline_date": "2026-06-10",
                    "issuer_name": "Florida Department of Management Services",
                }
            ]
        )
    )

    bids = fetch_fl_mfmp_opportunities(
        get_source("fl_mfmp"),
        query="communications",
        limit=5,
        session=session,
        timeout=10,
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "FL-NORMALIZED-001"
    assert bid["dedupe_key"] == "fl_mfmp:FL-NORMALIZED-001"
    assert bid["source_url"] == "https://vendor.myfloridamarketplace.com/bids/FL-NORMALIZED-001"
    assert bid["published_date"] == "2026-05-18"
    assert bid["deadline_date"] == "2026-06-10"
    assert bid["issuer_name"] == "Florida Department of Management Services"


def test_fetch_fl_mfmp_opportunities_uses_public_search_aliases():
    session = FakeSession(
        FakeResponse(
            payload=[
                {
                    "agencyAdNumber": "DMS-26-001",
                    "uniqueName": "Emergency communications assessment",
                    "openDate": "2026-05-04",
                    "closeDate": "2026-06-21T17:00:00-04:00",
                    "organization": "Florida Department of Management Services",
                }
            ]
        )
    )

    bids = fetch_fl_mfmp_opportunities(
        get_source("fl_mfmp"),
        query="communications",
        limit=5,
        session=session,
        timeout=10,
    )

    bid = bids[0]
    assert bid["source_bid_id"] == "DMS-26-001"
    assert bid["title"] == "Emergency communications assessment"
    assert bid["published_date"] == "2026-05-04"
    assert bid["deadline_date"] == "2026-06-21T17:00:00-04:00"
    assert bid["issuer_name"] == "Florida Department of Management Services"
    assert bid["source_url"] == (
        "https://vendor.myfloridamarketplace.com/search/bids/detail/DMS-26-001"
    )


def test_fetch_fl_mfmp_opportunities_uses_fl_title_and_category_precedence():
    session = FakeSession(
        FakeResponse(
            payload=[
                {
                    "source_bid_id": "FL-ALIAS-001",
                    "title": "Title wins",
                    "name": "Name loses",
                    "advertisementTitle": "Advertisement title loses",
                    "category": "Category wins",
                    "type": "Type loses",
                    "commodity": "Commodity loses",
                },
                {
                    "source_bid_id": "FL-ALIAS-002",
                    "advertisementTitle": "Advertisement title fallback",
                    "commodity": "Commodity fallback",
                },
            ]
        )
    )

    bids = fetch_fl_mfmp_opportunities(
        get_source("fl_mfmp"),
        query="communications",
        limit=5,
        session=session,
        timeout=10,
    )

    assert bids[0]["title"] == "Title wins"
    assert bids[0]["original_category"] == "Category wins"
    assert bids[1]["title"] == "Advertisement title fallback"
    assert bids[1]["original_category"] == "Commodity fallback"


def test_fetch_fl_mfmp_opportunities_raises_on_http_error():
    session = FakeSession(FakeResponse(status_code=503, text="maintenance"))

    with pytest.raises(FlMfmpError) as error:
        fetch_fl_mfmp_opportunities(
            get_source("fl_mfmp"),
            query="communications",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "MyFloridaMarketPlace request failed with status 503: maintenance"


def test_fetch_fl_mfmp_opportunities_raises_on_invalid_http_json():
    session = FakeSession(FakeResponse(json_error=ValueError("not json")))

    with pytest.raises(FlMfmpError) as error:
        fetch_fl_mfmp_opportunities(
            get_source("fl_mfmp"),
            query="communications",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "MyFloridaMarketPlace response was not valid JSON"


def test_fetch_fl_mfmp_opportunities_wraps_request_errors():
    session = FakeSession(requests.Timeout("slow"))

    with pytest.raises(FlMfmpError) as error:
        fetch_fl_mfmp_opportunities(
            get_source("fl_mfmp"),
            query="communications",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "MyFloridaMarketPlace request failed: slow"


def test_fetch_fl_mfmp_opportunities_replays_adapter_fixture_json_without_session_call():
    session = FakeSession(requests.Timeout("should not call"))

    bids = fetch_fl_mfmp_opportunities(
        get_source("fl_mfmp"),
        query="communications",
        limit=5,
        session=session,
        fixture_json=str(FIXTURES_DIR / "fl_mfmp_live_response.json"),
    )

    assert len(bids) == 1
    assert bids[0]["dedupe_key"] == "fl_mfmp:FL-MFMP-LIVE-2026-42"
    assert session.calls == []
