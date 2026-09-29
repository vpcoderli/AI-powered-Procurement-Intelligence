"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Award,
  CalendarPlus,
  ClipboardCheck,
  Clock,
  Database,
  FilePlus,
  FileText,
  FolderOpen,
  Gauge,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getAdminOverview,
  type AdminApprovalReadinessBucket,
  type AdminOverview,
  type AdminOverviewBids,
  type AdminOverviewCoverage,
  type AdminOverviewCrawlHealth,
  type AdminOverviewPipelineRow,
  type AdminOverviewRunCounts,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import { COVERAGE_LEVELS } from "@/server/admin/data-source-list-contract";
import { canViewAdminPath } from "../admin-nav";
import { formatDate } from "../admin-format";
import { useAdminSession } from "../admin-session";
import { AdminNotice, AdminSectionStateCard, SummaryCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";
import {
  barPercent,
  stateLevelColumns,
  toggleStateSort,
  TOP_STATES,
  visibleStates,
  type StateSort,
  type StateSortKey,
} from "./overview-view-model";

// A stable, module-level loader: useAdminResource reloads whenever the loader's identity changes.
const loadOverview = () => getAdminOverview();
const BUCKETS = [
  "approvable",
  "awaiting_precheck",
  "needs_fix",
  "missing_platform_review",
  "approved",
  "blocked",
] as const satisfies readonly AdminApprovalReadinessBucket[];

const HEADER_LINK_CLASS = cn(buttonVariants({ variant: "outline" }), "h-9 rounded-lg border-slate-200 px-3");
const TEXT_LINK_CLASS = "text-sm font-medium text-sky-700 underline-offset-2 hover:underline";

function reviewStatusTone(status: AdminOverviewPipelineRow["platformReview"]["status"]): string {
  if (status === "valid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "expired") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 w-full rounded bg-slate-100" aria-hidden="true">
      <div className="h-2 rounded bg-sky-500" style={{ width: `${barPercent(value, max)}%` }} />
    </div>
  );
}

/** One of the four overview blocks: a bordered section with an icon + title header row. */
function OverviewBlock({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id={headingId} className="flex items-center gap-2 font-semibold text-slate-950">
          <Icon size={18} aria-hidden="true" />
          {title}
        </h2>
        {action}
      </div>
      <div className="flex flex-col gap-5 p-4">{children}</div>
    </section>
  );
}

/** A right-aligned number; zero is muted so the non-zero cells of a matrix stand out. */
function CountCell({ value, className }: { value: number; className?: string }) {
  return (
    <TableCell className={cn("text-right tabular-nums", value === 0 ? "text-slate-500" : "text-slate-900", className)}>
      {value}
    </TableCell>
  );
}

function SortHead({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: StateSortKey;
  sort: StateSort;
  onSort: (key: StateSortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.descending ? ArrowDown : ArrowUp;

  return (
    <TableHead
      aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
      className={align === "right" ? "text-right" : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 rounded-sm font-medium outline-none hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <Icon size={12} aria-hidden="true" className={active ? "text-slate-900" : "text-slate-400"} />
      </button>
    </TableHead>
  );
}

/** Coverage by state: sortable on every column, top 10 unless expanded (spec §4.3). */
function StateCoverageTable({ coverage }: { coverage: AdminOverviewCoverage }) {
  const { t } = useLanguage();
  const [stateSort, setStateSort] = useState<StateSort>({ key: "total", descending: true });
  const [showAllStates, setShowAllStates] = useState(false);
  const levels = stateLevelColumns(coverage.byLevel);
  const rows = visibleStates(coverage.byState, stateSort, showAllStates);
  const onSort = (key: StateSortKey) => setStateSort((current) => toggleStateSort(current, key));

  return (
    <div className="rounded-lg border border-slate-100">
      <Table>
        <TableHeader>
          <TableRow>
            <SortHead label={t("admin.overviewByState")} sortKey="stateCode" sort={stateSort} onSort={onSort} />
            <SortHead label={t("admin.overviewColumnTotal")} sortKey="total" sort={stateSort} onSort={onSort} align="right" />
            {levels.map((level) => (
              <SortHead key={level} label={t(`admin.coverageLevel_${level}`)} sortKey={level} sort={stateSort} onSort={onSort} align="right" />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.stateCode}>
              <TableCell className="font-medium text-slate-900">{row.stateCode}</TableCell>
              <CountCell value={row.total} />
              {levels.map((level) => (
                <CountCell key={level} value={row.byLevel[level] ?? 0} />
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {coverage.byState.length > TOP_STATES && (
        <div className="border-t border-slate-100 px-2 py-1.5">
          <Button type="button" variant="ghost" size="sm" aria-expanded={showAllStates} onClick={() => setShowAllStates((current) => !current)}>
            {showAllStates
              ? t("admin.overviewShowTopStates")
              : t("admin.overviewShowAllStates").replace("{count}", String(coverage.byState.length))}
          </Button>
        </div>
      )}
    </div>
  );
}

function CoverageBlock({ title, coverage }: { title: string; coverage: AdminOverviewCoverage }) {
  const { t } = useLanguage();
  const largestLevelTotal = Math.max(0, ...coverage.byLevel.map((entry) => entry.total));

  return (
    <OverviewBlock icon={Database} title={title}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label={t("admin.overviewTotalSources")} value={coverage.totals.sources} icon={Database} />
        <SummaryCard label={t("admin.overviewScheduled")} value={coverage.totals.scheduled} icon={ShieldCheck} />
        <SummaryCard label={t("admin.overviewAwaitingApproval")} value={coverage.totals.awaitingApproval} icon={AlertTriangle} />
        <SummaryCard label={t("admin.overviewNeverRun")} value={coverage.totals.neverRun} icon={Activity} />
      </div>
      <div className="rounded-lg border border-slate-100">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.overviewByLevel")}</TableHead>
              <TableHead className="min-w-48">{t("admin.overviewColumnTotal")}</TableHead>
              <TableHead className="text-right">{t("admin.overviewColumnEnabled")}</TableHead>
              <TableHead className="text-right">{t("admin.overviewColumnApproved")}</TableHead>
              <TableHead className="text-right">{t("admin.overviewColumnAwaiting")}</TableHead>
              <TableHead className="text-right">{t("admin.overviewColumnBlocked")}</TableHead>
              <TableHead className="text-right">{t("admin.overviewColumnNeverRun")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {coverage.byLevel.map((entry) => (
              <TableRow key={entry.level}>
                <TableCell className="font-medium text-slate-900">{t(`admin.coverageLevel_${entry.level}`)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="w-12 text-right tabular-nums text-slate-900">{entry.total}</span>
                    <div className="min-w-24 flex-1">
                      <Bar value={entry.total} max={largestLevelTotal} />
                    </div>
                  </div>
                </TableCell>
                <CountCell value={entry.enabled} />
                <CountCell value={entry.approved} />
                <CountCell value={entry.awaitingApproval} />
                <CountCell value={entry.blocked} />
                <CountCell value={entry.neverRun} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <StateCoverageTable coverage={coverage} />
    </OverviewBlock>
  );
}

function PipelineBlock({ title, rows }: { title: string; rows: AdminOverviewPipelineRow[] }) {
  const { t } = useLanguage();

  return (
    <OverviewBlock
      icon={ShieldCheck}
      title={title}
      action={
        <Link href="/admin/sources/onboarding" className={HEADER_LINK_CLASS}>
          {t("admin.overviewPipelineOpen")}
        </Link>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{t("admin.overviewPipelineEmpty")}</p>
      ) : (
        <div className="rounded-lg border border-slate-100">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.platformReviewFamily")}</TableHead>
                <TableHead>{t("admin.platformReviewStatus")}</TableHead>
                {BUCKETS.map((bucket) => (
                  <TableHead key={bucket} className="text-right">
                    {t(`admin.ledgeredApprovalBucket_${bucket}`)}
                  </TableHead>
                ))}
                <TableHead className="text-right">{t("admin.overviewPipelineQueued")}</TableHead>
                <TableHead>{t("admin.overviewPipelineOldestQueued")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.providerFamily}>
                  <TableCell className="font-medium text-slate-900">{row.providerFamily}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={reviewStatusTone(row.platformReview.status)}>
                      {t(`admin.platformReviewStatus_${row.platformReview.status}`)}
                    </Badge>
                    {row.platformReview.review && (
                      <div className="mt-1 text-xs text-slate-500">
                        {t("admin.overviewPipelineNextReview").replace("{date}", formatDate(row.platformReview.review.nextReviewAt))}
                      </div>
                    )}
                  </TableCell>
                  {BUCKETS.map((bucket) => (
                    <CountCell key={bucket} value={row.counts[bucket]} />
                  ))}
                  <CountCell value={row.queued} />
                  <TableCell>{formatDate(row.oldestQueuedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </OverviewBlock>
  );
}

function RunsTable({ title, counts }: { title: string; counts: AdminOverviewRunCounts }) {
  const { t } = useLanguage();

  return (
    <div className="rounded-lg border border-slate-100">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead colSpan={2}>{title}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>{t("admin.overviewRunsSuccess")}</TableCell>
            <CountCell value={counts.success} />
          </TableRow>
          <TableRow>
            <TableCell>{t("admin.overviewRunsFailure")}</TableCell>
            <CountCell value={counts.failure} className={counts.failure > 0 ? "text-rose-700" : undefined} />
          </TableRow>
          <TableRow>
            <TableCell>{t("admin.overviewRunsOther")}</TableCell>
            <CountCell value={counts.other} />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function CrawlHealthBlock({ title, health }: { title: string; health: AdminOverviewCrawlHealth }) {
  const { t } = useLanguage();

  return (
    <OverviewBlock icon={Activity} title={title}>
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label={t("admin.overviewLastRunAt")} value={formatDate(health.lastRunAt)} icon={Clock} />
        <SummaryCard label={t("admin.overviewFailingSources")} value={health.failingSources} icon={AlertTriangle} />
        <SummaryCard label={t("admin.overviewThrottleEvents")} value={health.throttleEvents24h} icon={Gauge} />
      </div>
      <div className="grid gap-4 lg:grid-cols-4">
        <RunsTable title={t("admin.overviewRuns24h")} counts={health.runs24h} />
        <RunsTable title={t("admin.overviewRuns7d")} counts={health.runs7d} />
        <div className="rounded-lg border border-slate-100 lg:col-span-2">
          {health.worstFailing.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">{t("admin.overviewNoFailing")}</p>
          ) : (
            <ul aria-label={t("admin.overviewFailingSources")} className="divide-y divide-slate-100">
              {health.worstFailing.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                  <Link href={`/admin/sources/${encodeURIComponent(item.id)}`} className={cn(TEXT_LINK_CLASS, "min-w-0 flex-1 truncate")}>
                    {item.label}
                  </Link>
                  <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                    {item.consecutiveFailures}
                  </Badge>
                  <span className="text-xs text-slate-500">{formatDate(item.lastFailureAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500">{t("admin.overviewPauseHint")}</p>
    </OverviewBlock>
  );
}

function BidsBlock({ title, bids, canOpenBidQa }: { title: string; bids: AdminOverviewBids; canOpenBidQa: boolean }) {
  const { t } = useLanguage();
  const openLevels = COVERAGE_LEVELS.filter((level) => (bids.openByLevel[level] ?? 0) > 0);
  const largestOpenLevel = Math.max(0, ...openLevels.map((level) => bids.openByLevel[level] ?? 0));

  return (
    <OverviewBlock icon={FileText} title={title}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard label={t("admin.bidLifecycle_open")} value={bids.open} icon={FolderOpen} />
        <SummaryCard label={t("admin.bidLifecycle_closed")} value={bids.closed} icon={Archive} />
        <SummaryCard label={t("admin.bidLifecycle_awarded")} value={bids.awarded} icon={Award} />
        <SummaryCard label={t("admin.overviewBidsNew24h")} value={bids.new24h} icon={FilePlus} />
        <SummaryCard label={t("admin.overviewBidsNew7d")} value={bids.new7d} icon={CalendarPlus} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        {openLevels.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">{t("admin.overviewOpenByLevel")}</h3>
            <ul className="flex flex-col gap-2">
              {openLevels.map((level) => {
                const count = bids.openByLevel[level] ?? 0;
                return (
                  <li key={level} className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-3 text-sm">
                    <span className="truncate text-slate-700">{t(`admin.coverageLevel_${level}`)}</span>
                    <Bar value={count} max={largestOpenLevel} />
                    <span className="text-right font-medium tabular-nums text-slate-900">{count}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <SummaryCard label={t("admin.overviewPendingQa")} value={bids.pendingQa} icon={ClipboardCheck} />
          {canOpenBidQa && (
            <Link href="/admin/quality/bids" className={TEXT_LINK_CLASS}>
              {t("admin.overviewOpenBidQa")}
            </Link>
          )}
        </div>
      </div>
    </OverviewBlock>
  );
}

export function AdminOverviewView() {
  const { t } = useLanguage();
  const { role } = useAdminSession();
  const overview = useAdminResource(loadOverview);

  if (!overview.data) {
    return (
      <AdminSectionStateCard
        action={overview.status === "error" ? () => void overview.reload() : undefined}
        actionLabel={t("admin.refresh")}
        code={overview.status === "error" ? "error" : "loading"}
        message={overview.status === "error" ? t("admin.errorDescription") : t("admin.loading")}
        title={t("admin.nav_overview")}
      />
    );
  }

  const data: AdminOverview = overview.data;
  const isRefreshing = overview.status === "loading";
  // A block the server could not compute arrives as null (spec §10): only that block shows the failure.
  const failed = (title: string) => (
    <AdminSectionStateCard
      action={() => void overview.reload()}
      actionLabel={t("admin.refresh")}
      code="error"
      message={t("admin.overviewSectionFailed")}
      title={title}
    />
  );
  const coverageTitle = t("admin.overviewCoverageTitle");
  const pipelineTitle = t("admin.overviewPipelineTitle");
  const crawlTitle = t("admin.overviewCrawlTitle");
  const bidsTitle = t("admin.overviewBidsTitle");
  const canOpenBidQa = canViewAdminPath(role, "/admin/quality/bids");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">{t("admin.overviewGeneratedAt").replace("{time}", formatDate(data.generatedAt))}</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void overview.reload()}
          disabled={isRefreshing}
          className="h-9 rounded-lg border-slate-200 px-3"
        >
          <RefreshCw size={14} aria-hidden="true" className={isRefreshing ? "animate-spin" : undefined} />
          {t("admin.refresh")}
        </Button>
      </div>
      {overview.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}
      {data.coverage ? <CoverageBlock title={coverageTitle} coverage={data.coverage} /> : failed(coverageTitle)}
      {data.pipeline ? <PipelineBlock title={pipelineTitle} rows={data.pipeline} /> : failed(pipelineTitle)}
      {data.crawlHealth ? <CrawlHealthBlock title={crawlTitle} health={data.crawlHealth} /> : failed(crawlTitle)}
      {data.bids ? <BidsBlock title={bidsTitle} bids={data.bids} canOpenBidQa={canOpenBidQa} /> : failed(bidsTitle)}
    </div>
  );
}
