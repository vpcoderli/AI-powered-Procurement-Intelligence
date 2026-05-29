type StateCrawlerSourceDefinition = {
  stateCode: string;
  id: string;
  label: string;
  baseUrl: string;
};

export type CrawlerAdapterKind = "dedicated" | "generic" | "none";
export type CrawlerMaturity = "verified" | "beta" | "generic" | "none";
export type CrawlerCapability = "query" | "attachments" | "detail_pages" | "pagination";

const STATE_CRAWLER_SOURCE_DEFINITIONS = [
  { stateCode: "AL", id: "al_state_procurement", label: "Alabama State Procurement", baseUrl: "https://purchasing.alabama.gov" },
  { stateCode: "AK", id: "ak_state_procurement", label: "Alaska State Procurement", baseUrl: "https://aws.state.ak.us/OnlinePublicNotices" },
  { stateCode: "AZ", id: "az_state_procurement", label: "Arizona State Procurement", baseUrl: "https://app.az.gov" },
  { stateCode: "AR", id: "ar_state_procurement", label: "Arkansas State Procurement", baseUrl: "https://www.arkansas.gov/dfa/procurement" },
  { stateCode: "CA", id: "ca_caleprocure", label: "California Cal eProcure", baseUrl: "https://caleprocure.ca.gov" },
  { stateCode: "CO", id: "co_state_procurement", label: "Colorado State Procurement", baseUrl: "https://www.bidnetdirect.com/colorado" },
  { stateCode: "CT", id: "ct_state_procurement", label: "Connecticut State Contracting Portal", baseUrl: "https://portal.ct.gov/das/ctsource" },
  { stateCode: "DE", id: "de_state_procurement", label: "Delaware State Procurement", baseUrl: "https://mymarketplace.delaware.gov" },
  { stateCode: "FL", id: "fl_mfmp", label: "MyFloridaMarketPlace", baseUrl: "https://vendor.myfloridamarketplace.com" },
  { stateCode: "GA", id: "ga_state_procurement", label: "Georgia State Procurement Registry", baseUrl: "https://ssl.doas.state.ga.us/gpr" },
  { stateCode: "HI", id: "hi_state_procurement", label: "Hawaii State Procurement", baseUrl: "https://hands.ehawaii.gov/hands" },
  { stateCode: "ID", id: "id_state_procurement", label: "Idaho State Procurement", baseUrl: "https://purchasing.idaho.gov" },
  { stateCode: "IL", id: "il_bidbuy", label: "Illinois BidBuy", baseUrl: "https://www.bidbuy.illinois.gov" },
  { stateCode: "IN", id: "in_state_procurement", label: "Indiana State Procurement", baseUrl: "https://www.in.gov/idoa/procurement" },
  { stateCode: "IA", id: "ia_state_procurement", label: "Iowa State Procurement", baseUrl: "https://bidopportunities.iowa.gov" },
  { stateCode: "KS", id: "ks_state_procurement", label: "Kansas State Procurement", baseUrl: "https://admin.ks.gov/offices/procurement-contracts" },
  { stateCode: "KY", id: "ky_state_procurement", label: "Kentucky State Procurement", baseUrl: "https://vss.ky.gov" },
  { stateCode: "LA", id: "la_state_procurement", label: "Louisiana State Procurement", baseUrl: "https://wwwcfprd.doa.louisiana.gov/osp/lapac" },
  { stateCode: "ME", id: "me_state_procurement", label: "Maine State Procurement", baseUrl: "https://www.maine.gov/dafs/bbm/procurementservices" },
  { stateCode: "MD", id: "md_state_procurement", label: "Maryland State Procurement", baseUrl: "https://emma.maryland.gov" },
  { stateCode: "MA", id: "ma_state_procurement", label: "Massachusetts COMMBUYS", baseUrl: "https://www.commbuys.com" },
  { stateCode: "MI", id: "mi_state_procurement", label: "Michigan State Procurement", baseUrl: "https://www.michigan.gov/dtmb/procurement" },
  { stateCode: "MN", id: "mn_state_procurement", label: "Minnesota State Procurement", baseUrl: "https://mn.gov/admin/osp" },
  { stateCode: "MS", id: "ms_state_procurement", label: "Mississippi State Procurement", baseUrl: "https://www.dfa.ms.gov/procurement" },
  { stateCode: "MO", id: "mo_state_procurement", label: "Missouri State Procurement", baseUrl: "https://oa.mo.gov/purchasing" },
  { stateCode: "MT", id: "mt_state_procurement", label: "Montana State Procurement", baseUrl: "https://spb.mt.gov" },
  { stateCode: "NE", id: "ne_state_procurement", label: "Nebraska State Procurement", baseUrl: "https://das.nebraska.gov/materiel/purchasing" },
  { stateCode: "NV", id: "nv_state_procurement", label: "Nevada State Procurement", baseUrl: "https://purchasing.nv.gov" },
  { stateCode: "NH", id: "nh_state_procurement", label: "New Hampshire State Procurement", baseUrl: "https://das.nh.gov/purchasing" },
  { stateCode: "NJ", id: "nj_state_procurement", label: "New Jersey State Procurement", baseUrl: "https://www.njstart.gov" },
  { stateCode: "NM", id: "nm_state_procurement", label: "New Mexico State Procurement", baseUrl: "https://www.generalservices.state.nm.us/state-purchasing" },
  { stateCode: "NY", id: "ny_contract_reporter", label: "New York State Contract Reporter", baseUrl: "https://www.nyscr.ny.gov" },
  { stateCode: "NC", id: "nc_state_procurement", label: "North Carolina State Procurement", baseUrl: "https://www.ips.state.nc.us" },
  { stateCode: "ND", id: "nd_state_procurement", label: "North Dakota State Procurement", baseUrl: "https://apps.nd.gov/csd/spo/services/bidder/main.htm" },
  { stateCode: "OH", id: "oh_state_procurement", label: "Ohio State Procurement", baseUrl: "https://procure.ohio.gov" },
  { stateCode: "OK", id: "ok_state_procurement", label: "Oklahoma State Procurement", baseUrl: "https://oklahoma.gov/omes/services/purchasing" },
  { stateCode: "OR", id: "or_state_procurement", label: "Oregon State Procurement", baseUrl: "https://oregonbuys.gov" },
  { stateCode: "PA", id: "pa_state_procurement", label: "Pennsylvania eMarketplace", baseUrl: "https://www.emarketplace.state.pa.us" },
  { stateCode: "RI", id: "ri_state_procurement", label: "Rhode Island State Procurement", baseUrl: "https://ridop.ri.gov" },
  { stateCode: "SC", id: "sc_state_procurement", label: "South Carolina Business Opportunities", baseUrl: "https://procurement.sc.gov" },
  { stateCode: "SD", id: "sd_state_procurement", label: "South Dakota State Procurement", baseUrl: "https://boa.sd.gov/procurement" },
  { stateCode: "TN", id: "tn_state_procurement", label: "Tennessee State Procurement", baseUrl: "https://www.tn.gov/generalservices/procurement.html" },
  { stateCode: "TX", id: "tx_esbd", label: "Texas ESBD", baseUrl: "https://www.txsmartbuy.gov/esbd" },
  { stateCode: "UT", id: "ut_state_procurement", label: "Utah State Procurement", baseUrl: "https://purchasing.utah.gov" },
  { stateCode: "VT", id: "vt_state_procurement", label: "Vermont State Procurement", baseUrl: "https://bgs.vermont.gov/purchasing-contracting" },
  { stateCode: "VA", id: "va_state_procurement", label: "Virginia eVA", baseUrl: "https://eva.virginia.gov" },
  { stateCode: "WA", id: "wa_state_procurement", label: "Washington State Procurement", baseUrl: "https://pr-webs-vendor.des.wa.gov" },
  { stateCode: "WV", id: "wv_state_procurement", label: "West Virginia State Procurement", baseUrl: "https://www.state.wv.us/admin/purchase" },
  { stateCode: "WI", id: "wi_state_procurement", label: "Wisconsin State Procurement", baseUrl: "https://vendornet.wi.gov" },
  { stateCode: "WY", id: "wy_state_procurement", label: "Wyoming State Procurement", baseUrl: "https://ai.wyo.gov/divisions/procurement" },
] as const satisfies readonly StateCrawlerSourceDefinition[];

