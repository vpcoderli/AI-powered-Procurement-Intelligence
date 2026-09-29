"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  batchUpdateAdminDataSources,
  getAdminApprovalReadiness,
  requestAdminSourcePrechecks,
  type AdminApprovalReadinessBucket,
  type AdminApprovalReadinessEntry,
  type AdminApprovalReadinessSummary,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { platformReviewDateLabel, platformReviewStatusTone } from "./PlatformReviewsPanel";

/**
 * Ledgered batch approval panel (spec docs/superpowers/specs/2026-09-24-county-data-completeness-design.md
 * §7.3).
 *
 * A local (county/city/township/special-district) source is approved in bulk only when all three checks
 * hold: its platform has a valid review, its precheck is `ready`/`empty` and at most 14 days old, and its
 * `base_url` is still the one that was prechecked. The server evaluates those checks, both for the counts
 * shown here (`GET /api/admin/data-sources/approval-readiness`) and again when a batch is submitted, so the
 * panel never decides eligibility itself: "Approve all approvable" only sends the ids the readiness read put
 * in the `approvable` bucket, 100 per request, and reports what the server did with each.
 *
 * `needs_fix` sources stay unapproved. The panel lists the address the tenant probe suggested next to the
 * current one as plain text: it never writes a suggestion into `base_url`; a person edits the source.
 */

export const APPROVAL_BATCH_CHUNK_SIZE = 100;

/** The readiness list can hold every registered county; the panel renders this many `needs_fix` rows. */
export const NEEDS_FIX_LIST_LIMIT = 50;

const READINESS_BUCKETS: readonly AdminApprovalReadinessBucket[] = [
  "approvable",
  "awaiting_precheck",
  "needs_fix",
  "missing_platform_review",
  "approved",
  "blocked",
];

const BUCKET_TONE: Record<AdminApprovalReadinessBucket, string> = {
  approvable: "border-emerald-200 bg-emerald-50 text-emerald-700",
  awaiting_precheck: "border-sky-200 bg-sky-50 text-sky-700",
  needs_fix: "border-rose-200 bg-rose-50 text-rose-700",
  missing_platform_review: "border-amber-200 bg-amber-50 text-amber-700",
  approved: "border-slate-200 bg-white text-slate-700",
  blocked: "border-slate-200 bg-slate-50 text-slate-500",
};

/** Reasons the console has a sentence for (`admin.ledgeredApprovalReason_<reason>`). */
const KNOWN_REASONS = [
  "missing_platform_review",
  "platform_review_expired",
  "precheck_missing",
  "precheck_stale",
  "precheck_needs_fix",
  "base_url_changed",
  "already_approved",
  "blocked",
] as const;

export function chunkSourceIds(ids: readonly string[], size = APPROVAL_BATCH_CHUNK_SIZE): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += size) chunks.push(ids.slice(start, start + size));
  return chunks;
}

export function approvableIds(summary: AdminApprovalReadinessSummary): string[] {
  return summary.sources.filter((entry) => entry.bucket === "approvable").map((entry) => entry.id);
}

export interface OutcomeTally {
  approved: number;
  skipped: number;
  byReason: Record<string, number>;
}

export function tallyOutcomes(
  outcomes: readonly { outcome: string; reason: string | null }[],
  into: OutcomeTally = { approved: 0, skipped: 0, byReason: {} },
): OutcomeTally {
  for (const entry of outcomes) {
    if (entry.outcome === "approved") into.approved += 1;
    else {
      into.skipped += 1;
      const key = entry.reason ?? entry.outcome;
      into.byReason[key] = (into.byReason[key] ?? 0) + 1;
    }
  }
  return into;
}

const LOCAL_LEVELS = new Set(["county", "city", "township", "special_district"]);

