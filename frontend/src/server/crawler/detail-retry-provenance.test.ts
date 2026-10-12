import { describe, expect, it } from "vitest";
import { mergePersistedBid } from "./persistence-merge";

// Consumer half of P0-2: when a detail retry applied nothing (`applied_fields: []`), the importer
// keeps the verified body even though the list page offered a shorter summary.
const existing = {
  id: "il_bidbuy:22-118",
  title: "Storm sewer replacement - Phase 2",
  description: "Storm sewer replacement, Phase 2: furnish and install 2,400 linear feet of storm sewer.",
  full_description: "Storm sewer replacement, Phase 2: furnish and install 2,400 linear feet of storm sewer. Includes trench restoration, inlet reconstruction and traffic control for twelve weeks.",
  detail_fetched_at: "2026-09-01T00:00:00Z",
  raw_payload: JSON.stringify({ enrichment: { applied_fields: ["description", "full_description"], persisted_fields: ["description", "full_description"] } }),
};

describe("a failed detail retry never replaces a verified body", () => {
  it("keeps the stored description and full description when the retry applied nothing", () => {
    const failedRetry = {
      id: existing.id,
      title: existing.title,
      description: "Storm sewer replacement.",
      full_description: null,
      raw_payload: { enrichment: { applied_fields: [], persisted_fields: ["description", "full_description"],
        outcome: { status: "failure", reason: "ConnectionError", attempted: true } } },
    };
    const merged = mergePersistedBid(failedRetry, existing);
    expect(merged.description).toBe(existing.description);
    expect(merged.full_description).toBe(existing.full_description);
  });
});