type StateCrawlerSourceDefinitionId = (typeof STATE_CRAWLER_SOURCE_DEFINITIONS)[number]["id"];

type CrawlerMetadata = {
  adapterKind: Exclude<CrawlerAdapterKind, "none">;
  maturity: Exclude<CrawlerMaturity, "none">;
  capabilities: readonly CrawlerCapability[];
};

const GENERIC_CRAWLER_METADATA = {
  adapterKind: "generic",
  maturity: "generic",
  capabilities: ["query"],
} as const satisfies CrawlerMetadata;

const DEDICATED_CRAWLER_METADATA_BY_ID: Partial<Record<StateCrawlerSourceDefinitionId, CrawlerMetadata>> = {
  al_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  ak_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  az_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  ca_caleprocure: {
    adapterKind: "dedicated",
    maturity: "verified",
    capabilities: ["query", "pagination"],
  },
  ar_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages"],
  },
  co_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  ct_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  de_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  fl_mfmp: {
    adapterKind: "dedicated",
    maturity: "verified",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  il_bidbuy: {
    adapterKind: "dedicated",
    maturity: "verified",
    capabilities: ["query", "attachments", "detail_pages", "pagination"],
  },
  ia_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages"],
  },
  id_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  in_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "attachments"],
  },
  ks_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query"],
  },
  ky_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  la_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  md_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  ga_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages"],
  },
  hi_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  me_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "attachments"],
  },
  ma_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "attachments"],
  },
  mo_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "attachments"],
  },
  ms_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "attachments", "detail_pages"],
  },
  mt_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages"],
  },
  mn_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  nm_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query"],
  },
  nh_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  nc_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  nd_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  ne_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  nj_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "attachments"],
  },
  nv_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages"],
  },
  ny_contract_reporter: {
    adapterKind: "dedicated",
    maturity: "verified",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  oh_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "attachments"],
  },
  ok_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query"],
  },
  or_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "attachments"],
  },
  pa_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "attachments"],
  },
  ri_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  sc_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "attachments"],
  },
  sd_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  tn_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages"],
  },
  tx_esbd: {
    adapterKind: "dedicated",
    maturity: "verified",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  ut_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages"],
  },
  va_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "attachments"],
  },
  vt_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  wa_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "attachments"],
  },
  wi_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  wv_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query", "detail_pages", "pagination"],
  },
  wy_state_procurement: {
    adapterKind: "dedicated",
    maturity: "beta",
    capabilities: ["query"],
  },
};

