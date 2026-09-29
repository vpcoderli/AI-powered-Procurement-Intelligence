import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("crawl runs section", () => {
  it("runs from the index API and lists every crawler run", () => {
    const source = readFileSync(new URL("CrawlRunsSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("listAdminDataSourceIndex()");
    expect(source).toContain("<JurisdictionBatchRunPanel");
    expect(source).toContain("crawlerSourceIdFor={crawlerRunIdFor}");
    expect(source).toContain("runStateCrawlersNow()");
    expect(source).toContain('t("admin.runStateCrawlers")');
    expect(source).toContain("<CrawlerLogList");
  });

  // The runs a batch makes land in the log list below the panel, so the list reads its first page again when the
  // batch ends. Only the list is keyed by the revision: the panel is not remounted and keeps its per-source report.
  it("re-reads the log list when a batch run ends, without remounting the batch panel", () => {
    const source = readFileSync(new URL("CrawlRunsSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("const refreshLogs = () => setLogsRevision((revision) => revision + 1);");
    expect(source).toContain("onCompleted={refreshLogs}");
    expect(source).toContain("<CrawlerLogList key={logsRevision}");
    expect(source.match(/key=\{logsRevision\}/g)).toHaveLength(1);
  });

  // Moved from src/app/admin/page.test.ts ("renders the shared source cards and links each row to its detail page"):
  // the recent-logs section rendered one CrawlerLogRow per run; the list component does it now.
  it("titles the list like the old recent-logs section and renders one CrawlerLogRow per run", () => {
    const source = readFileSync(new URL("CrawlRunsSection.tsx", import.meta.url), "utf8");
    const list = readFileSync(new URL("../sources/CrawlerLogList.tsx", import.meta.url), "utf8");
    expect(source).toContain('title={t("admin.recentLogs")}');
    expect(list).toContain("<CrawlerLogRow key={log.id} log={log} />");
  });

  it("keeps the run-all button's messages and labels, and shows a failed run as an error", () => {
    const source = readFileSync(new URL("CrawlRunsSection.tsx", import.meta.url), "utf8");
    expect(source).toContain('setNotice({ message: t("admin.runQueued"), tone: "info" })');
    expect(source).toContain('setNotice({ message: t("admin.runFailed"), tone: "error" })');
    expect(source).toContain("<AdminNotice message={notice?.message ?? null} tone={notice?.tone} />");
    expect(source).toContain('t("admin.running")');
    expect(source).toContain("{canRunOperations && (");
  });

  it("puts the batch panel in the shared panel card", () => {
    const source = readFileSync(new URL("CrawlRunsSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("<section className={ADMIN_PANEL_CARD}>");
    expect(source).not.toContain("const PANEL_CARD");
  });
});
