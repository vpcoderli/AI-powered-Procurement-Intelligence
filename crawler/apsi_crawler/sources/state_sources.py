from apsi_crawler.sources.base import Source
from apsi_crawler.spiders.ar_procurement import fetch_ar_procurement_opportunities
from apsi_crawler.spiders.ca_caleprocure import fetch_ca_caleprocure_opportunities
from apsi_crawler.spiders.co_bidnet import fetch_co_bidnet_opportunities
from apsi_crawler.spiders.ct_ctsource import fetch_ct_ctsource_opportunities
from apsi_crawler.spiders.de_bids import fetch_de_bids_opportunities
from apsi_crawler.spiders.fl_mfmp import fetch_fl_mfmp_opportunities
from apsi_crawler.spiders.ga_procurement_registry import (
    fetch_ga_procurement_registry_opportunities,
)
from apsi_crawler.spiders.generic_state import fetch_generic_state_opportunities
from apsi_crawler.spiders.hi_hands import fetch_hi_hands_opportunities
from apsi_crawler.spiders.ia_bid_opportunities import fetch_ia_bid_opportunities
from apsi_crawler.spiders.il_bidbuy import fetch_il_bidbuy_opportunities
from apsi_crawler.spiders.in_idoa import fetch_in_idoa_opportunities
from apsi_crawler.spiders.ks_esupplier import fetch_ks_esupplier_opportunities
from apsi_crawler.spiders.ma_commbuys import fetch_ma_commbuys_opportunities
from apsi_crawler.spiders.me_rfps import fetch_me_rfp_opportunities
from apsi_crawler.spiders.mo_bid_listing import fetch_mo_bid_listing_opportunities
from apsi_crawler.spiders.ms_contract_bid_search import (
    fetch_ms_contract_bid_search_opportunities,
)
from apsi_crawler.spiders.mt_emacs import fetch_mt_emacs_opportunities
from apsi_crawler.spiders.nj_start import fetch_nj_start_opportunities
from apsi_crawler.spiders.nm_spd import fetch_nm_spd_opportunities
from apsi_crawler.spiders.nv_epro import fetch_nv_epro_opportunities
from apsi_crawler.spiders.ny_contract_reporter import fetch_ny_contract_reporter_opportunities
from apsi_crawler.spiders.ok_esupplier import fetch_ok_esupplier_opportunities
from apsi_crawler.spiders.or_oregonbuys import fetch_or_oregonbuys_opportunities
from apsi_crawler.spiders.pa_emarketplace import fetch_pa_emarketplace_opportunities
from apsi_crawler.spiders.ri_ocean_state_procures import (
    fetch_ri_ocean_state_procures_opportunities,
)
from apsi_crawler.spiders.sd_esm import fetch_sd_esm_opportunities
from apsi_crawler.spiders.state_bidnet import (
    fetch_ak_bidnet_opportunities,
    fetch_al_bidnet_opportunities,
    fetch_az_bidnet_opportunities,
    fetch_id_bidnet_opportunities,
    fetch_ky_bidnet_opportunities,
    fetch_la_bidnet_opportunities,
    fetch_md_bidnet_opportunities,
    fetch_mi_bidnet_opportunities,
    fetch_mn_bidnet_opportunities,
    fetch_nc_bidnet_opportunities,
    fetch_nd_bidnet_opportunities,
    fetch_ne_bidnet_opportunities,
    fetch_nh_bidnet_opportunities,
    fetch_oh_bidnet_opportunities,
    fetch_sc_bidnet_opportunities,
    fetch_vt_bidnet_opportunities,
    fetch_wi_bidnet_opportunities,
)
from apsi_crawler.spiders.state_fixture import load_state_fixture_opportunities
from apsi_crawler.spiders.tn_edison import fetch_tn_edison_opportunities
from apsi_crawler.spiders.tx_esbd import fetch_tx_esbd_opportunities
from apsi_crawler.spiders.ut_bonfire import fetch_ut_bonfire_opportunities
from apsi_crawler.spiders.va_eva import fetch_va_eva_opportunities
from apsi_crawler.spiders.wa_des import fetch_wa_des_opportunities
from apsi_crawler.spiders.wv_bidnet import fetch_wv_bidnet_opportunities
from apsi_crawler.spiders.wy_ai_bids import fetch_wy_ai_bid_opportunities


