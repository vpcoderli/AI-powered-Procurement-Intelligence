import { describe, expect, it } from "vitest";
import type { RiskChecklistReport } from "./checklist";
import { summarizeRiskChecklistTrend, type RiskChecklistSnapshot } from "./snapshots";

function report(input: {
  checkedAt: string;
  globalOk: boolean;
  stateSummary: string;
  attachmentSummary: string;
}): RiskChecklistReport {
  return {
    ok: input.globalOk,
    checkedAt: input.checkedAt,
    checks: [
      {
        id: "state-coverage",
        label: "50 state data coverage",
        ok: true,
        summary: input.stateSummary,
      },
      {
        id: "attachment-downloads",
        label: "Attachments use safe non-404 download routes",
        ok: true,
        summary: input.attachmentSummary,
      },
      {
        id: "global-url-validity",
        label: "All active bid source and attachment URLs are production-like",
        ok: input.globalOk,
        summary: "118 active bids checked for placeholder source URLs and unsafe attachment URLs",
      },
    ],
  };
}

function snapshot(id: string, snapshotReport: RiskChecklistReport): RiskChecklistSnapshot {
  return {
    id,
    ok: snapshotReport.ok,
    checkedAt: snapshotReport.checkedAt,
    createdAt: snapshotReport.checkedAt,
    report: snapshotReport,
  };
}

describe("risk checklist snapshot trends", () => {
  it("summarizes global URL stability, state coverage decline, and attachment count changes", () => {
    const trend = summarizeRiskChecklistTrend([
      snapshot("new", report({
        checkedAt: "2026-06-01T02:00:00.000Z",
        globalOk: true,
        stateSummary: "49/50 required states have at least one active bid",
        attachmentSummary: "8 state attachments checked",
      })),
      snapshot("old", report({
        checkedAt: "2026-06-01T01:00:00.000Z",
        globalOk: true,
        stateSummary: "50/50 required states have at least one active bid",
        attachmentSummary: "9 state attachments checked",
      })),
    ]);

    expect(trend).toMatchObject({
      snapshotCount: 2,
      globalUrlAllPassing: true,
      stateCoverageDeclined: true,
      attachmentDownloadCountChanged: true,
      latestGlobalUrlSummary: "118 active bids checked for placeholder source URLs and unsafe attachment URLs",
      latestStateCoverageSummary: "49/50 required states have at least one active bid",
      latestAttachmentSummary: "8 state attachments checked",
    });
  });
});
