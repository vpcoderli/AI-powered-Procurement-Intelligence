from apsi_crawler.config import DEFAULT_SOURCE
from apsi_crawler.sources.registry import get_fixture_loader, get_source, list_sources


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
