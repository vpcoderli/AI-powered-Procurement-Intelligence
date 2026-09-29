"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BATCH_RUN_CHUNK_SIZE } from "@/components/admin/JurisdictionBatchRunPanel";
import { approvalReasonKey, chunkSourceIds, APPROVAL_BATCH_CHUNK_SIZE } from "@/components/admin/LedgeredApprovalPanel";
import {
  batchUpdateAdminDataSources,
  listAdminDataSourceIndex,
  listAdminDataSourcesPage,
  requestAdminSourcePrechecks,
  runStateCrawlersNow,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  SOURCE_INDEX_MAX_ROWS,
  SOURCE_LIST_PAGE_SIZES,
  SOURCE_LIST_SORT_KEYS,
  defaultSourceListQuery,
  type SourceFacetKey,
  type SourceListQuery,
} from "@/server/admin/data-source-list-contract";
import { formatDate } from "../admin-format";
import { useAdminSession } from "../admin-session";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";
import {
  PRECHECK_REQUEST_CHUNK,
  RUN_NOW_LIMIT,
  addApprovalResponse,
  addRunResponse,
  approvalReport,
  blockedLeftOutText,
  emptyApprovalTally,
  emptyRunTally,
  failedReport,
  holdConfirmText,
  holdReport,
  precheckConfirmText,
  precheckReport,
  runReport,
  runTargets,
  sendInChunks,
  splitApprovalTargets,
  splitPrecheckTargets,
  type BulkReport,
  type PrecheckSplit,
} from "./source-bulk-actions";
import {
  ListRequestError,
  emptySourceSelection,
  facetOptions,
  hasActiveFilters,
  lastRunOf,
  pageRange,
  readSourceListQuery,
  recoveryForListError,
  selectedFacetValues,
  selectionOnQuery,
  toggleFacetValue,
  writeSourceListQuery,
} from "./source-list-url";

const CHIP_FACETS: SourceFacetKey[] = ["level", "approval", "health", "platform"];
const FACET_LABEL_KEY: Record<SourceFacetKey, string> = {
  level: "admin.fieldLevel",
  state: "admin.fieldState",
  platform: "admin.fieldPlatform",
  approval: "admin.fieldApproval",
  health: "admin.fieldHealth",
};
const APPROVAL_TONE = { approved: "border-emerald-200 bg-emerald-50 text-emerald-700", awaiting: "border-amber-200 bg-amber-50 text-amber-800", blocked: "border-rose-200 bg-rose-50 text-rose-700" } as const;
const HEALTH_TONE = { healthy: "border-emerald-200 bg-emerald-50 text-emerald-700", failing: "border-rose-200 bg-rose-50 text-rose-700", never_run: "border-slate-200 bg-slate-50 text-slate-600", disabled: "border-slate-300 bg-slate-100 text-slate-500" } as const;
const SELECT_CLASS = "h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const FILTER_LABEL_CLASS = "w-20 shrink-0 text-xs font-semibold uppercase text-slate-500";

