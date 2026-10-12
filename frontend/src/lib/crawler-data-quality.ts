/** Importer quality evidence. Execution success alone supplies none of these claims. */
export type CrawlerListCoverage = "complete" | "partial" | "unknown";
export type CrawlerContentStatus = "usable" | "partial" | "unusable" | "empty_verified" | "unknown";
export interface CrawlerQualityCounts {
  receivedCount: number | null;
  uniqueCount: number | null;
  acceptedCount: number | null;
  quarantinedCount: number | null;
  duplicateCount: number | null;
  validBodyCount: number | null;
  retainedBodyCount: number | null;
  fetchedBodyCount: number | null;
  analysisReadyCount: number | null;
}
export interface CrawlerQualityEvidence extends CrawlerQualityCounts {
  listCoverage: CrawlerListCoverage;
  contentStatus: CrawlerContentStatus;
  checkedAt: string | null;
  reconciliationBalanced: boolean | null;
}

export function qualityObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return qualityObject(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** A scoped or incomplete list cannot establish that this source has no open opportunities. */
export function hasSourceWideVerifiedEmpty(metadata: unknown): boolean {
  const parsed = qualityObject(metadata);
  const emptyState = qualityObject(parsed.emptyState);
  const pagination = qualityObject(parsed.pagination);
  return emptyState.verified === true && emptyState.tenant_confirmed === true &&
    Object.keys(qualityObject(parsed.dateFilter)).length === 0 &&
    (Object.keys(pagination).length === 0 || pagination.complete === true && (!pagination.list_kind || pagination.list_kind === "open"));
}

/** Missing, legacy or malformed evidence stays unknown. `enriched` never stands in for valid bodies. */
export function readCrawlerQualityEvidence(metadata: unknown): CrawlerQualityEvidence {
  const parsed = qualityObject(metadata);
  const raw = qualityObject(parsed.dataQuality);
  const counters = ["receivedCount", "uniqueCount", "acceptedCount", "quarantinedCount", "duplicateCount", "validBodyCount", "retainedBodyCount", "analysisReadyCount"].map((key) => count(raw[key]));
  const [received, unique, accepted, quarantined, duplicates, bodies, retained, analysis] = counters;
  const valid = raw.schemaVersion === 1 && counters.every((value) => value !== null) &&
    received! === unique! + duplicates! && unique! === accepted! + quarantined! &&
    bodies! <= accepted! && retained! <= bodies! && analysis! <= bodies! && qualityObject(raw.reconciliation).balanced === true;
  const validBodyCount = valid ? count(raw.validBodyCount) : null;
  const retainedBodyCount = valid ? count(raw.retainedBodyCount) : null;
  const verifiedEmpty = hasSourceWideVerifiedEmpty(parsed) && raw.execution === "success" && raw.receivedCount === 0 && raw.uniqueCount === 0;
  const contentStatus: CrawlerContentStatus = !valid || raw.execution !== "success" || raw.contentStatus === "empty_verified" && !verifiedEmpty ? "unknown"
    : unique! > 0 ? accepted === 0 ? "unusable" : quarantined! > 0 || bodies! < accepted! ? "partial" : "usable"
    : raw.contentStatus === "empty_verified" && verifiedEmpty ? "empty_verified" : "unknown";
  return {
    listCoverage: valid && raw.execution === "success" && quarantined! > 0 ? "partial" : valid && raw.execution === "success" && ["complete", "partial"].includes(String(raw.listCoverage)) ? raw.listCoverage as CrawlerListCoverage : "unknown",
    contentStatus,
    receivedCount: valid ? count(raw.receivedCount) : null,
    uniqueCount: valid ? count(raw.uniqueCount) : null,
    acceptedCount: valid ? count(raw.acceptedCount) : null,
    quarantinedCount: valid ? count(raw.quarantinedCount) : null,
    duplicateCount: valid ? count(raw.duplicateCount) : null,
    validBodyCount,
    retainedBodyCount,
    fetchedBodyCount: validBodyCount !== null && retainedBodyCount !== null && validBodyCount >= retainedBodyCount ? validBodyCount - retainedBodyCount : null,
    analysisReadyCount: valid ? count(raw.analysisReadyCount) : null,
    checkedAt: valid && typeof raw.checkedAt === "string" && Number.isFinite(Date.parse(raw.checkedAt)) ? raw.checkedAt : null,
    reconciliationBalanced: valid && typeof qualityObject(raw.reconciliation).balanced === "boolean" ? qualityObject(raw.reconciliation).balanced as boolean : null,
  };
}
