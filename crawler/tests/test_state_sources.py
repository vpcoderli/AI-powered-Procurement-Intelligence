from apsi_crawler.config import DEFAULT_SOURCE
from apsi_crawler.sources.registry import (
    get_fixture_loader,
    get_live_fetcher,
    get_source,
    list_sources,
    supports_live_fetch,
)
from apsi_crawler.spiders.co_bidnet import fetch_co_bidnet_opportunities
from apsi_crawler.spiders.ct_ctsource import fetch_ct_ctsource_opportunities
from apsi_crawler.spiders.in_idoa import fetch_in_idoa_opportunities
from apsi_crawler.spiders.ks_esupplier import fetch_ks_esupplier_opportunities
from apsi_crawler.spiders.ma_commbuys import fetch_ma_commbuys_opportunities
from apsi_crawler.spiders.ga_procurement_registry import (
    fetch_ga_procurement_registry_opportunities,
)
from apsi_crawler.spiders.ia_bid_opportunities import fetch_ia_bid_opportunities
from apsi_crawler.spiders.me_rfps import fetch_me_rfp_opportunities
from apsi_crawler.spiders.mo_bid_listing import fetch_mo_bid_listing_opportunities
from apsi_crawler.spiders.ms_contract_bid_search import (
    fetch_ms_contract_bid_search_opportunities,
)
from apsi_crawler.spiders.mt_emacs import fetch_mt_emacs_opportunities
from apsi_crawler.spiders.nj_start import fetch_nj_start_opportunities
from apsi_crawler.spiders.nm_spd import fetch_nm_spd_opportunities
from apsi_crawler.spiders.nv_epro import fetch_nv_epro_opportunities
from apsi_crawler.spiders.oh_procure import fetch_oh_procure_opportunities
from apsi_crawler.spiders.ut_bonfire import fetch_ut_bonfire_opportunities
from apsi_crawler.spiders.va_eva import fetch_va_eva_opportunities
from apsi_crawler.spiders.wa_des import fetch_wa_des_opportunities

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


def test_batch_two_state_sources_are_registered_to_dedicated_fetchers():
    assert get_live_fetcher("ma_state_procurement") is fetch_ma_commbuys_opportunities
    assert get_live_fetcher("nj_state_procurement") is fetch_nj_start_opportunities
    assert get_live_fetcher("oh_state_procurement") is fetch_oh_procure_opportunities
    assert get_live_fetcher("va_state_procurement") is fetch_va_eva_opportunities
    assert get_live_fetcher("wa_state_procurement") is fetch_wa_des_opportunities


def test_batch_three_state_sources_are_registered_to_dedicated_fetchers():
    assert get_live_fetcher("ia_state_procurement") is fetch_ia_bid_opportunities
    assert get_live_fetcher("ga_state_procurement") is fetch_ga_procurement_registry_opportunities
    assert get_live_fetcher("me_state_procurement") is fetch_me_rfp_opportunities
    assert get_live_fetcher("mo_state_procurement") is fetch_mo_bid_listing_opportunities
    assert get_live_fetcher("nv_state_procurement") is fetch_nv_epro_opportunities


def test_batch_four_state_sources_are_registered_to_dedicated_fetchers():
    assert get_live_fetcher("ut_state_procurement") is fetch_ut_bonfire_opportunities
    assert get_live_fetcher("ks_state_procurement") is fetch_ks_esupplier_opportunities
    assert get_live_fetcher("mt_state_procurement") is fetch_mt_emacs_opportunities
    assert get_live_fetcher("nm_state_procurement") is fetch_nm_spd_opportunities
    assert get_live_fetcher("co_state_procurement") is fetch_co_bidnet_opportunities
    assert get_live_fetcher("in_state_procurement") is fetch_in_idoa_opportunities
    assert get_live_fetcher("ms_state_procurement") is fetch_ms_contract_bid_search_opportunities
    assert get_live_fetcher("ct_state_procurement") is fetch_ct_ctsource_opportunities


def test_sam_gov_default_fixture_loader_remains_compatible():
    sam_source = get_source(DEFAULT_SOURCE)

    assert sam_source.id == "sam_gov"
    assert sam_source.source_label == "SAM.gov"
    assert callable(get_fixture_loader())
