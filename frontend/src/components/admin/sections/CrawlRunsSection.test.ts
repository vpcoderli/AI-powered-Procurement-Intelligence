import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("crawl runs section", () => {
  it("runs from the index API and lists every crawler run", () => {
    const source = readFileSync(new URL("CrawlRunsSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("listAdminDataSourceIndex()");
    expect(source).toContain("<JurisdictionBatchRunPanel");
    expect(source).toContain("crawlerSourceIdFor={crawlerRunIdFor}");
    expect(source).not.toContain("onCompleted=");
    expect(source).toContain("runStateCrawlersNow()");
    expect(source).toContain('t("admin.runStateCrawlers")');
    expect(source).toContain("<CrawlerLogList");
  });

  // Moved from src/app/admin/page.test.ts ("renders the shared source cards and links each row to its detail page"):
  // the old page's recent-logs section rendered one CrawlerLogRow per run; the list component does it now.
  it("titles the list like the old recent-logs section and renders one CrawlerLogRow per run", () => {
    const source = readFileSync(new URL("CrawlRunsSection.tsx", import.meta.url), "utf8");
    const list = readFileSync(new URL("../sources/CrawlerLogList.tsx", import.meta.url), "utf8");
    expect(source).toContain('title={t("admin.recentLogs")}');
    expect(list).toContain("<CrawlerLogRow key={log.id} log={log} />");
  });

  // The old page header's button (`runNow`) kept these exact keys.
  it("keeps the run-all button's messages and labels from the old page header", () => {
    const source = readFileSync(new URL("CrawlRunsSection.tsx", import.meta.url), "utf8");
    expect(source).toContain('t("admin.runQueued")');
    expect(source).toContain('t("admin.runFailed")');
    expect(source).toContain('t("admin.running")');
    expect(source).toContain("{canRunOperations && (");
  });
});
