import { getBidDescription } from "./bid-description";
import { ISSUER_TYPES } from "./issuer-types";
import { STATE_FIPS } from "./state-fips";

export interface BidCoreFields {
  id?: string | null;
  title?: string | null;
  issuerName?: string | null;
  issuerType?: string | null;
  stateCode?: string | null;
  sourceUrl?: string | null;
  sourceBidId?: string | null;
  dedupeKey?: string | null;
  jurisdictionLevel?: string | null;
  fipsCode?: string | null;
  qualityFlags?: string[];
}

export interface BidDataQuality {
  schemaVersion: number;
  checkedAt: string;
  coreValid: boolean;
  coreIssues: string[];
  capabilities: { discovery: boolean; analysis: boolean; attachments: boolean };
  body: { valid: boolean; reason: string; verifiedAt: string | null; reused: boolean };
  attachments: { discovered: number; archived: number; verified: number };
}

export function getBidCoreIssues(bid: BidCoreFields): string[] {
  const issues: string[] = [];
  const stableIdentity = (value: string | null | undefined) => Boolean(value?.trim() && !/(?:^|:)(?:unknown|null|undefined)$/i.test(value.trim()));
  if (![bid.id, bid.sourceBidId, bid.dedupeKey].some(stableIdentity)
    || [bid.id, bid.sourceBidId, bid.dedupeKey].some((value) => value?.trim() && !stableIdentity(value))) issues.push("missing_identity");
  if (!bid.title?.trim() || /^Untitled(?:\s|$)/i.test(bid.title.trim())) issues.push("invalid_title");
  if (!bid.issuerName?.trim() || /^Unknown(?:\s|$)/i.test(bid.issuerName.trim())) issues.push("invalid_issuer");
  const issuer = bid.issuerType?.trim() ?? "";
  if (!ISSUER_TYPES.some((type) => type === issuer)) issues.push("invalid_issuer_type");
  const state = bid.stateCode?.trim().toUpperCase() ?? "";
  if (!(state in STATE_FIPS) && !(state === "US" && issuer === "federal")) issues.push("invalid_state_code");
  if (bid.jurisdictionLevel && bid.jurisdictionLevel !== issuer) issues.push("jurisdiction_mismatch");
  if (bid.fipsCode?.trim()) {
    const fips = bid.fipsCode.trim();
    const length = { state: 2, county: 5, city: 7, township: 10 }[issuer as "state" | "county" | "city" | "township"];
    if (!/^\d+$/.test(fips) || (length && fips.length !== length) || (STATE_FIPS[state] && !fips.startsWith(STATE_FIPS[state]))) {
      issues.push("invalid_fips_code");
    }
  }
  try {
    const url = new URL(bid.sourceUrl?.trim() ?? "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || [...url.searchParams.keys()].some((key) => /^(?:api[_-]?key|access[_-]?token|authorization|password|client[_-]?secret)$/i.test(key))) {
      issues.push("invalid_source_url");
    }
    if (bid.qualityFlags?.includes("missing_source_url")
      || (url.pathname === "/" && !url.search && !url.hash && !bid.sourceBidId?.trim() && !bid.dedupeKey?.trim())) {
      issues.push("missing_source_locator");
    }
  } catch {
    issues.push("invalid_source_url");
  }
  return issues;
}

/** A discovered URL alone is never evidence of an archived, verified file. */
export function isVerifiedBidAttachment(file: {
  archiveStatus?: string; storagePath?: string; checksumSha256?: string; byteSize?: number | null;
  contentType?: string; verifiedAt?: string | null;
}): boolean {
  return file.archiveStatus === "archived" && Boolean(file.storagePath?.trim())
    && /^[a-f\d]{64}$/i.test(file.checksumSha256 ?? "") && Number(file.byteSize) > 0
    && Boolean(file.verifiedAt && Number.isFinite(Date.parse(file.verifiedAt)))
    && !/text\/html|application\/xhtml/i.test(file.contentType ?? "");
}

export function isBidDiscoverable(bid: BidCoreFields): boolean {
  return getBidCoreIssues(bid).length === 0;
}

/** Persisted quality is evidence; recheck the actual fields so old or edited records stay safe. */
export function getBidUsability(bid: BidCoreFields & {
  description?: string | null;
  fullDescription?: string | null;
  dataQuality?: BidDataQuality | null;
}) {
  const quality = bid.dataQuality;
  const discovery = isBidDiscoverable(bid) && quality?.coreValid !== false && quality?.capabilities.discovery !== false;
  const body = getBidDescription(bid);
  const analysis = discovery && Boolean(body) && quality?.body.valid !== false && quality?.capabilities.analysis !== false;
  return {
    discovery,
    analysis,
    body,
    bodyStatus: !body ? "missing" as const : !analysis ? "pending" as const : "ready" as const,
    bodyVerifiedAt: quality?.body.verifiedAt ?? null,
    bodyReused: quality?.body.reused ?? false,
  };
}

export function bidDataQualityFromRawPayload(rawPayload: string | null | undefined): BidDataQuality | null {
  if (!rawPayload) return null;
  try {
    const value = JSON.parse(rawPayload)?.data_quality;
    if (value?.schemaVersion !== 1 || typeof value.checkedAt !== "string" || typeof value?.coreValid !== "boolean"
      || !Array.isArray(value.coreIssues) || !value.coreIssues.every((issue: unknown) => typeof issue === "string")
      || typeof value?.capabilities?.discovery !== "boolean" || typeof value?.capabilities?.analysis !== "boolean"
      || typeof value?.capabilities?.attachments !== "boolean" || typeof value?.body?.valid !== "boolean"
      || typeof value.body.reason !== "string" || typeof value.body.reused !== "boolean"
      || (value.body.verifiedAt !== null && (typeof value.body.verifiedAt !== "string" || !Number.isFinite(Date.parse(value.body.verifiedAt))))
      || ![value.attachments?.discovered, value.attachments?.archived, value.attachments?.verified]
        .every((count) => typeof count === "number" && Number.isInteger(count) && count >= 0)) return null;
    return value as BidDataQuality;
  } catch {
    return null;
  }
}

export class BidAnalysisUnavailableError extends Error {
  readonly code = "BID_ANALYSIS_UNAVAILABLE";
  constructor() {
    super("A valid procurement description is required before analysis.");
    this.name = "BidAnalysisUnavailableError";
  }
}