STATE_SOURCE_DEFINITIONS = (
    ("AL", "al_state_procurement", "Alabama State Procurement", "https://purchasing.alabama.gov"),
    ("AK", "ak_state_procurement", "Alaska State Procurement", "https://aws.state.ak.us/OnlinePublicNotices"),
    ("AZ", "az_state_procurement", "Arizona State Procurement", "https://app.az.gov"),
    ("AR", "ar_state_procurement", "Arkansas State Procurement", "https://www.arkansas.gov/dfa/procurement"),
    ("CA", "ca_caleprocure", "California Cal eProcure", "https://caleprocure.ca.gov"),
    ("CO", "co_state_procurement", "Colorado State Procurement", "https://www.bidnetdirect.com/colorado"),
    ("CT", "ct_state_procurement", "Connecticut State Contracting Portal", "https://portal.ct.gov/das/ctsource"),
    ("DE", "de_state_procurement", "Delaware State Procurement", "https://mymarketplace.delaware.gov"),
    ("FL", "fl_mfmp", "MyFloridaMarketPlace", "https://vendor.myfloridamarketplace.com"),
    ("GA", "ga_state_procurement", "Georgia State Procurement Registry", "https://ssl.doas.state.ga.us/gpr"),
    ("HI", "hi_state_procurement", "Hawaii State Procurement", "https://hands.ehawaii.gov/hands"),
    ("ID", "id_state_procurement", "Idaho State Procurement", "https://purchasing.idaho.gov"),
    ("IL", "il_bidbuy", "Illinois BidBuy", "https://www.bidbuy.illinois.gov"),
    ("IN", "in_state_procurement", "Indiana State Procurement", "https://www.in.gov/idoa/procurement"),
    ("IA", "ia_state_procurement", "Iowa State Procurement", "https://bidopportunities.iowa.gov"),
    ("KS", "ks_state_procurement", "Kansas State Procurement", "https://admin.ks.gov/offices/procurement-contracts"),
    ("KY", "ky_state_procurement", "Kentucky State Procurement", "https://vss.ky.gov"),
    ("LA", "la_state_procurement", "Louisiana State Procurement", "https://wwwcfprd.doa.louisiana.gov/osp/lapac"),
    ("ME", "me_state_procurement", "Maine State Procurement", "https://www.maine.gov/dafs/bbm/procurementservices"),
    ("MD", "md_state_procurement", "Maryland State Procurement", "https://emma.maryland.gov"),
    ("MA", "ma_state_procurement", "Massachusetts COMMBUYS", "https://www.commbuys.com"),
    ("MI", "mi_state_procurement", "Michigan State Procurement", "https://www.michigan.gov/dtmb/procurement"),
    ("MN", "mn_state_procurement", "Minnesota State Procurement", "https://mn.gov/admin/osp"),
    (
        "MS",
        "ms_state_procurement",
        "Mississippi State Procurement",
        "https://www.ms.gov/dfa/contract_bid_search/Bid?autoloadGrid=true",
    ),
    ("MO", "mo_state_procurement", "Missouri State Procurement", "https://oa.mo.gov/purchasing"),
    ("MT", "mt_state_procurement", "Montana State Procurement", "https://spb.mt.gov"),
    ("NE", "ne_state_procurement", "Nebraska State Procurement", "https://das.nebraska.gov/materiel/purchasing"),
    ("NV", "nv_state_procurement", "Nevada State Procurement", "https://purchasing.nv.gov"),
    ("NH", "nh_state_procurement", "New Hampshire State Procurement", "https://das.nh.gov/purchasing"),
    ("NJ", "nj_state_procurement", "New Jersey State Procurement", "https://www.njstart.gov"),
    ("NM", "nm_state_procurement", "New Mexico State Procurement", "https://www.generalservices.state.nm.us/state-purchasing"),
    ("NY", "ny_contract_reporter", "New York State Contract Reporter", "https://www.nyscr.ny.gov"),
    ("NC", "nc_state_procurement", "North Carolina State Procurement", "https://www.ips.state.nc.us"),
    ("ND", "nd_state_procurement", "North Dakota State Procurement", "https://apps.nd.gov/csd/spo/services/bidder/main.htm"),
    ("OH", "oh_state_procurement", "Ohio State Procurement", "https://www.bidnetdirect.com/ohio/solicitations/open-bids"),
    ("OK", "ok_state_procurement", "Oklahoma State Procurement", "https://oklahoma.gov/omes/services/purchasing"),
    ("OR", "or_state_procurement", "Oregon State Procurement", "https://oregonbuys.gov"),
    ("PA", "pa_state_procurement", "Pennsylvania eMarketplace", "https://www.emarketplace.state.pa.us"),
    ("RI", "ri_state_procurement", "Rhode Island State Procurement", "https://ridop.ri.gov"),
    ("SC", "sc_state_procurement", "South Carolina Business Opportunities", "https://procurement.sc.gov"),
    ("SD", "sd_state_procurement", "South Dakota State Procurement", "https://boa.sd.gov/procurement"),
    ("TN", "tn_state_procurement", "Tennessee State Procurement", "https://www.tn.gov/generalservices/procurement.html"),
    ("TX", "tx_esbd", "Texas ESBD", "https://www.txsmartbuy.gov/esbd"),
    ("UT", "ut_state_procurement", "Utah State Procurement", "https://purchasing.utah.gov"),
    ("VT", "vt_state_procurement", "Vermont State Procurement", "https://bgs.vermont.gov/purchasing-contracting"),
    ("VA", "va_state_procurement", "Virginia eVA", "https://eva.virginia.gov"),
    ("WA", "wa_state_procurement", "Washington State Procurement", "https://pr-webs-vendor.des.wa.gov"),
    ("WV", "wv_state_procurement", "West Virginia State Procurement", "https://www.state.wv.us/admin/purchase"),
    ("WI", "wi_state_procurement", "Wisconsin State Procurement", "https://vendornet.wi.gov"),
    ("WY", "wy_state_procurement", "Wyoming State Procurement", "https://ai.wyo.gov/divisions/general-services/purchasing/bid-opportunities"),
)