export function providerFamiliesOf(
  sources: readonly { providerFamily: string | null; jurisdictionLevel: string | null }[],
): string[] {
  const families = new Set(
    sources
      .filter((source) => source.providerFamily && LOCAL_LEVELS.has(source.jurisdictionLevel ?? ""))
      .map((source) => source.providerFamily as string),
  );
  return [...families].sort((a, b) => (a === "bidnet" ? -1 : b === "bidnet" ? 1 : a.localeCompare(b)));
}

/**
 * i18n key for a reason, or null for one the console has no sentence for. `t()` echoes an unknown
 * dot-path back verbatim, so an unmapped reason would render as a raw key; showing the server's own
 * string is the readable failure.
 */
export function approvalReasonKey(reason: string | null): string | null {
  if (!reason) return null;
  return (KNOWN_REASONS as readonly string[]).includes(reason) ? `admin.ledgeredApprovalReason_${reason}` : null;
}

/**
 * The tenant probe's suggested address for a source, only when there is one and it differs from the
 * address the row already has. Display only: nothing in the console writes it anywhere.
 */
export function suggestedAddressFor(
  entry: Pick<AdminApprovalReadinessEntry, "baseUrl" | "suggestedBaseUrl">,
): string | null {
  const suggested = entry.suggestedBaseUrl?.trim();
  if (!suggested) return null;
  return suggested === (entry.baseUrl ?? "").trim() ? null : suggested;
}

