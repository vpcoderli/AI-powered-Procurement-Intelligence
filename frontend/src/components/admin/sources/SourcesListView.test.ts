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