SPECIAL_FETCHERS = {
    "ca_caleprocure": fetch_ca_caleprocure_opportunities,
    "tx_esbd": fetch_tx_esbd_opportunities,
    "ny_contract_reporter": fetch_ny_contract_reporter_opportunities,
    "fl_mfmp": fetch_fl_mfmp_opportunities,
    "il_bidbuy": fetch_il_bidbuy_opportunities,
    "ia_state_procurement": fetch_ia_bid_opportunities,
    "ga_state_procurement": fetch_ga_procurement_registry_opportunities,
    "me_state_procurement": fetch_me_rfp_opportunities,
    "mo_state_procurement": fetch_mo_bid_listing_opportunities,
    "nv_state_procurement": fetch_nv_epro_opportunities,
    "ma_state_procurement": fetch_ma_commbuys_opportunities,
    "nj_state_procurement": fetch_nj_start_opportunities,
    "oh_state_procurement": fetch_oh_bidnet_opportunities,
    "pa_state_procurement": fetch_pa_emarketplace_opportunities,
    "sc_state_procurement": fetch_sc_bidnet_opportunities,
    "or_state_procurement": fetch_or_oregonbuys_opportunities,
    "va_state_procurement": fetch_va_eva_opportunities,
    "wa_state_procurement": fetch_wa_des_opportunities,
    "ut_state_procurement": fetch_ut_bonfire_opportunities,
    "ks_state_procurement": fetch_ks_esupplier_opportunities,
    "mt_state_procurement": fetch_mt_emacs_opportunities,
    "nm_state_procurement": fetch_nm_spd_opportunities,
    "co_state_procurement": fetch_co_bidnet_opportunities,
    "in_state_procurement": fetch_in_idoa_opportunities,
    "ms_state_procurement": fetch_ms_contract_bid_search_opportunities,
    "ct_state_procurement": fetch_ct_ctsource_opportunities,
    "ok_state_procurement": fetch_ok_esupplier_opportunities,
    "ar_state_procurement": fetch_ar_procurement_opportunities,
    "sd_state_procurement": fetch_sd_esm_opportunities,
    "wv_state_procurement": fetch_wv_bidnet_opportunities,
    "wy_state_procurement": fetch_wy_ai_bid_opportunities,
    "al_state_procurement": fetch_al_bidnet_opportunities,
    "ak_state_procurement": fetch_ak_bidnet_opportunities,
    "hi_state_procurement": fetch_hi_hands_opportunities,
    "ky_state_procurement": fetch_ky_bidnet_opportunities,
    "mn_state_procurement": fetch_mn_bidnet_opportunities,
    "wi_state_procurement": fetch_wi_bidnet_opportunities,
    "nh_state_procurement": fetch_nh_bidnet_opportunities,
    "de_state_procurement": fetch_de_bids_opportunities,
    "ri_state_procurement": fetch_ri_ocean_state_procures_opportunities,
    "tn_state_procurement": fetch_tn_edison_opportunities,
    "az_state_procurement": fetch_az_bidnet_opportunities,
    "id_state_procurement": fetch_id_bidnet_opportunities,
    "la_state_procurement": fetch_la_bidnet_opportunities,
    "md_state_procurement": fetch_md_bidnet_opportunities,
    "mi_state_procurement": fetch_mi_bidnet_opportunities,
    "ne_state_procurement": fetch_ne_bidnet_opportunities,
    "nc_state_procurement": fetch_nc_bidnet_opportunities,
    "nd_state_procurement": fetch_nd_bidnet_opportunities,
    "vt_state_procurement": fetch_vt_bidnet_opportunities,
}

