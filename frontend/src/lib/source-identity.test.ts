import { describe, expect, it } from "vitest";
import { createRegisteredSourceIndex, effectiveImportBidId, isCanonicalSourceBid, normalizeSourceIdentity, sourceIdentityDifferences } from "./source-identity";

describe("source identity", () => {
  it("trims text while preserving stable ID and label case", () => {
    expect(normalizeSourceIdentity({ id: " City:One ", sourceBidId: " One ", source: " City Agency ", stateCode: " il ", fipsCode: null }))
      .toMatchObject({ id: "City:One", sourceBidId: "One", source: "City Agency", stateCode: "il", fipsCode: "" });
  });

  it("compares only nonblank fields, with exact stable IDs under either geography comparison", () => {
    const actual = { sourceBidId: "One", dedupeKey: "City:One", stateCode: "il", issuerType: "city", jurisdictionLevel: "city" };
    const expected = { sourceBidId: "one", dedupeKey: "city:one", stateCode: "IL", issuerType: "CITY", jurisdictionLevel: "CITY", fipsCode: "1714000" };
    expect(sourceIdentityDifferences(actual, expected)).toEqual(["sourceBidId", "dedupeKey", "stateCode", "issuerType", "jurisdictionLevel"]);
    expect(sourceIdentityDifferences(actual, expected, "case-insensitive")).toEqual(["sourceBidId", "dedupeKey"]);
    expect(sourceIdentityDifferences({ stateCode: "", fipsCode: null }, expected)).toEqual([]);
  });

  it.each([
    [{ id: " city:One ", dedupeKey: "other:One" }, "city:One"],
    [{ id: "", dedupeKey: " other:One " }, "other:One"],
    [{ id: "", sourceBidId: " One " }, "city:One"],
    [{ id: "", dedupeKey: "legacy" }, "legacy"],
  ])("derives the same intake ID as persistence (%j)", (identity, expected) => {
    expect(effectiveImportBidId(identity, "city")).toBe(expected);
  });

  it("requires the exact unmodified canonical ID and a non-null source bid ID for history", () => {
    expect(isCanonicalSourceBid({ id: "city:One", sourceBidId: "One" }, "city")).toBe(true);
    expect(isCanonicalSourceBid({ id: "city:1", sourceBidId: 1 }, "city")).toBe(true);
    for (const identity of [{ id: "city:one", sourceBidId: "One" }, { id: "city: One", sourceBidId: "One" },
      { id: "legacy", sourceBidId: "One" }, { id: "city:null", sourceBidId: null }]) {
      expect(isCanonicalSourceBid(identity, "city")).toBe(false);
    }
  });

  it("resolves canonical first-prefix IDs before exact source IDs and unique exact labels", () => {
    const city = { id: "city", label: " City Agency " };
    const other = { id: "other", label: "Other Agency" };
    const index = createRegisteredSourceIndex([city, other]);
    expect(index.resolveBid({ id: " city:One:part ", source: "other" })).toEqual({ kind: "registered", source: city });
    expect(index.resolveBid({ id: "legacy", source: " other " })).toEqual({ kind: "registered", source: other });
    expect(index.resolveBid({ id: "legacy", source: "City Agency" })).toEqual({ kind: "registered", source: city });
    expect(index.resolveBid({ id: "legacy", source: "city agency" })).toEqual({ kind: "unknown" });
    expect(index.resolveBid({ id: "CITY:One", source: "unregistered" })).toEqual({ kind: "unknown" });
  });

  it("marks ambiguous labels unresolved while canonical IDs and exact registered IDs still resolve", () => {
    const city = { id: "city", label: "Agency" };
    const other = { id: "other", label: "Agency" };
    const index = createRegisteredSourceIndex([city, other]);
    expect(index.resolveBid({ id: "legacy", source: "Agency" })).toEqual({ kind: "ambiguous" });
    expect(index.resolveBid({ id: "city:One", source: "Agency" })).toEqual({ kind: "registered", source: city });
    expect(index.resolveBid({ id: "legacy", source: "other" })).toEqual({ kind: "registered", source: other });
  });

  it("resolves run source keys by exact ID or unique label without interpreting bid prefixes", () => {
    const city = { id: "city", label: "Agency" };
    const index = createRegisteredSourceIndex([city]);
    expect(index.resolveSource(" city ")).toEqual({ kind: "registered", source: city });
    expect(index.resolveSource(" Agency ")).toEqual({ kind: "registered", source: city });
    expect(index.resolveSource("city:One")).toEqual({ kind: "unknown" });
  });
});
