import { describe, expect, it } from "vitest";
import { STATE_CRAWLER_SOURCES } from "../src/lib/state-crawler-sources";
import {
  buildDemoReadinessReport,
  formatDemoReadinessReport,
  stateAttachmentRouteUpdates,
  type DemoReadinessAttachmentRow,
  type DemoReadinessBidRow,
  type DemoReadinessDataSourceRow,
} from "./demo-readiness";

const timestamp = "2026-06-10T00:00:00.000Z";

function completeDataset() {
  const dataSources: DemoReadinessDataSourceRow[] = STATE_CRAWLER_SOURCES.map((source) => ({
    id: source.id,
    label: source.label,
    issuerType: "state",
    stateCode: source.stateCode,
    baseUrl: source.baseUrl,
    isEnabled: 1,
  }));

  const bids: DemoReadinessBidRow[] = STATE_CRAWLER_SOURCES.map((source) => {
    const bidId = `${source.id}_demo_readiness`;

    return {
      id: bidId,
      title: `${source.label} Demo Opportunity`,
      source: source.label,
      issuerName: source.label,
      issuerType: "state",
      stateCode: source.stateCode,
      sourceUrl: `${source.baseUrl}/demo-readiness/${source.stateCode.toLowerCase()}`,
      description: `Demo-ready ${source.stateCode} procurement summary.`,
      fullDescription: `Detailed demo procurement narrative for ${source.stateCode}.`,
      isActive: 1,
      displayStatus: "published",
    };
  });

  const attachments: DemoReadinessAttachmentRow[] = bids.map((bid) => {
    const attachmentId = `${bid.id}_attachment`;

    return {
      id: attachmentId,
      bidId: bid.id,
      name: `${bid.stateCode}_demo_sow.pdf`,
      url: `/api/bids/${encodeURIComponent(bid.id)}/attachments/${encodeURIComponent(attachmentId)}`,
    };
  });

  return { dataSources, bids, attachments };
}

describe("demo readiness report", () => {
  it("passes when all 50 state sources, bids, and safe attachments are present", () => {
    const report = buildDemoReadinessReport(completeDataset(), new Date(timestamp));

    expect(report.ok).toBe(true);
    expect(report.stateSources.total).toBe(50);
    expect(report.dataSources.stateSources).toBe(50);
    expect(report.bids.activeStateBids).toBe(50);
    expect(report.attachments.stateAttachments).toBe(50);
    expect(report.knownPlaceholderUrls.count).toBe(0);
    expect(formatDemoReadinessReport(report)).toContain("Demo readiness PASS");
  });

  it("fails when state coverage, URL validity, bid content, or attachments are demo blockers", () => {
    const dataset = completeDataset();
    dataset.dataSources = dataset.dataSources.filter((source) => source.stateCode !== "WY");
    dataset.bids = dataset.bids.filter((bid) => bid.stateCode !== "WY");
    dataset.bids[0] = {
      ...dataset.bids[0],
      sourceUrl: "https://sam.gov/opp/12345",
    };
    dataset.bids[1] = {
      ...dataset.bids[1],
      description: "",
      fullDescription: "",
    };
    dataset.attachments = [];

    const report = buildDemoReadinessReport(dataset, new Date(timestamp));
    const formatted = formatDemoReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      "data_sources is missing 1 state source row: WY",
      "state bids are missing 1 state: WY",
      "state attachments are empty",
    ]));
    expect(report.knownPlaceholderUrls.count).toBe(1);
    expect(formatted).toContain("Demo readiness FAIL");
    expect(formatted).toContain("placeholder_url");
    expect(formatted).toContain("empty required content");
  });

  it("fails when a state has duplicate enabled source rows", () => {
    const dataset = completeDataset();
    dataset.dataSources.push({
      id: "cal_eprocure",
      label: "Cal eProcure Legacy Alias",
      issuerType: "state",
      stateCode: "CA",
      baseUrl: "https://caleprocure.ca.gov/event/67890",
      isEnabled: 1,
    });

    const report = buildDemoReadinessReport(dataset, new Date(timestamp));

    expect(report.ok).toBe(false);
    expect(report.blockers).toContain(
      "data_sources has duplicate enabled state source rows for 1 state: CA",
    );
  });

  it("redacts secret-bearing URLs from formatted and JSON output", () => {
    const dataset = completeDataset();
    dataset.bids[0] = {
      ...dataset.bids[0],
      sourceUrl: "https://user:super-secret-token@example.com/placeholder",
    };

    const report = buildDemoReadinessReport(dataset, new Date(timestamp));
    const formatted = formatDemoReadinessReport(report);
    const json = JSON.stringify(report);

    expect(report.ok).toBe(false);
    expect(formatted).not.toContain("super-secret-token");
    expect(json).not.toContain("super-secret-token");
    expect(formatted).not.toContain("mysql://");
    expect(json).not.toContain("DATABASE_URL");
  });

  it("identifies existing state attachments that need safe local download routes", () => {
    const dataset = completeDataset();
    dataset.attachments[0] = {
      ...dataset.attachments[0],
      url: "https://state.example.gov/files/sow.pdf",
    };

    expect(stateAttachmentRouteUpdates(dataset)).toEqual([
      {
        id: dataset.attachments[0].id,
        bidId: dataset.attachments[0].bidId,
        nextUrl: `/api/bids/${encodeURIComponent(dataset.attachments[0].bidId)}/attachments/${encodeURIComponent(
          dataset.attachments[0].id,
        )}`,
        previousUrl: "https://state.example.gov/files/sow.pdf",
      },
    ]);
  });
});