GENERIC_CRAWLER_METADATA = {
    "adapter_kind": "generic",
    "maturity": "generic",
    "capabilities": ("query",),
}

BIDNET_FALLBACK_SOURCE_IDS = {
    "al_state_procurement",
    "ak_state_procurement",
    "az_state_procurement",
    "co_state_procurement",
    "id_state_procurement",
    "ky_state_procurement",
    "la_state_procurement",
    "md_state_procurement",
    "mi_state_procurement",
    "mn_state_procurement",
    "nc_state_procurement",
    "nd_state_procurement",
    "ne_state_procurement",
    "nh_state_procurement",
    "oh_state_procurement",
    "sc_state_procurement",
    "vt_state_procurement",
    "wi_state_procurement",
    "wv_state_procurement",
}

DEDICATED_CRAWLER_METADATA_BY_ID = {
    "al_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "ak_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "az_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "ar_state_procurement": ("beta", ("query", "detail_pages")),
    "ca_caleprocure": ("verified", ("query", "pagination")),
    "co_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "ct_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "de_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "fl_mfmp": ("verified", ("query", "detail_pages", "pagination")),
    "ga_state_procurement": ("beta", ("query", "detail_pages")),
    "hi_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "id_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "il_bidbuy": ("verified", ("query", "attachments", "detail_pages", "pagination")),
    "in_state_procurement": ("beta", ("query", "attachments")),
    "ia_state_procurement": ("beta", ("query", "detail_pages")),
    "ks_state_procurement": ("beta", ("query",)),
    "ky_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "la_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "me_state_procurement": ("beta", ("query", "attachments")),
    "md_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "ma_state_procurement": ("beta", ("query", "attachments")),
    "mi_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "mn_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "ms_state_procurement": ("beta", ("query", "attachments", "detail_pages")),
    "mo_state_procurement": ("beta", ("query", "attachments")),
    "mt_state_procurement": ("beta", ("query", "detail_pages")),
    "ne_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "nv_state_procurement": ("beta", ("query", "detail_pages")),
    "nh_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "nj_state_procurement": ("beta", ("query", "attachments")),
    "nm_state_procurement": ("beta", ("query",)),
    "ny_contract_reporter": ("verified", ("query", "detail_pages", "pagination")),
    "nc_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "nd_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "oh_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "ok_state_procurement": ("beta", ("query",)),
    "or_state_procurement": ("beta", ("query", "attachments")),
    "pa_state_procurement": ("beta", ("query", "attachments")),
    "ri_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "sc_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "sd_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "tn_state_procurement": ("beta", ("query", "detail_pages")),
    "tx_esbd": ("verified", ("query", "detail_pages", "pagination")),
    "ut_state_procurement": ("beta", ("query", "detail_pages")),
    "vt_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "va_state_procurement": ("beta", ("query", "attachments")),
    "wa_state_procurement": ("beta", ("query", "attachments")),
    "wv_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "wi_state_procurement": ("beta", ("query", "detail_pages", "pagination")),
    "wy_state_procurement": ("beta", ("query",)),
}