export function SourcesListView() {
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname() ?? "/admin/sources";
  const searchParams = useSearchParams();
  const { canRunOperations, canManageUsers } = useAdminSession();
  const searchString = searchParams?.toString() ?? "";
  const { query, invalid } = useMemo(() => readSourceListQuery(new URLSearchParams(searchString)), [searchString]);
  const canonical = writeSourceListQuery(query);

  const [notice, setNotice] = useState<{ message: string; tone: "info" | "error" } | null>(null);
  // Set from effects, rendered with t() — `t` is a new function every render, so effects must not depend on it.
  const [urlNotice, setUrlNotice] = useState<"invalid" | "rejected" | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchDraft, setSearchDraft] = useState(query.q ?? "");
  // The selection belongs to the query it was made under (`canonical`), so any change of the URL drops it: the ones the
  // user makes through navigate() and the browser's Back and Forward, which do not go through it. It is adjusted while
  // rendering, not in an effect: React redoes the render at once with the new state, so no frame shows rows selected for
  // another query, and the stored selection is replaced rather than hidden, so returning to that query does not bring it back.
  const [selectionState, setSelectionState] = useState(() => emptySourceSelection(canonical));
  const selection = selectionOnQuery(selectionState, canonical);
  if (selection !== selectionState) setSelectionState(selection);
  const selectedIds = selection.ids;

  // A change the user makes is a new history entry, so the browser's Back returns to the list as it was (spec §5.2);
  // a correction of the URL the page is already on (the 400 recovery) replaces the entry it corrects.
  const navigate = useCallback(
    (next: SourceListQuery, mode: "push" | "replace" = "push") => {
      // A change the user makes clears the selection at once, before the new URL has landed.
      setSelectionState(emptySourceSelection(canonical));
      // A notice about the link that was opened is said once; the next thing the user does replaces it.
      setUrlNotice(null);
      const href = `${pathname}${writeSourceListQuery(next)}`;
      if (mode === "replace") router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [canonical, pathname, router],
  );

  // An unknown value in the URL: say so once and rewrite the URL to what is applied.
  useEffect(() => {
    if (!invalid) return;
    queueMicrotask(() => {
      setUrlNotice("invalid");
      router.replace(`${pathname}${canonical}`, { scroll: false });
    });
  }, [invalid, canonical, pathname, router]);

  // Back/forward can change q; keep the search box in step.
  useEffect(() => {
    queueMicrotask(() => setSearchDraft(query.q ?? ""));
  }, [query.q]);

  const loadPage = useCallback(async () => {
    try {
      return await listAdminDataSourcesPage(readSourceListQuery(new URLSearchParams(canonical)).query);
    } catch (failure) {
      throw new ListRequestError(canonical, failure);
    }
  }, [canonical]);
  const page = useAdminResource(loadPage);

  // The API refused the query (a page past the end after rows changed, or a value it does not know): retry the same
  // filters from page 1 first, and only when page 1 is refused too go back to the defaults and say so.
  useEffect(() => {
    const recovery = recoveryForListError(page.error, canonical, query);
    if (!recovery) return;
    queueMicrotask(() => {
      // navigate() clears the link notice, so the reason is set after it.
      navigate(recovery.query, "replace");
      if (recovery.fellBack) setUrlNotice("rejected");
    });
  }, [page.error, canonical, query, navigate]);

  const items = page.data?.items ?? [];
  const total = page.data?.total ?? 0;
  const visibleSelected = selectedIds.filter((id) => items.some((item) => item.id === id));
  const selectedItems = items.filter((item) => visibleSelected.includes(item.id));
  const canSelect = canRunOperations || canManageUsers;
  const range = pageRange(total, query.page, query.pageSize);
  const allVisibleSelected = items.length > 0 && visibleSelected.length === items.length;

  const toggleAllVisible = () => setSelectionState({ canonical, ids: allVisibleSelected ? [] : items.map((item) => item.id) });
  const toggleRow = (id: string) =>
    setSelectionState((current) => {
      const ids = selectionOnQuery(current, canonical).ids;
      return { canonical, ids: ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id] };
    });

  // The bar acts on the rows shown and on the URL's filters, so it waits while a page (possibly for other filters) loads.
  const barLocked = busy || page.status === "loading";

  const reasonLabel = (reason: string) => {
    const key = approvalReasonKey(reason);
    return key ? t(key) : reason;
  };

  // `null`: the user declined a confirmation, nothing was sent. Otherwise the report is the notice; only a finished
  // action clears the selection, and the list is re-read after a failure too, because earlier chunks may already be written.
  const runBulk = async (work: () => Promise<BulkReport | null>) => {
    setBusy(true);
    setNotice(null);
    try {
      const report = await work();
      if (!report) return;
      setNotice({ message: report.message, tone: report.outcome === "failed" ? "error" : "info" });
      if (report.outcome === "refused") return;
      if (report.outcome === "done") setSelectionState(emptySourceSelection(canonical));
      await page.reload();
    } catch (caught) {
      // A request that is not chunked failed (the index read, a run): nothing was tallied, the server's reason is the notice.
      setNotice({ message: failedReport(t, caught).message, tone: "error" });
      await page.reload();
    } finally {
      setBusy(false);
    }
  };

  // The one place prechecks are sent: only the eligible rows, 500 ids per request, the count reported with what was left out.
  const queueEligible = async (split: PrecheckSplit): Promise<BulkReport> => {
    const outcome = await sendInChunks(
      chunkSourceIds(split.eligibleIds, PRECHECK_REQUEST_CHUNK),
      (chunk) => requestAdminSourcePrechecks({ sourceIds: chunk }),
      (queued, response) => queued + response.requestedCount,
      0,
    );
    return precheckReport(t, outcome, split.leftOut);
  };

  const queuePrechecks = () => runBulk(() => queueEligible(splitPrecheckTargets(selectedItems)));

  const queueAllMatching = () =>
    runBulk(async () => {
      const index = await listAdminDataSourceIndex(query);
      if (index.truncated) {
        return { message: t("admin.sourcesQueueAllTruncated").replace("{max}", String(SOURCE_INDEX_MAX_ROWS)), outcome: "refused" };
      }
      const split = splitPrecheckTargets(index.items);
      if (split.eligibleIds.length > 0 && !window.confirm(precheckConfirmText(t, split))) return null;
      return queueEligible(split);
    });

  // Spec §5.2: chunks of 100, the result summarised as approved plus skips grouped by reason. Blocked rows are left
  // out (splitApprovalTargets): a federal/state one would be approved without a ledger.
  const approveSelected = () =>
    runBulk(async () => {
      const split = splitApprovalTargets(selectedItems);
      if (split.targetIds.length === 0) return { message: blockedLeftOutText(t, split.blockedLeftOut), outcome: "refused" };
      const outcome = await sendInChunks(
        chunkSourceIds(split.targetIds, APPROVAL_BATCH_CHUNK_SIZE),
        (chunk) => batchUpdateAdminDataSources({ sourceIds: chunk, action: "approve" }),
        addApprovalResponse,
        emptyApprovalTally(),
      );
      return approvalReport({ t, reasonLabel }, outcome, split.blockedLeftOut);
    });

  // Blocked rows are left out: the batch hold would write needs_review over the block.
  const holdSelected = async () => {
    const split = splitApprovalTargets(selectedItems);
    if (split.targetIds.length > 0 && !window.confirm(holdConfirmText(t, split))) return;
    await runBulk(async () => {
      if (split.targetIds.length === 0) return { message: blockedLeftOutText(t, split.blockedLeftOut), outcome: "refused" };
      const outcome = await sendInChunks(
        chunkSourceIds(split.targetIds, APPROVAL_BATCH_CHUNK_SIZE),
        (chunk) => batchUpdateAdminDataSources({ sourceIds: chunk, action: "hold" }),
        (held, response) => held + response.updatedCount,
        0,
      );
      return holdReport(t, outcome, split.blockedLeftOut);
    });
  };

  const runSelected = async () => {
    // Refused before the busy/reload cycle: nothing ran, so the selection and the list stay as they are.
    if (selectedItems.length > RUN_NOW_LIMIT) {
      setNotice({ message: t("admin.sourcesRunLimit").replace("{max}", String(RUN_NOW_LIMIT)), tone: "info" });
      return;
    }
    await runBulk(async () => {
      const { runIds, skippedIds } = runTargets(selectedItems);
      // A run request waits for its runs (BidNet's platform spacing included), so up to 20 at once could outlast a
      // proxy's idle timeout while the runs went on. They go the batch run panel's 5 at a time, one after another.
      const outcome = await sendInChunks(
        chunkSourceIds(runIds, BATCH_RUN_CHUNK_SIZE),
        (chunk) => runStateCrawlersNow(chunk),
        addRunResponse,
        emptyRunTally(),
      );
      return runReport(t, outcome, skippedIds.length);
    });
  };

  const facetLabel = (facet: SourceFacetKey, value: string) =>
    facet === "level" ? t(`admin.coverageLevel_${value}`) : facet === "approval" ? t(`admin.sourcesApproval_${value}`) : facet === "health" ? t(`admin.sourcesHealth_${value}`) : value;

  const selectedStates = selectedFacetValues(query, "state");
  const stateCounts = facetOptions(page.data?.facets.state ?? [], selectedStates);
  const columnCount = canSelect ? 10 : 9;

  return (
    <div className="flex flex-col gap-4">
      {urlNotice && <AdminNotice message={t(urlNotice === "invalid" ? "admin.sourcesInvalidQuery" : "admin.sourcesQueryRejected")} />}
      <AdminNotice message={notice?.message ?? null} tone={notice?.tone} />
      {page.status === "error" && page.data && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}

      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {/* Below sm the form takes its own row and the input shrinks to fit the card. */}
          <form
            className="flex w-full items-center gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              navigate({ ...query, q: searchDraft.trim() || null, page: 1 });
            }}
          >
            <Input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("admin.sourcesSearchPlaceholder")}
              aria-label={t("admin.sourcesSearchPlaceholder")}
              className="sm:w-64"
            />
            <Button type="submit" size="sm">
              {t("admin.sourcesSearch")}
            </Button>
          </form>
          <div className="flex items-center gap-2">
            <select
              aria-label={t("admin.sourcesSort")}
              value={query.sort}
              onChange={(event) => {
                const sort = SOURCE_LIST_SORT_KEYS.find((key) => key === event.target.value);
                if (sort) navigate({ ...query, sort, page: 1 });
              }}
              className={SELECT_CLASS}
            >
              {SOURCE_LIST_SORT_KEYS.map((key) => (
                <option key={key} value={key}>
                  {t(`admin.sourcesSort_${key}`)}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={query.descending} onChange={(event) => navigate({ ...query, descending: event.target.checked, page: 1 })} />
              {t("admin.sourcesSortDescending")}
            </label>
          </div>
          {hasActiveFilters(query) && (
            <Button type="button" size="sm" variant="ghost" onClick={() => navigate(defaultSourceListQuery())}>
              {t("admin.sourcesClearFilters")}
            </Button>
          )}
        </div>

        {CHIP_FACETS.map((facet) => {
          const selected = selectedFacetValues(query, facet);
          return (
            <div key={facet} className="flex flex-wrap items-center gap-2">
              <span className={FILTER_LABEL_CLASS}>{t(FACET_LABEL_KEY[facet])}</span>
              {facetOptions(page.data?.facets[facet] ?? [], selected).map(({ value, count }) => {
                const active = selected.includes(value);
                return (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    aria-pressed={active}
                    onClick={() => navigate(toggleFacetValue(query, facet, value))}
                  >
                    {`${facetLabel(facet, value)} (${count})`}
                  </Button>
                );
              })}
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-2">
          <span className={FILTER_LABEL_CLASS}>{t(FACET_LABEL_KEY.state)}</span>
          <select
            aria-label={t("admin.fieldState")}
            value=""
            onChange={(event) => {
              if (event.target.value) navigate(toggleFacetValue(query, "state", event.target.value));
            }}
            className={SELECT_CLASS}
          >
            <option value="">{t("admin.sourcesAddState")}</option>
            {stateCounts
              .filter(({ value }) => !selectedStates.includes(value))
              .map(({ value, count }) => (
                <option key={value} value={value}>
                  {`${value} (${count})`}
                </option>
              ))}
          </select>
          {stateCounts
            .filter(({ value }) => selectedStates.includes(value))
            .map(({ value, count }) => (
              <Button key={value} type="button" size="sm" aria-pressed onClick={() => navigate(toggleFacetValue(query, "state", value))}>
                {`${value} (${count})`}
              </Button>
            ))}
        </div>
      </section>

      {canSelect && (
        <section className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className="text-sm font-medium text-slate-700">{t("admin.sourcesSelectedCount").replace("{count}", String(visibleSelected.length))}</span>
          {canRunOperations && (
            <>
              <Button type="button" size="sm" variant="outline" disabled={barLocked || visibleSelected.length === 0} onClick={() => void queuePrechecks()}>
                {t("admin.sourcesQueuePrechecks")}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={barLocked || total === 0} onClick={() => void queueAllMatching()}>
                {t("admin.sourcesQueueAllMatching").replace("{count}", String(total))}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={barLocked || visibleSelected.length === 0} onClick={() => void runSelected()}>
                {t("admin.sourceDetailRunNow")}
              </Button>
            </>
          )}
          {canManageUsers && (
            <>
              {/* Local rows are approved through the ledger, federal/state rows through the generic write. */}
              <Button type="button" size="sm" variant="outline" disabled={barLocked || visibleSelected.length === 0} onClick={() => void approveSelected()}>
                {t("admin.batchApproveSources")}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={barLocked || visibleSelected.length === 0} onClick={() => void holdSelected()}>
                {t("admin.holdSource")}
              </Button>
            </>
          )}
        </section>
      )}

      {page.data ? (
        <section aria-busy={page.status === "loading"} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                {canSelect && (
                  <TableHead className="w-10">
                    <input type="checkbox" aria-label={t("admin.batchRunSelectAllVisible")} checked={allVisibleSelected} onChange={toggleAllVisible} disabled={items.length === 0} />
                  </TableHead>
                )}
                <TableHead>{t("admin.source")}</TableHead>
                <TableHead>{t("admin.fieldLevel")}</TableHead>
                <TableHead>{t("admin.fieldState")}</TableHead>
                <TableHead>{t("admin.fieldPlatform")}</TableHead>
                <TableHead>{t("admin.fieldApproval")}</TableHead>
                <TableHead>{t("admin.fieldHealth")}</TableHead>
                <TableHead>{t("admin.lastRun")}</TableHead>
                <TableHead>{t("admin.fieldConsecutiveFailures")}</TableHead>
                <TableHead>{t("admin.enabled")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="py-8 text-center text-slate-500">
                    {t("admin.sourcesEmpty")}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id} data-state={visibleSelected.includes(item.id) ? "selected" : undefined}>
                    {canSelect && (
                      <TableCell>
                        <input type="checkbox" aria-label={item.label} checked={visibleSelected.includes(item.id)} onChange={() => toggleRow(item.id)} />
                      </TableCell>
                    )}
                    <TableCell className="min-w-56 max-w-80 whitespace-normal">
                      <Link href={`/admin/sources/${encodeURIComponent(item.id)}`} className="font-medium text-slate-950 hover:underline">
                        {item.label}
                      </Link>
                      <div className="text-xs break-all text-slate-500">{item.id}</div>
                    </TableCell>
                    <TableCell>{t(`admin.coverageLevel_${item.level}`)}</TableCell>
                    <TableCell>{item.stateCode}</TableCell>
                    <TableCell>{item.providerFamily}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={APPROVAL_TONE[item.approvalState]}>
                        {t(`admin.sourcesApproval_${item.approvalState}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={HEALTH_TONE[item.health]}>
                        {t(`admin.sourcesHealth_${item.health}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(lastRunOf(item))}</TableCell>
                    <TableCell>{item.consecutiveFailures}</TableCell>
                    <TableCell>{item.isEnabled ? t("admin.on") : t("admin.off")}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span>
              {t("admin.paginationSummary")
                .replace("{from}", String(range.from))
                .replace("{to}", String(range.to))
                .replace("{total}", String(total))}
            </span>
            <div className="flex items-center gap-2">
              <select
                aria-label={t("admin.paginationPageSize")}
                value={query.pageSize}
                onChange={(event) => navigate({ ...query, pageSize: Number(event.target.value), page: 1 })}
                className={SELECT_CLASS}
              >
                {SOURCE_LIST_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" variant="outline" disabled={query.page <= 1} onClick={() => navigate({ ...query, page: query.page - 1 })}>
                {t("admin.paginationPrevious")}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={query.page >= range.lastPage} onClick={() => navigate({ ...query, page: query.page + 1 })}>
                {t("admin.paginationNext")}
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <AdminSectionStateCard
          action={() => void page.reload()}
          actionLabel={t("admin.refresh")}
          code={page.status === "error" ? "error" : "loading"}
          message={page.status === "error" ? t("admin.errorDescription") : t("admin.loading")}
          title={t("admin.nav_sourcesList")}
        />
      )}
    </div>
  );
}