function metadataForSourceId(id: StateCrawlerSourceDefinitionId): CrawlerMetadata {
  return DEDICATED_CRAWLER_METADATA_BY_ID[id] ?? GENERIC_CRAWLER_METADATA;
}

export const STATE_CRAWLER_SOURCES = STATE_CRAWLER_SOURCE_DEFINITIONS.map((source) => ({
  ...source,
  ...metadataForSourceId(source.id),
})) as readonly ((typeof STATE_CRAWLER_SOURCE_DEFINITIONS)[number] & CrawlerMetadata)[];

export type StateCrawlerSourceId = StateCrawlerSourceDefinitionId;
export type StateCrawlerSourceMetadata = (typeof STATE_CRAWLER_SOURCES)[number];

export const STATE_CRAWLER_SOURCE_IDS_BY_STATE: Record<string, StateCrawlerSourceId> =
  Object.fromEntries(STATE_CRAWLER_SOURCES.map((source) => [source.stateCode, source.id])) as Record<
    string,
    StateCrawlerSourceId
  >;

export const STATE_CRAWLER_SOURCES_BY_STATE: Record<string, StateCrawlerSourceMetadata> =
  Object.fromEntries(STATE_CRAWLER_SOURCES.map((source) => [source.stateCode, source])) as Record<
    string,
    StateCrawlerSourceMetadata
  >;

export function stateCrawlerSourceIdForAdminSource(source: { issuerType: string; stateCode: string }) {
  if (source.issuerType !== "state") return null;

  return STATE_CRAWLER_SOURCE_IDS_BY_STATE[source.stateCode] ?? null;
}

export function getStateCrawlerSourceMetadata(stateCode: string) {
  return STATE_CRAWLER_SOURCES_BY_STATE[stateCode] ?? null;
}
