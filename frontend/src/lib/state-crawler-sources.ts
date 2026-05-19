export const STATE_CRAWLER_SOURCE_IDS_BY_STATE: Record<string, string> = {
  CA: "ca_caleprocure",
  TX: "tx_esbd",
  NY: "ny_contract_reporter",
  FL: "fl_mfmp",
  IL: "il_bidbuy",
};

export function stateCrawlerSourceIdForAdminSource(source: { issuerType: string; stateCode: string }) {
  if (source.issuerType !== "state") return null;

  return STATE_CRAWLER_SOURCE_IDS_BY_STATE[source.stateCode] ?? null;
}
