from apsi_crawler.sources.base import Source
from apsi_crawler.spiders.ca_caleprocure import fetch_ca_caleprocure_opportunities
from apsi_crawler.spiders.co_bidnet import fetch_co_bidnet_opportunities
from apsi_crawler.spiders.ct_ctsource import fetch_ct_ctsource_opportunities
from apsi_crawler.spiders.fl_mfmp import fetch_fl_mfmp_opportunities
from apsi_crawler.spiders.ga_procurement_registry import (
    fetch_ga_procurement_registry_opportunities,
)
from apsi_crawler.spiders.generic_state import fetch_generic_state_opportunities
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
from apsi_crawler.spiders.oh_procure import fetch_oh_procure_opportunities
from apsi_crawler.spiders.or_oregonbuys import fetch_or_oregonbuys_opportunities
from apsi_crawler.spiders.pa_emarketplace import fetch_pa_emarketplace_opportunities
from apsi_crawler.spiders.sc_business_opportunities import fetch_sc_business_opportunities
from apsi_crawler.spiders.state_fixture import load_state_fixture_opportunities
from apsi_crawler.spiders.tx_esbd import fetch_tx_esbd_opportunities
from apsi_crawler.spiders.ut_bonfire import fetch_ut_bonfire_opportunities
from apsi_crawler.spiders.va_eva import fetch_va_eva_opportunities
from apsi_crawler.spiders.wa_des import fetch_wa_des_opportunities


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
    ("MS", "ms_state_procurement", "Mississippi State Procurement", "https://www.dfa.ms.gov/procurement"),
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
    ("OH", "oh_state_procurement", "Ohio State Procurement", "https://procure.ohio.gov"),
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
    ("WY", "wy_state_procurement", "Wyoming State Procurement", "https://ai.wyo.gov/divisions/procurement"),
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
    "oh_state_procurement": fetch_oh_procure_opportunities,
    "pa_state_procurement": fetch_pa_emarketplace_opportunities,
    "sc_state_procurement": fetch_sc_business_opportunities,
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
}


def _build_source(state_code, source_id, label, base_url):
    return Source(
        id=source_id,
        name=label,
        source_label=label,
        jurisdiction="state",
        state_code=state_code,
        fixture_loader=load_state_fixture_opportunities,
        live_fetcher=SPECIAL_FETCHERS.get(source_id, fetch_generic_state_opportunities),
        base_url=base_url,
    )


STATE_SOURCES = {
    source_id: _build_source(state_code, source_id, label, base_url)
    for state_code, source_id, label, base_url in STATE_SOURCE_DEFINITIONS
}