/** The `needs_fix` rows to render (at most `limit`) and how many more the summary holds. */
export function needsFixList(
  summary: AdminApprovalReadinessSummary,
  limit = NEEDS_FIX_LIST_LIMIT,
): { entries: AdminApprovalReadinessEntry[]; hidden: number } {
  const all = summary.sources.filter((entry) => entry.bucket === "needs_fix");
  return { entries: all.slice(0, limit), hidden: Math.max(0, all.length - limit) };
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export interface LedgeredApprovalPanelProps {
  /** Platforms that have local sources, in the order to offer them (see `providerFamiliesOf`). */
  providerFamilies: string[];
  /** Admin only: the batch route accepts `approve` from admins alone. */
  canApprove: boolean;
  /** Admin or operator: queues sources for the crawler worker's precheck loop. */
  canRequestPrechecks: boolean;
  disabled?: boolean;
  /**
   * Changing this re-reads the readiness. The page bumps it when a platform review is saved, because
   * the review decides which sources are approvable and this panel would otherwise keep showing the
   * previous review's state until "Refresh" is pressed.
   */
  refreshKey?: number;
}

export function LedgeredApprovalPanel({
  providerFamilies,
  canApprove,
  canRequestPrechecks,
  disabled = false,
  refreshKey = 0,
}: LedgeredApprovalPanelProps) {
  const { t } = useLanguage();
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ family: string; summary: AdminApprovalReadinessSummary } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [isQueueing, setIsQueueing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<OutcomeTally | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // A stale selection (the family vanished from the sources list) falls back to the first one offered.
  const family =
    selectedFamily && providerFamilies.includes(selectedFamily) ? selectedFamily : (providerFamilies[0] ?? null);
  const summary = loaded && loaded.family === family ? loaded.summary : null;

  useEffect(() => {
    if (!family) return;
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      setIsLoading(true);
      setLoadError(null);
      getAdminApprovalReadiness(family)
        .then((response) => {
          if (cancelled) return;
          setLoaded({ family, summary: response });
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          setLoadError(errorMessage(caught));
        })
        .finally(() => {
          if (cancelled) return;
          setIsLoading(false);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [family, reloadTick, refreshKey]);

  const approvable = useMemo(() => (summary ? approvableIds(summary) : []), [summary]);
  const needsFix = useMemo(() => (summary ? needsFixList(summary) : { entries: [], hidden: 0 }), [summary]);

  const reviewStatus = summary?.platformReview?.status ?? "missing";
  const review = summary?.platformReview?.review ?? null;
  const isBusy = disabled || isQueueing || isApproving;

  const reasonLabel = (reason: string | null) => {
    if (!reason) return "";
    const key = approvalReasonKey(reason);
    return key ? t(key) : reason;
  };

  const chooseFamily = (next: string) => {
    setSelectedFamily(next);
    setQueuedMessage(null);
    setProgress(null);
    setResult(null);
    setActionError(null);
  };

  const queuePrechecks = () => {
    if (!family || isBusy) return;

    setIsQueueing(true);
    setActionError(null);
    setQueuedMessage(null);
    requestAdminSourcePrechecks({ providerFamily: family, pending: true })
      .then((response) => {
        setQueuedMessage(t("admin.ledgeredApprovalQueued").replace("{count}", String(response.requestedCount)));
        setReloadTick((tick) => tick + 1);
      })
      .catch((caught: unknown) => {
        setActionError(errorMessage(caught));
      })
      .finally(() => setIsQueueing(false));
  };

  const approveAll = async () => {
    if (!summary || isBusy) return;

    const ids = approvableIds(summary);
    if (ids.length === 0) return;

    setIsApproving(true);
    setActionError(null);
    setQueuedMessage(null);
    setResult(null);
    const tally: OutcomeTally = { approved: 0, skipped: 0, byReason: {} };
    let done = 0;

    try {
      for (const chunk of chunkSourceIds(ids)) {
        const response = await batchUpdateAdminDataSources({ sourceIds: chunk, action: "approve" });
        tallyOutcomes(
          response.outcomes ?? chunk.map((sourceId) => ({ sourceId, outcome: "approved", reason: null })),
          tally,
        );
        done += chunk.length;
        setProgress(
          t("admin.ledgeredApprovalProgress")
            .replace("{done}", String(done))
            .replace("{total}", String(ids.length)),
        );
      }
    } catch (caught) {
      // Earlier chunks are already approved; the tally below and the reload that follows show how far it got.
      setActionError(t("admin.ledgeredApprovalFailed").replace("{message}", errorMessage(caught)));
    } finally {
      if (tally.approved + tally.skipped > 0) setResult(tally);
      setProgress(null);
      setIsApproving(false);
      setReloadTick((tick) => tick + 1);
    }
  };

  return (
    <div className="border-b border-slate-100 px-4 py-3" data-testid="ledgered-approval-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-950">{t("admin.ledgeredApprovalTitle")}</div>
          <div className="text-xs text-slate-500">{t("admin.ledgeredApprovalDescription")}</div>
        </div>
        {family && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setReloadTick((tick) => tick + 1)}
            disabled={isLoading || isApproving}
            className="h-8 rounded-lg border-slate-200 px-3 text-xs"
          >
            <RefreshCw size={14} className={isLoading ? "animate-spin" : undefined} />
            {t("admin.ledgeredApprovalRefresh")}
          </Button>
        )}
      </div>

      {!family ? (
        <div className="mt-2 text-xs font-medium text-slate-500">{t("admin.ledgeredApprovalNoSources")}</div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase text-slate-500">{t("admin.ledgeredApprovalFamily")}</span>
            {providerFamilies.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => chooseFamily(option)}
                disabled={isApproving || isQueueing}
                className={`rounded-full border px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
                  option === family
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          {loadError && (
            <p role="alert" className="mt-2 text-xs text-rose-600">
              {loadError}
            </p>
          )}

          {!summary && !loadError && <div className="mt-2 text-xs font-medium text-slate-500">{t("admin.loading")}</div>}

          {summary && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="ledgered-approval-review">
                <span className="font-semibold uppercase text-slate-500">{t("admin.platformReviewsTitle")}</span>
                <Badge variant="outline" className={platformReviewStatusTone(reviewStatus)}>
                  {t(`admin.platformReviewStatus_${reviewStatus}`)}
                </Badge>
                {review && (
                  <span className="text-slate-500">
                    {t("admin.platformReviewNextReviewAt")}: {platformReviewDateLabel(review.nextReviewAt)}
                  </span>
                )}
              </div>
              {reviewStatus !== "valid" && (
                <p className="mt-1 text-xs font-medium text-amber-700">{t("admin.ledgeredApprovalReviewExpiredHint")}</p>
              )}

              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {READINESS_BUCKETS.map((bucket) => (
                  <div
                    key={bucket}
                    data-testid={`ledgered-approval-count-${bucket}`}
                    className={`rounded-lg border px-3 py-2 ${BUCKET_TONE[bucket]}`}
                  >
                    <div className="text-lg font-semibold leading-6">{summary.counts[bucket] ?? 0}</div>
                    <div className="text-xs font-medium">{t(`admin.ledgeredApprovalBucket_${bucket}`)}</div>
                  </div>
                ))}
              </div>

              {(canRequestPrechecks || canApprove) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {canRequestPrechecks && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={queuePrechecks}
                      disabled={isBusy}
                      className="h-8 rounded-lg border-slate-200 px-3 text-xs"
                    >
                      {t("admin.ledgeredApprovalQueuePrechecks")}
                    </Button>
                  )}
                  {canApprove && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void approveAll()}
                      disabled={isBusy || isLoading || approvable.length === 0 || reviewStatus !== "valid"}
                      className="h-8 rounded-lg px-3 text-xs"
                    >
                      {t("admin.ledgeredApprovalApproveAll").replace("{count}", String(approvable.length))}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}

          {progress && (
            <p role="status" className="mt-2 text-xs font-medium text-slate-600">
              {progress}
            </p>
          )}

          {queuedMessage && (
            <p role="status" className="mt-2 text-xs font-medium text-emerald-700">
              {queuedMessage}
            </p>
          )}

          {result && (
            <div className="mt-2 text-xs" role="status" data-testid="ledgered-approval-result">
              <p className="font-medium text-slate-700">
                {t("admin.ledgeredApprovalResult")
                  .replace("{approved}", String(result.approved))
                  .replace("{skipped}", String(result.skipped))}
              </p>
              {Object.keys(result.byReason).length > 0 && (
                <ul className="mt-0.5 grid gap-0.5 text-slate-500">
                  {Object.entries(result.byReason)
                    .sort((a, b) => b[1] - a[1])
                    .map(([reason, count]) => (
                      <li key={reason}>
                        {reasonLabel(reason)}: {count}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}

          {actionError && (
            <p role="alert" className="mt-2 text-xs text-rose-600">
              {actionError}
            </p>
          )}

          {summary && needsFix.entries.length > 0 && (
            <div
              className="mt-3 rounded-lg border border-rose-100 bg-rose-50/40 p-3 text-xs"
              data-testid="ledgered-approval-needs-fix"
            >
              <div className="font-semibold text-slate-800">
                {t("admin.ledgeredApprovalNeedsFixTitle")} ({summary.counts.needs_fix ?? needsFix.entries.length})
              </div>
              <p className="mt-0.5 text-slate-500">{t("admin.ledgeredApprovalNeedsFixHint")}</p>
              <ul className="mt-2 grid max-h-72 gap-2 overflow-y-auto">
                {needsFix.entries.map((entry) => {
                  const suggested = suggestedAddressFor(entry);
                  return (
                    <li
                      key={entry.id}
                      className="rounded border border-slate-200 bg-white p-2"
                      data-testid={`ledgered-approval-needs-fix-${entry.id}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-800">{entry.label}</span>
                        {entry.reason && <span className="text-slate-500">{reasonLabel(entry.reason)}</span>}
                      </div>
                      <div className="mt-1 break-all text-slate-600">
                        <span className="font-medium">{t("admin.ledgeredApprovalCurrentAddress")}:</span>{" "}
                        {entry.baseUrl ?? "-"}
                      </div>
                      {suggested && (
                        <div className="mt-0.5 break-all text-amber-800">
                          <span className="font-medium">{t("admin.ledgeredApprovalSuggestedAddress")}:</span>{" "}
                          {suggested}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {needsFix.hidden > 0 && (
                <div className="mt-1 text-slate-500">
                  {t("admin.ledgeredApprovalNeedsFixMore").replace("{count}", String(needsFix.hidden))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