def _quality_metadata_for_source(source_id):
    dedicated_metadata = DEDICATED_CRAWLER_METADATA_BY_ID.get(source_id)
    if not dedicated_metadata:
        return GENERIC_CRAWLER_METADATA

    maturity, capabilities = dedicated_metadata
    return {
        "adapter_kind": "dedicated",
        "maturity": maturity,
        "capabilities": capabilities,
    }


def _validity_metadata_for_source(source_id, quality_metadata):
    if source_id in BIDNET_FALLBACK_SOURCE_IDS:
        return {
            "source_authority": "public_aggregator",
            "trust_status": "fallback",
            "evidence_mode": "aggregator_page",
            "validity_notes": (
                "Uses public aggregator opportunity pages when the official state route "
                "is unavailable, blocked, or not reliably machine-readable."
            ),
        }

    if quality_metadata["maturity"] == "verified":
        return {
            "source_authority": "official",
            "trust_status": "verified",
            "evidence_mode": "direct_portal",
            "validity_notes": "Verified public state procurement portal with deterministic parser coverage.",
        }

    return {
        "source_authority": "official",
        "trust_status": "beta",
        "evidence_mode": "direct_portal",
        "validity_notes": "Beta public state procurement portal parser requiring ongoing operator review before production approval.",
    }


def _build_source(state_code, source_id, label, base_url):
    quality_metadata = _quality_metadata_for_source(source_id)
    validity_metadata = _validity_metadata_for_source(source_id, quality_metadata)

    return Source(
        id=source_id,
        name=label,
        source_label=label,
        jurisdiction="state",
        state_code=state_code,
        fixture_loader=load_state_fixture_opportunities,
        live_fetcher=SPECIAL_FETCHERS.get(source_id, fetch_generic_state_opportunities),
        base_url=base_url,
        adapter_kind=quality_metadata["adapter_kind"],
        maturity=quality_metadata["maturity"],
        capabilities=quality_metadata["capabilities"],
        source_authority=validity_metadata["source_authority"],
        trust_status=validity_metadata["trust_status"],
        evidence_mode=validity_metadata["evidence_mode"],
        validity_notes=validity_metadata["validity_notes"],
    )


STATE_SOURCES = {
    source_id: _build_source(state_code, source_id, label, base_url)
    for state_code, source_id, label, base_url in STATE_SOURCE_DEFINITIONS
}
