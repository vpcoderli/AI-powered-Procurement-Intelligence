import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bidQaCorrectionDraftFor, bidQaCorrectionsFor, bidQaRequestFor, DEFAULT_BID_QA_FILTERS, type BidQaCorrectionDraft } from "./BidQaSection";

describe("bid QA section", () => {
  it("builds the QA list request from the filters", () => {
    expect(bidQaRequestFor(DEFAULT_BID_QA_FILTERS)).toEqual({
      limit: 10,
      q: undefined,
      stateCode: undefined,
      reviewStatus: undefined,
      displayStatus: undefined,
      sourceConfidence: undefined,
      minQualityScore: undefined,
      maxQualityScore: undefined,
      reviewerId: undefined,
      reviewedFrom: undefined,
      reviewedTo: undefined,
    });
    const request = bidQaRequestFor({
      ...DEFAULT_BID_QA_FILTERS,
      stateCode: " co ",
      minQualityScore: "40",
      reviewedFrom: "2026-09-01",
      reviewedTo: "2026-09-29",
    });
    expect(request.stateCode).toBe("CO");
    expect(request.minQualityScore).toBe(40);
    expect(request.reviewedFrom).toBe("2026-09-01T00:00:00.000Z");
    expect(request.reviewedTo).toBe("2026-09-29T23:59:59.999Z");
  });

  it("owns its list and reloads it for a filter change or after a review action", () => {
    const source = readFileSync(new URL("BidQaSection.tsx", import.meta.url), "utf8");
    expect(source.startsWith('"use client"')).toBe(true);
    expect(source).toContain("listAdminBidQaItems(bidQaRequestFor(bidQaFilters))");
    expect(source).toContain("useAdminResource(loadBidQa)");
    expect(source).toContain("qa.reload()");
    expect(source).not.toContain("refreshBidQa");
  });

  it("follows the resource render rule and keeps review actions behind the operations role", () => {
    const source = readFileSync(new URL("BidQaSection.tsx", import.meta.url), "utf8");
    expect(source).toContain('code="error"');
    expect(source).toContain('code="loading"');
    expect(source).toContain('t("admin.sectionRefreshFailed")');
    expect(source).toContain("useAdminSession()");
    expect(source).toContain("{canRunOperations && (");
    expect(source).toContain("<AdminNotice message={notice} />");
    expect(source).not.toContain("setRunMessage");
  });

  // A bid's deadline is stored as the portal gave it: "2026-07-10" for most rows. formatDate printed that as "Jul 10, 08:00 AM"
  // (no year, a midnight UTC shown as 08:00 in UTC+8, and the day before west of UTC); formatBidDate keeps a calendar day a day.
  it("prints the deadline column with formatBidDate and keeps formatDate for the correction's own time", () => {
    const source = readFileSync(new URL("BidQaSection.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/import \{[^}]*\bformatBidDate\b[^}]*\} from "\.\.\/admin-format";/);
    expect(source).toContain("<TableCell>{formatBidDate(item.deadlineDate)}</TableCell>");
    expect(source).not.toContain("formatDate(item.deadlineDate)");
    // A correction's correctedAt is a real timestamp.
    expect(source).toContain("formatDate(correction.correctedAt)");
  });

  // The route answers 400 to an empty `corrections`, and the server logs a correction for every value that differs from the
  // stored string, so the save sends the fields the admin changed and nothing else.
  it("saves only the changed fields and keeps Save corrections disabled while nothing has changed", () => {
    const source = readFileSync(new URL("BidQaSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("const corrections = bidQaCorrectionsFor(item, bidQaCorrectionDraftFor(item, correctionDrafts));");
    expect(source).toContain("if (!corrections) return;");
    expect(source).toMatch(/updateAdminBidQaReview\(item\.id, \{\s*corrections,\s*note: "Admin QA correction",?\s*\}\)/);
    // The request used to be built inline, always with both fields.
    expect(source).not.toMatch(/corrections: \{\s*title: draft\.title\.trim\(\)/);
    expect(source).toContain("const corrections = bidQaCorrectionsFor(item, correctionDraft);");
    expect(source).toContain("disabled={isPending || correctionDraft.title.trim().length === 0 || corrections === null}");
  });

  // Moved from src/app/admin/page.test.ts ("renders user access controls alongside crawler operations").
  it("keeps the bid QA review controls it took over from the dashboard page", () => {
    const source = readFileSync(new URL("BidQaSection.tsx", import.meta.url), "utf8");

    expect(source).toContain("listAdminBidQaItems");
    expect(source).toContain("getAdminBidQaCorrections");
    expect(source).toContain("batchUpdateAdminBidQaItems");
    expect(source).toContain("updateAdminBidQaReview");
    expect(source).toContain('t("admin.bidQa")');
    expect(source).toContain('t("admin.qualityScore")');
    expect(source).toContain('t("admin.archiveIssues")');
    expect(source).toContain('t("admin.markReviewed")');
    expect(source).toContain('t("admin.displayStatus")');
    expect(source).toContain('t("admin.publishBid")');
    expect(source).toContain('t("admin.suppressBid")');
    expect(source).toContain('t("admin.saveCorrections")');
    expect(source).toContain('t("admin.batchReview")');
    expect(source).toContain('t("admin.qaFilters")');
    expect(source).toContain('t("admin.reviewedTo")');
    expect(source).toContain('t("admin.correctionHistory")');
    expect(source).toContain("bidQaFilters");
    expect(source).toContain("selectedBidQaIds");
    expect(source).toContain("visibleSelectedBidQaIds");
    expect(source).toContain("setSelectedBidQaIds([])");
    expect(source).toContain("correctionHistoryBidId");
    expect(source).toContain("correctionDrafts");
    expect(source).toContain("displayStatus");
    expect(source).toContain("correctionCount");
  });
});

// The route answers 400 to an empty `corrections`, and the server records a correction for every value that differs from the
// stored string. The save used to send both fields whatever the admin touched, so fixing a title replaced the deadline
// "07/10/2026" (which the input showed as the day before in UTC+8) with "2026-07-09T23:59:59.000Z" and logged a
// deadline correction.
describe("bid QA corrections", () => {
  type Bid = Parameters<typeof bidQaCorrectionDraftFor>[0];
  const bid = (deadlineDate: string | null, title = "Roof replacement"): Bid => ({ id: "bid-1", title, deadlineDate });
  /** The draft an admin has after editing the given inputs of a bid's row. */
  const edited = (item: Bid, changes: Partial<BidQaCorrectionDraft>): BidQaCorrectionDraft => ({
    ...bidQaCorrectionDraftFor(item, {}),
    ...changes,
  });
  /** Runs `check` under each time zone in turn, and puts the process's own zone back afterwards. */
  const inEachZone = (check: (zone: string) => void) => {
    const previous = process.env.TZ;
    try {
      for (const zone of ["Asia/Shanghai", "America/Bogota", "UTC", "Pacific/Honolulu"]) {
        process.env.TZ = zone;
        check(zone);
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  };

  it("sends nothing for a draft nobody edited, whatever shape the stored deadline has", () => {
    inEachZone((zone) => {
      const deadlines = [
        "2026-07-10", "07/10/2026", "7/10/2026", "2026-07-10T23:59:59.000Z", "2026-07-10T20:12:00.000+00:00",
        "Aug 31, 2026 @ 02:00 PM", "TBD", "1788984000000", null,
      ];
      for (const deadlineDate of deadlines) {
        for (const title of ["Roof replacement", " Roof replacement  "]) {
          const item = bid(deadlineDate, title);
          expect(bidQaCorrectionsFor(item, bidQaCorrectionDraftFor(item, {})), `${zone} ${deadlineDate} ${JSON.stringify(title)}`).toBeNull();
        }
      }
    });
  });

  it("sends only the title when only the title changed", () => {
    inEachZone((zone) => {
      for (const deadlineDate of ["2026-07-10", "07/10/2026", "2026-07-10T23:59:59.000Z", "TBD", null]) {
        const item = bid(deadlineDate);
        const corrections = bidQaCorrectionsFor(item, edited(item, { title: "  Roof replacement, phase 2 " }));

        expect(corrections, `${zone} ${deadlineDate}`).toStrictEqual({ title: "Roof replacement, phase 2" });
      }
    });
  });

  it("sends only the deadline when only the deadline changed, as the end of that day in UTC", () => {
    for (const deadlineDate of ["2026-07-10", "07/10/2026", "TBD", null]) {
      const item = bid(deadlineDate);

      expect(bidQaCorrectionsFor(item, edited(item, { deadlineDate: "2026-07-11" })), String(deadlineDate)).toStrictEqual({
        deadlineDate: "2026-07-11T23:59:59.000Z",
      });
    }
  });

  it("sends both when both changed", () => {
    const item = bid("07/10/2026");

    expect(bidQaCorrectionsFor(item, edited(item, { title: "Roof replacement, phase 2", deadlineDate: "2026-08-01" }))).toStrictEqual({
      title: "Roof replacement, phase 2",
      deadlineDate: "2026-08-01T23:59:59.000Z",
    });
  });

  it("does not move an M/D/YYYY deadline the admin left alone: the input shows its own day and picking it again is no change", () => {
    inEachZone((zone) => {
      const item = bid("07/10/2026");
      // In UTC+8 the input used to read "2026-07-09".
      expect(bidQaCorrectionDraftFor(item, {}).deadlineDate, zone).toBe("2026-07-10");

      const titleOnly = bidQaCorrectionsFor(item, edited(item, { title: "Roof replacement, phase 2" }));
      expect(titleOnly, zone).toStrictEqual({ title: "Roof replacement, phase 2" });
      expect(titleOnly, zone).not.toHaveProperty("deadlineDate");
      expect(bidQaCorrectionsFor(item, edited(item, { deadlineDate: "2026-07-10" })), zone).toBeNull();
    });
  });

  it("keeps a stored end of day as the day it names, in the input and in the request", () => {
    inEachZone((zone) => {
      const item = bid("2026-07-10T23:59:59.000Z");

      expect(bidQaCorrectionDraftFor(item, {}).deadlineDate, zone).toBe("2026-07-10");
      expect(bidQaCorrectionsFor(item, edited(item, { title: "Roof replacement, phase 2" })), zone).not.toHaveProperty("deadlineDate");
    });
  });

  it("sends an emptied date as null, as before, and only for a deadline the input showed", () => {
    expect(bidQaCorrectionsFor(bid("2026-07-10"), edited(bid("2026-07-10"), { deadlineDate: "" }))).toStrictEqual({ deadlineDate: null });
    expect(bidQaCorrectionsFor(bid("07/10/2026"), edited(bid("07/10/2026"), { deadlineDate: "" }))).toStrictEqual({ deadlineDate: null });
    // The input of a deadline that is not a date is empty from the start: leaving it empty is not clearing anything.
    expect(bidQaCorrectionsFor(bid("TBD"), edited(bid("TBD"), { deadlineDate: "" }))).toBeNull();
    expect(bidQaCorrectionsFor(bid(null), edited(bid(null), { deadlineDate: "" }))).toBeNull();
  });

  it("counts the trimmed title: spaces alone are no change, and an untouched padded title is not trimmed behind the admin's back", () => {
    const item = bid("2026-07-10");

    expect(bidQaCorrectionsFor(item, edited(item, { title: "Roof replacement  " }))).toBeNull();
    expect(bidQaCorrectionsFor(item, edited(item, { title: "  Roof replacement" }))).toBeNull();

    const padded = bid("2026-07-10", " Roof replacement ");
    expect(bidQaCorrectionsFor(padded, bidQaCorrectionDraftFor(padded, {}))).toBeNull();
    // Trimming it is a change the admin made.
    expect(bidQaCorrectionsFor(padded, edited(padded, { title: "Roof replacement" }))).toStrictEqual({ title: "Roof replacement" });
  });
});
