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

  // Spec §5.2: the browser's Back works for the list state. A change the user makes (filter, search, sort, page, page
  // size, clear) pushes a history entry; only corrections of the current URL replace it.
  it("pushes the changes the user makes and replaces the URL only to correct it", () => {
    const view = readFileSync(new URL("SourcesListView.tsx", import.meta.url), "utf8");
    expect(view).toContain('(next: SourceListQuery, mode: "push" | "replace" = "push")');
    expect(view).toContain("router.push(href, { scroll: false })");
    expect(view).toContain('if (mode === "replace") router.replace(href, { scroll: false })');
    // The 400 recovery and the rewrite of a link with unknown values are the two corrections.
    expect(view).toContain('navigate(recovery.query, "replace")');
    expect(view).toContain("router.replace(`${pathname}${canonical}`, { scroll: false })");
    expect(view.match(/navigate\([^)]*"replace"\)/g)).toHaveLength(1);
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
    // Prechecks, approve, hold and run.
    expect(view.split("sendInChunks(")).toHaveLength(5);
    for (const report of ["precheckReport(", "approvalReport(", "holdReport(", "runReport(", "failedReport("]) expect(view).toContain(report);
    // The old catch swallowed the tally and the reason behind one generic sentence.
    expect(view).not.toContain('setNotice(t("admin.updateFailed"))');
  });

  it("runs the selected sources five per request, like the batch run panel, and tallies every response", () => {
    const view = read();
    expect(view).toContain("chunkSourceIds(runIds, BATCH_RUN_CHUNK_SIZE)");
    expect(view).toContain("(chunk) => runStateCrawlersNow(chunk)");
    expect(view).toContain("addRunResponse,");
    expect(view).toContain("runReport(t, outcome, skippedIds.length)");
    // One run request for the whole selection could outlast a proxy's idle timeout.
    expect(view).not.toContain("runStateCrawlersNow(runIds)");
  });

  it("leaves blocked rows out of bulk approve and hold, and does not claim a ledger for every approved row", () => {
    const view = read();
    expect(view.split("splitApprovalTargets(selectedItems)")).toHaveLength(3);
    expect(view).toContain("chunkSourceIds(split.targetIds, APPROVAL_BATCH_CHUNK_SIZE)");
    expect(view).not.toContain("chunkSourceIds(visibleSelected");
    expect(view).toContain("approvalReport({ t, reasonLabel }, outcome, split.blockedLeftOut)");
    expect(view).toContain("holdReport(t, outcome, split.blockedLeftOut)");
    expect(view).toContain("window.confirm(holdConfirmText(t, split))");
    expect(view).toContain('t("admin.batchApproveSources")');
    expect(view).not.toContain("sourcesApproveWithLedger");
  });

  it("lets the search box shrink with a phone-sized card instead of widening the page", () => {
    const view = read();
    expect(view).toContain('className="flex w-full items-center gap-2 sm:w-auto"');
    expect(view).toContain('className="sm:w-64"');
    expect(view).not.toContain('className="w-64"');
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

// The selection belongs to the query it was made under. Only navigate() used to clear it, and the browser's Back and
// Forward change the URL without it, so rows selected before Back stayed selected, and the bulk bar acted on them.
describe("sources list view, the selection follows the query", () => {
  const read = () => readFileSync(new URL("SourcesListView.tsx", import.meta.url), "utf8");

  it("keys the selection on the canonical query and drops it while rendering, whoever changed the URL", () => {
    const view = read();
    expect(view).toContain("const [selectionState, setSelectionState] = useState(() => emptySourceSelection(canonical));");
    expect(view).toContain("const selection = selectionOnQuery(selectionState, canonical);");
    // The stored selection is replaced, not just hidden: a hidden one would come back when Forward returned to its query.
    expect(view).toContain("if (selection !== selectionState) setSelectionState(selection);");
    expect(view).toContain("const selectedIds = selection.ids;");
    expect(view).not.toContain("setSelectedIds");
  });

  it("does not reset the selection in an effect, which would show rows selected for another query for a frame", () => {
    const view = read();
    const effects = view.match(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/g) ?? [];

    // Every effect of the file was captured, so the check below is not vacuous.
    expect(effects).toHaveLength(view.split("useEffect(").length - 1);
    for (const effect of effects) {
      expect(effect).not.toContain("setSelectionState");
      expect(effect).not.toContain("selectionOnQuery");
    }
  });

  it("still clears the selection at once for a change the user makes, and selects on the query shown", () => {
    const view = read();
    // navigate() and a finished bulk action: two writers of an empty selection, both under the query the list is on.
    expect(view.split("setSelectionState(emptySourceSelection(canonical))")).toHaveLength(3);
    expect(view).toContain("    [canonical, pathname, router],\n  );");
    expect(view).toContain('if (report.outcome === "done") setSelectionState(emptySourceSelection(canonical));');
    // The select-all box and a row keep the selection under that same query.
    expect(view).toContain("setSelectionState({ canonical, ids: allVisibleSelected ? [] : items.map((item) => item.id) })");
    expect(view).toContain("const ids = selectionOnQuery(current, canonical).ids;");
    expect(view).toContain("return { canonical, ids: ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id] };");
  });

  it("acts only on selected rows that are on the page shown", () => {
    const view = read();
    expect(view).toContain("const visibleSelected = selectedIds.filter((id) => items.some((item) => item.id === id));");
    expect(view).toContain("const selectedItems = items.filter((item) => visibleSelected.includes(item.id));");
  });
});
