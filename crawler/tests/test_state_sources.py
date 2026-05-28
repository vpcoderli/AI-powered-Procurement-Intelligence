from apsi_crawler.config import DEFAULT_SOURCE
from apsi_crawler.sources.registry import (
    get_fixture_loader,
    get_live_fetcher,
    get_source,
    list_sources,
    supports_live_fetch,
)

US_STATE_CODES = {
    "AL",
    "AK",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "FL",
    "GA",
    "HI",
    "ID",
    "IL",
    "IN",
    "IA",
    "KS",
    "KY",
    "LA",
    "ME",
    "MD",
    "MA",
    "MI",
    "MN",
    "MS",
    "MO",
    "MT",
    "NE",
    "NV",
    "NH",
    "NJ",
    "NM",
    "NY",
    "NC",
    "ND",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VT",
    "VA",
    "WA",
    "WV",
    "WI",
    "WY",
}


def test_registry_includes_sam_gov_and_state_sources():
    source_ids = {source.id for source in list_sources()}

    assert "sam_gov" in source_ids
    assert {
        "ca_caleprocure",
        "tx_esbd",
        "ny_contract_reporter",
        "fl_mfmp",
        "il_bidbuy",
    }.issubset(source_ids)


def test_registry_includes_exactly_50_state_sources_with_stable_metadata():
    state_sources = [source for source in list_sources() if source.jurisdiction == "state"]

    assert len(state_sources) == 50
    assert {source.state_code for source in state_sources} == US_STATE_CODES
    assert len({source.id for source in state_sources}) == 50
    assert all(source.name for source in state_sources)
    assert all(source.source_label for source in state_sources)
    assert all(source.base_url for source in state_sources)
    assert all(callable(source.fixture_loader) for source in state_sources)
    assert all(supports_live_fetch(source.id) for source in state_sources)
    assert all(callable(get_live_fetcher(source.id)) for source in state_sources)


def test_state_source_metadata_is_stable():
    ca_source = get_source("ca_caleprocure")

    assert ca_source.id == "ca_caleprocure"
    assert ca_source.name == "California Cal eProcure"
    assert ca_source.jurisdiction == "state"
    assert ca_source.state_code == "CA"
    assert ca_source.source_label == "California Cal eProcure"
    assert callable(get_fixture_loader("ca_caleprocure"))


def test_sam_gov_default_fixture_loader_remains_compatible():
    sam_source = get_source(DEFAULT_SOURCE)

    assert sam_source.id == "sam_gov"
    assert sam_source.source_label == "SAM.gov"
    assert callable(get_fixture_loader())
