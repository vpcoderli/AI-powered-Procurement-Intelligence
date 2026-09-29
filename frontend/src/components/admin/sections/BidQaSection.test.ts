import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bidQaRequestFor, DEFAULT_BID_QA_FILTERS } from "./BidQaSection";

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
