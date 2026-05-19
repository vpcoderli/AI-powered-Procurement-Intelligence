from apsi_crawler.normalizers.state_bids import normalize_state_opportunity
from apsi_crawler.sources.registry import get_source


def test_normalize_state_opportunity_outputs_stable_bid_fields():
    raw = {
        "id": "CA-2026-001",
        "title": "Case management modernization",
        "description": "Modernize case management workflows.",
        "category": "IT Services",
        "published_date": "2026-05-01",
        "deadline_date": "2026-06-10T17:00:00-07:00",
        "issuer_name": "California Department of Technology",
        "contact_name": "Avery Buyer",
        "contact_email": "avery.buyer@state.ca.gov",
        "contact_phone": "916-555-0100",
        "url": "https://caleprocure.ca.gov/event/CA-2026-001",
    }

    bid = normalize_state_opportunity(raw, get_source("ca_caleprocure"))

    assert bid["source"] == "California Cal eProcure"
    assert bid["source_bid_id"] == "CA-2026-001"
    assert bid["dedupe_key"] == "ca_caleprocure:CA-2026-001"
    assert bid["issuer_type"] == "state"
    assert bid["state_code"] == "CA"
    assert bid["source_url"] == "https://caleprocure.ca.gov/event/CA-2026-001"
    assert bid["id"] == "ca_caleprocure:CA-2026-001"
    assert bid["raw_payload"] == raw


def test_normalize_state_opportunity_accepts_source_specific_identifiers():
    raw = {
        "source_bid_id": "ESBD-2026-77",
        "name": "Data catalog services",
        "agency": "Texas Department of Information Resources",
        "link": "https://www.txsmartbuy.gov/esbd/ESBD-2026-77",
    }

    bid = normalize_state_opportunity(raw, get_source("tx_esbd"))

    assert bid["source"] == "Texas ESBD"
    assert bid["title"] == "Data catalog services"
    assert bid["issuer_name"] == "Texas Department of Information Resources"
    assert bid["state_code"] == "TX"
    assert bid["dedupe_key"] == "tx_esbd:ESBD-2026-77"
    assert bid["source_url"] == "https://www.txsmartbuy.gov/esbd/ESBD-2026-77"
