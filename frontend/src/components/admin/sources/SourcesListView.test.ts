import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sources list view", () => {
  it("keeps its state in the URL and only calls its own endpoints", () => {
    const view = readFileSync(new URL("SourcesListView.tsx", import.meta.url), "utf8");
    expect(view).toContain("useSearchParams()");
    expect(view).toContain("router.replace(");
    expect(view).toContain("{ scroll: false }");
    expect(view).toContain("listAdminDataSourcesPage(");
    expect(view).not.toContain("listAdminDataSources()");
    expect(view).not.toContain("listAdminCrawlerLogs");
  });

  it("gates bulk actions by role and respects the API limits", () => {
    const view = readFileSync(new URL("SourcesListView.tsx", import.meta.url), "utf8");
    expect(view).toContain("requestAdminSourcePrechecks({ sourceIds: chunk })");
    expect(view).toContain("PRECHECK_REQUEST_CHUNK");
    expect(view).toContain("APPROVAL_BATCH_CHUNK_SIZE");
    expect(view).toContain("RUN_NOW_LIMIT");
    expect(view).toContain('action: "approve"');
    expect(view).toContain('action: "hold"');
    expect(view).toContain("approvalReasonKey(reason)");
    expect(view).toContain("listAdminDataSourceIndex(query)");
  });
});

describe("sources list view, safer bulk actions", () => {
  const read = () => readFileSync(new URL("SourcesListView.tsx", import.meta.url), "utf8");

  it("sends only eligible rows to the precheck queue, from a selection and from the whole filtered list", () => {
    const view = read();
    expect(view).toContain("splitPrecheckTargets(selectedItems)");
    expect(view).toContain("splitPrecheckTargets(index.items)");
    expect(view).not.toContain("index.items.map((item) => item.id)");
    expect(view).not.toContain("queuePrechecks(visibleSelected)");
    // One request site for both actions: the chunk-and-sum loop is not written twice.
    expect(view.split("requestAdminSourcePrechecks({ sourceIds: chunk })")).toHaveLength(2);
  });

  it("asks before it queues everything and before it holds, and refuses a truncated index", () => {
    const view = read();
    expect(view).toContain("window.confirm(precheckConfirmText(");
    expect(view).toContain("window.confirm(holdConfirmText(");
    expect(view).toContain("index.truncated");
    expect(view).toContain("admin.sourcesQueueAllTruncated");
    expect(view).toContain("SOURCE_INDEX_MAX_ROWS");
  });

  it("tallies every chunked write outside the try, so a partial success is reported with the server's message", () => {
    const view = read();
    expect(view.split("sendInChunks(")).toHaveLength(4);
    for (const report of ["precheckReport(", "approvalReport(", "holdReport(", "failedReport("]) expect(view).toContain(report);
    // The old catch swallowed the tally and the reason behind one generic sentence.
    expect(view).not.toContain('setNotice(t("admin.updateFailed"))');
  });

  it("retries a refused page from page 1 before it falls back to the defaults, and ignores an answer for an older query", () => {
    const view = read();
    expect(view).toContain("recoveryForListError(page.error, canonical, query)");
    expect(view).toContain("new ListRequestError(canonical, failure)");
  });

  it("keeps the bulk bar off while a page is loading", () => {
    expect(read()).toContain('page.status === "loading"');
  });
});
