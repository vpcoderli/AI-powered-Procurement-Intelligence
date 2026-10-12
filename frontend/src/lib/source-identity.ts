export interface SourceIdentity {
  id?: unknown;
  label?: unknown;
  source?: unknown;
  sourceBidId?: unknown;
  dedupeKey?: unknown;
  stateCode?: unknown;
  issuerType?: unknown;
  jurisdictionLevel?: unknown;
  fipsCode?: unknown;
}

export type IdentityField = "sourceBidId" | "dedupeKey" | "stateCode" | "issuerType" | "jurisdictionLevel" | "fipsCode";
export type RegisteredAttribution<Source> = { kind: "registered"; source: Source } | { kind: "ambiguous" | "unknown" };

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const comparisonFields: IdentityField[] = ["sourceBidId", "dedupeKey", "stateCode", "issuerType", "jurisdictionLevel", "fipsCode"];

/** Normalize text only. Stable identifiers and display labels are never case folded. */
export function normalizeSourceIdentity(identity: SourceIdentity): Record<keyof SourceIdentity, string> {
  return {
    id: text(identity.id), label: text(identity.label), source: text(identity.source),
    sourceBidId: text(identity.sourceBidId), dedupeKey: text(identity.dedupeKey),
    stateCode: text(identity.stateCode), issuerType: text(identity.issuerType),
    jurisdictionLevel: text(identity.jurisdictionLevel), fipsCode: text(identity.fipsCode),
  };
}

/** Missing optional fields do not conflict; callers choose exact or folded geography. */
export function sourceIdentityDifferences(actual: SourceIdentity, expected: SourceIdentity, comparison: "exact" | "case-insensitive" = "exact"): IdentityField[] {
  const left = normalizeSourceIdentity(actual);
  const right = normalizeSourceIdentity(expected);
  return comparisonFields.filter((field) => {
    if (!left[field] || !right[field]) return false;
    const exact = comparison === "exact" || field === "sourceBidId" || field === "dedupeKey";
    return exact ? left[field] !== right[field] : left[field].toUpperCase() !== right[field].toUpperCase();
  });
}

/** Inspect the ID intake will persist before admission, without changing quarantine evidence. */
export function effectiveImportBidId(identity: SourceIdentity, sourceId: string): string {
  const normalized = normalizeSourceIdentity(identity);
  return normalized.id || normalized.dedupeKey || `${sourceId}:${normalized.sourceBidId}`;
}

/** Expected registration constrains namespaced IDs; legacy nonnamespaced IDs remain permitted. */
export function matchesExpectedSourceNamespace(id: unknown, expectedSourceId: unknown): boolean {
  const actual = text(id);
  const expected = text(expectedSourceId);
  return !expected || !actual.includes(":") || actual.startsWith(`${expected}:`);
}

/** History uses the original persisted values, with no trimming or case folding. */
export function isCanonicalSourceBid(identity: SourceIdentity, sourceId: string): boolean {
  return identity.sourceBidId != null && identity.id === `${sourceId}:${identity.sourceBidId}`;
}

/** Build once per read. Bid attribution and run source keys deliberately use different resolution rules. */
export function createRegisteredSourceIndex<Source extends SourceIdentity>(sources: readonly Source[]) {
  const byId = new Map<string, Source>();
  const byLabel = new Map<string, Source[]>();
  for (const source of sources) {
    const identity = normalizeSourceIdentity(source);
    byId.set(identity.id, source);
    if (identity.label) byLabel.set(identity.label, [...(byLabel.get(identity.label) ?? []), source]);
  }
  const resolveSource = (value: unknown): RegisteredAttribution<Source> => {
    const key = text(value);
    const source = byId.get(key);
    if (source) return { kind: "registered", source };
    const labels = byLabel.get(key) ?? [];
    return labels.length === 1 ? { kind: "registered", source: labels[0] }
      : { kind: labels.length > 1 ? "ambiguous" : "unknown" };
  };
  return {
    resolveSource,
    resolveBid(bid: SourceIdentity): RegisteredAttribution<Source> {
      const identity = normalizeSourceIdentity(bid);
      const canonical = byId.get(identity.id.split(":")[0]);
      return canonical ? { kind: "registered", source: canonical } : resolveSource(identity.source);
    },
  };
}
