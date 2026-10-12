import { describe, expect, it } from "vitest";
import { readCrawlerQualityEvidence } from "./crawler-data-quality";

describe("crawler quality evidence reader", () => {
  it("refuses inconsistent manifests rather than claiming content usability or complete coverage", () => {
    expect(readCrawlerQualityEvidence({ dataQuality: { schemaVersion: 1, listCoverage: "complete", contentStatus: "usable", receivedCount: 1, uniqueCount: 1, acceptedCount: 1, quarantinedCount: 0, duplicateCount: 0, validBodyCount: 2, retainedBodyCount: 0, analysisReadyCount: 2, reconciliation: { balanced: true } } })).toMatchObject({ contentStatus: "unknown", listCoverage: "unknown", validBodyCount: null });
  });
  it("keeps zero-body executions degraded even when a manifest incorrectly claims usable", () => {
    expect(readCrawlerQualityEvidence({ dataQuality: { schemaVersion: 1, execution: "success", listCoverage: "complete", contentStatus: "usable", receivedCount: 1, uniqueCount: 1, acceptedCount: 1, quarantinedCount: 0, duplicateCount: 0, validBodyCount: 0, retainedBodyCount: 0, analysisReadyCount: 0, reconciliation: { balanced: true } } }).contentStatus).toBe("partial");
  });
  it("does not infer usable bodies from enrichment success or fetched counts", () => {
    expect(readCrawlerQualityEvidence(JSON.stringify({ enrichment: { enriched: 25 }, fetchedCount: 25 }))).toMatchObject({ contentStatus: "unknown", validBodyCount: null });
  });
});
