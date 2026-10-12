import { createRegisteredSourceIndex, normalizeSourceIdentity, sourceIdentityDifferences } from "@/lib/source-identity";

export interface RegisteredSourceIdentity {
  id: string;
  label: string;
  issuerType: string;
  jurisdictionLevel?: string | null;
  stateCode: string;
  fipsCode?: string | null;
}

interface BidSourceIdentity {
  id: string;
  source: string;
  issuerType: string;
  jurisdictionLevel?: string | null;
  stateCode: string;
  fipsCode?: string | null;
}

/** Build once per read; canonical IDs take precedence over historical display labels. */
export function createRegisteredSourceIdentityGuard(sources: RegisteredSourceIdentity[]) {
  const index = createRegisteredSourceIndex(sources);
  return (bid: BidSourceIdentity): boolean => {
    const attribution = index.resolveBid(bid);
    // A legacy row outside registered attribution still uses the ordinary core gate.
    if (attribution.kind !== "registered") return attribution.kind === "unknown";
    const source = normalizeSourceIdentity(attribution.source);
    const level = source.jurisdictionLevel || source.issuerType;
    return sourceIdentityDifferences(bid, { ...source, issuerType: level, jurisdictionLevel: level }, "case-insensitive").length === 0;
  };
}
