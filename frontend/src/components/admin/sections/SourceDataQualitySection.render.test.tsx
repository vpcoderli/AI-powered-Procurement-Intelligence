import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import type { SourceDataQualityReport } from "@/server/source-validity/source-data-quality";
import { SourceDataQualityReportView } from "./SourceDataQualitySection";

const report: SourceDataQualityReport = {
  checkedAt: "2026-10-01T00:00:00.000Z", summary: { totalSources: 1, usableSources: 0, degradedSources: 1, unknownSources: 0, verifiedEmptySources: 0 },
  segments: [{ jurisdictionLevel: "city", totalSources: 1, usableSources: 0, degradedSources: 1, unknownSources: 0, verifiedEmptySources: 0 }], unattributedBidCount: 0,
  rows: [{ sourceId: "city_source", sourceLabel: "City Agency", jurisdictionLevel: "city", jurisdictionName: "Denver", stateCode: "CO", providerFamily: "bidnet", enabled: true, execution: "success", lastExecutionAt: "2026-10-01T00:00:00.000Z", lastSuccessAt: null, runId: "r", listCoverage: "complete", contentStatus: "partial", run: { listCoverage: "complete", contentStatus: "partial", checkedAt: null, reconciliationBalanced: true, receivedCount: 2, uniqueCount: 2, acceptedCount: 2, quarantinedCount: 0, duplicateCount: 0, validBodyCount: 1, retainedBodyCount: 1, fetchedBodyCount: 0, analysisReadyCount: 1 }, stored: { bidCount: 2, coreInvalidCount: 0, validBodyCount: 1, retainedBodyCount: 1, analysisReadyCount: 1, bodyVerificationUnknownCount: 1, oldestBodyVerifiedAt: null, latestBodyVerifiedAt: null, oldestBodyAgeHours: null, attachmentsDiscovered: 2, attachmentsArchived: 0, attachmentsVerified: 0 } }],
};

describe("all-source data quality view", () => {
  it("shows execution, coverage and content separately and reports body reuse rather than enriched counts", () => {
    const html = renderToStaticMarkup(<LanguageProvider><SourceDataQualityReportView report={report} /></LanguageProvider>);
    expect(html).toContain("City Agency");
    expect(html).toContain("bidnet");
    expect(html).toContain(en.admin.sourceQualityListExecution);
    expect(html).toContain(en.admin.sourceQualityCoverage);
    expect(html).toContain(en.admin.sourceQualityContent);
    expect(html).toContain(en.admin.sourceQualityRetainedBodies);
    expect(html).toContain(en.admin.sourceQualityVerificationUnknown);
    expect(html).not.toContain("enriched");
  });
  it("provides both languages for every new source quality label", () => {
    for (const key of Object.keys(en.admin).filter((key) => key.startsWith("sourceQuality"))) {
      expect((zh.admin as Record<string, string>)[key], key).toBeTruthy();
    }
  });
});
