import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import {
  APPROVAL_BATCH_CHUNK_SIZE,
  NEEDS_FIX_LIST_LIMIT,
  approvableIds,
  approvalReasonKey,
  chunkSourceIds,
  needsFixList,
  providerFamiliesOf,
  suggestedAddressFor,
  tallyOutcomes,
} from "./LedgeredApprovalPanel";

describe("LedgeredApprovalPanel helpers", () => {
  it("chunks ids by 100 by default", () => {
    const ids = Array.from({ length: 250 }, (_, index) => `s${index}`);
    const chunks = chunkSourceIds(ids);
    expect(APPROVAL_BATCH_CHUNK_SIZE).toBe(100);
    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
    expect(chunkSourceIds([], 3)).toEqual([]);
  });

  it("collects approvable ids from a summary", () => {
    const summary = { providerFamily: "bidnet", platformReview: null, counts: { approvable: 1, awaiting_precheck: 1, needs_fix: 0, missing_platform_review: 0, approved: 0, blocked: 0 }, sources: [
      { id: "a", bucket: "approvable" }, { id: "b", bucket: "awaiting_precheck" },
    ] } as never;
    expect(approvableIds(summary)).toEqual(["a"]);
  });

  it("tallies outcomes across chunks", () => {
    const tally = tallyOutcomes([{ outcome: "approved", reason: null }, { outcome: "skipped", reason: "precheck_stale" }]);
    expect(tallyOutcomes([{ outcome: "skipped", reason: "precheck_stale" }], tally)).toEqual({ approved: 1, skipped: 2, byReason: { precheck_stale: 2 } });
  });

  it("lists local families with bidnet first", () => {
    expect(providerFamiliesOf([
      { providerFamily: "bonfire", jurisdictionLevel: "city" }, { providerFamily: "bidnet", jurisdictionLevel: "county" },
      { providerFamily: null, jurisdictionLevel: "state" }, { providerFamily: "bidnet", jurisdictionLevel: "township" },
    ])).toEqual(["bidnet", "bonfire"]);
  });

  it("never offers a display fallback family: it cannot be platform-reviewed", () => {
    expect(providerFamiliesOf([
      { providerFamily: "public_portal", jurisdictionLevel: "county" },
      { providerFamily: "state_portal", jurisdictionLevel: "city" },
      { providerFamily: "federal_portal", jurisdictionLevel: "township" },
      { providerFamily: "bidnet", jurisdictionLevel: "county" },
    ])).toEqual(["bidnet"]);
    expect(providerFamiliesOf([{ providerFamily: "public_portal", jurisdictionLevel: "county" }])).toEqual([]);
  });
});

describe("LedgeredApprovalPanel needs_fix and reason helpers", () => {
  const entry = (id: string, bucket: string) => ({ id, bucket, label: id, baseUrl: `https://portal.example/${id}`, suggestedBaseUrl: null });

  it("lists only needs_fix rows, capped, and says how many more there are", () => {
    const summary = { sources: [entry("a", "approvable"), entry("n1", "needs_fix"), entry("n2", "needs_fix"), entry("n3", "needs_fix")] } as never;
    expect(needsFixList(summary, 2)).toEqual({ entries: [entry("n1", "needs_fix"), entry("n2", "needs_fix")], hidden: 1 });
    expect(needsFixList(summary)).toMatchObject({ hidden: 0 });
    expect(NEEDS_FIX_LIST_LIMIT).toBe(50);
  });

  it("caps a long needs_fix list at the default limit", () => {
    const sources = Array.from({ length: 120 }, (_, index) => entry(`n${index}`, "needs_fix"));
    const { entries, hidden } = needsFixList({ sources } as never);
    expect(entries).toHaveLength(50);
    expect(hidden).toBe(70);
  });

  it("offers the tenant probe's address only when it is present and differs from the current one", () => {
    expect(suggestedAddressFor({ baseUrl: "https://a.example/x", suggestedBaseUrl: "https://a.example/y" })).toBe("https://a.example/y");
    expect(suggestedAddressFor({ baseUrl: null, suggestedBaseUrl: " https://a.example/y " })).toBe("https://a.example/y");
    expect(suggestedAddressFor({ baseUrl: "https://a.example/x", suggestedBaseUrl: "https://a.example/x" })).toBeNull();
    expect(suggestedAddressFor({ baseUrl: "https://a.example/x", suggestedBaseUrl: "  " })).toBeNull();
    expect(suggestedAddressFor({ baseUrl: "https://a.example/x", suggestedBaseUrl: null })).toBeNull();
  });

  it("maps every reason the console has a sentence for and leaves the rest to the raw string", () => {
    const known = [
      "missing_platform_review", "platform_review_expired", "precheck_missing", "precheck_stale",
      "precheck_needs_fix", "base_url_changed", "already_approved", "blocked",
      "held", "disabled", "login_requirements_unmet", "precheck_queued", "precheck_superseded",
    ];
    for (const reason of known) {
      const key = approvalReasonKey(reason);
      expect(key).toBe(`admin.ledgeredApprovalReason_${reason}`);
      // Both languages carry the sentence, and the Chinese one is really translated.
      const leaf = `ledgeredApprovalReason_${reason}`;
      const enText = (en.admin as Record<string, string>)[leaf];
      const zhText = (zh.admin as Record<string, string>)[leaf];
      expect(enText).toBeTruthy();
      expect(zhText).toBeTruthy();
      expect(zhText).not.toBe(enText);
    }
    expect(approvalReasonKey("not_local")).toBeNull();
    expect(approvalReasonKey("not_found")).toBeNull();
    expect(approvalReasonKey(null)).toBeNull();
  });

  it("tallies a skipped row without a reason under its outcome", () => {
    expect(tallyOutcomes([{ outcome: "not_found", reason: null }])).toEqual({ approved: 0, skipped: 1, byReason: { not_found: 1 } });
  });
});
