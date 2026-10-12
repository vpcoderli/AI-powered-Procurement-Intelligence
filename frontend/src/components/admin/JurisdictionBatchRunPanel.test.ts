import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("JurisdictionBatchRunPanel component wiring", () => {
  const component = readFileSync(new URL("JurisdictionBatchRunPanel.tsx", import.meta.url), "utf8");

  it("keeps all user-facing copy behind the i18n dictionaries", () => {
    expect(component).toContain('t("admin.batchRunTitle")');
    expect(component).toContain('t("admin.batchRunWindowInvalid")');
    expect(component).toContain('t(`admin.batchRunLevel_${level}`)');
    expect(component).toContain('t(`admin.batchRunWindow_${preset}`)');
  });

  it("renders the deferral and empty-state outcomes distinctly, through i18n", () => {
    expect(component).toContain('t("admin.batchRunEmptyState")');
    expect(component).toContain('t("admin.batchRunEmptyStateHint")');
    expect(component).toContain('t("admin.batchRunZeroRows")');
    expect(component).toContain('t("admin.batchRunDeferredHint")');

    const en = readFileSync(new URL("../../lib/i18n/dictionaries/en.ts", import.meta.url), "utf8");
    const zh = readFileSync(new URL("../../lib/i18n/dictionaries/zh.ts", import.meta.url), "utf8");
    for (const dictionary of [en, zh]) {
      expect(dictionary).toContain("batchRunStatus_deferred:");
      expect(dictionary).toContain("batchRunEmptyState:");
      expect(dictionary).toContain("batchRunZeroRows:");
    }
    expect(zh).toContain("平台限流，本批推迟");
    expect(zh).toContain("空态：无开放招标");
    expect(zh).toContain("成功（0 条）");
  });

  it("disables the run button while running, with nothing selected, or with an invalid window", () => {
    expect(component).toContain("disabled={disabled || isBatchRunning || selectedKeys.size === 0 || windowInvalid}");
  });

  it("is mounted on the crawl runs page with the crawler source id resolver", () => {
    const section = readFileSync(new URL("./sections/CrawlRunsSection.tsx", import.meta.url), "utf8");
    expect(section).toContain("JurisdictionBatchRunPanel");
    expect(section).toContain("crawlerSourceIdFor={crawlerRunIdFor}");
    // The per-source batch report lives in the panel's own state. When a batch ends the section re-reads only the
    // log list below it (keyed by its revision); the panel itself is never keyed, so the report stays.
    expect(section).toContain("onCompleted={refreshLogs}");
    expect(section).toContain("<CrawlerLogList key={logsRevision}");
    expect(section).not.toMatch(/<JurisdictionBatchRunPanel[^>]*\bkey=/);
  });
});
