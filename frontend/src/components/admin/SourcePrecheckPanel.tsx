"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  precheckAdminDataSource,
  updateAdminDataSource,
  type AdminDataSource,
  type AdminSourcePrecheckResult,
  type AdminSourcePrecheckVerdict,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { ApproveLocalSourceDialog, isLocalJurisdictionSource } from "./ApproveLocalSourceDialog";
import { runPanelWrite, trackBusy, useBusyTracker } from "./busy-reporting";

/**
 * Per-source approval pre-check card (contract C5 of
 * docs/superpowers/plans/2026-09-16-local-source-governance-recovery.md).
 *
 * Answers the question a human has to answer before approving a county/city source: is the portal
 * reachable, does robots.txt allow the list path, does a `limit=5` dry run actually parse rows (or
 * a *verified* empty list), and — when the tenant path 404s — is there a better `base_url`. The
 * dry run writes no bids; the suggested base URL is never applied automatically, because a wrong
 * tenant path silently ingests another jurisdiction's solicitations.
 */

export function precheckVerdictTone(verdict: AdminSourcePrecheckVerdict): string {
  if (verdict === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (verdict === "empty") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

/** i18n key for the fetch line's headline, keyed by the dry run's outcome. */
export function precheckFetchStatusKey(result: AdminSourcePrecheckResult): string {
  return `admin.sourcePrecheckFetch_${result.fetch.status}`;
}

const KNOWN_LIST_METHODS = ["scrapling", "adapter", "adapter_fallback"] as const;

/**
 * i18n key for `metadata.listExtraction.method`, or null for a method this UI does not know.
 * `t()` echoes an unknown dot-path back verbatim, so an unmapped method would render as a raw
 * key; falling back to the crawler's own string is the readable failure.
 */
export function precheckListMethodKey(method: string | null): string | null {
  if (!method) return null;
  return (KNOWN_LIST_METHODS as readonly string[]).includes(method)
    ? `admin.sourcePrecheckListMethod_${method}`
    : null;
}

export interface PrecheckRequestHandlers {
  onResult: (result: AdminSourcePrecheckResult) => void;
  onError: (message: string) => void;
  onCompleted?: () => void;
}

/**
 * Sends one precheck request and routes what came back. `onCompleted` runs once, after `onResult`, and only when the
 * request succeeded: that is the one case where the server has written the precheck into the row's robots and
 * live-health columns, so a parent holding a copy of the row has something to re-read. It sits outside the try on
 * purpose: a failing refresh is not a failed precheck, and must not be shown as one beside the result just displayed.
 */
export async function runPrecheckRequest(
  send: () => Promise<AdminSourcePrecheckResult>,
  handlers: PrecheckRequestHandlers,
): Promise<void> {
  let result: AdminSourcePrecheckResult;
  try {
    result = await send();
  } catch (caught: unknown) {
    // Server message verbatim: PRECHECK_FAILED carries which leg (robots, crawler spawn,
    // tenant discovery) was unavailable, and that is the actionable part.
    handlers.onError(caught instanceof Error ? caught.message : String(caught));
    return;
  }
  handlers.onResult(result);
  handlers.onCompleted?.();
}

export interface SourcePrecheckPanelProps {
  source: AdminDataSource;
  /** Signed-in admin's email; prefills the approval form's reviewer field. */
  reviewerEmail: string | null;
  disabled?: boolean;
  /**
   * Offer the ledgered "approve county/city source" form. Its PATCH writes governance fields, which the API answers
   * 403 to an operator, so a page passes whether the viewer is an admin. Defaults to true: a mount that says nothing
   * keeps the form.
   */
  canApprove?: boolean;
  onSourceUpdated: (source: AdminDataSource) => void;
  /**
   * Called once each time a precheck request succeeds, after the panel has shown its result. The server has then
   * written that result into the row's robots and live-health columns, so the parent's copy of the row is stale.
   * Not called when the request fails (nothing was written); the base URL adoption hands its row back through
   * `onSourceUpdated` instead.
   *
   * It must not throw. It runs after runPrecheckRequest's try, so a throw makes that promise reject, and the button
   * handler discards it (the click runs the request inside trackBusy and ends with `.finally(...)`; trackBusy's own finally
   * still releases the page lock): the error escapes as an unhandled promise rejection, with nothing on the page
   * saying so. Handle a failed refresh inside the callback; a parent that reloads
   * passes something like `() => void resource.reload()`, and `reload` records its own failure instead of rejecting.
   */
  onPrecheckCompleted?: () => void;
  /**
   * Called with `true` when the card starts a write (a precheck request, the base URL adoption, or the approval form's
   * PATCH) and with `false` once the last write in flight settled, success or failure, so a page can hold its other
   * controls meanwhile. Overlapping writes are one busy episode. Unmounting while a write is in flight reports
   * `false` too. Optional: a mount that says nothing behaves as before.
   */
  onBusyChange?: (busy: boolean) => void;
  /** Injectable for tests; defaults to the browser confirm dialog. */
  confirmAdopt?: (message: string) => boolean;
}

export function SourcePrecheckPanel({
  source,
  reviewerEmail,
  disabled = false,
  canApprove = true,
  onSourceUpdated,
  onPrecheckCompleted,
  onBusyChange,
  confirmAdopt,
}: SourcePrecheckPanelProps) {
  const { t } = useLanguage();
  const busy = useBusyTracker(onBusyChange);
  // The approval form runs a write of its own. Its reports join this card's, so the page sees one busy signal for the
  // whole card however its writes overlap.
  const approvalBusyChange = useMemo(() => busy.forward("approval"), [busy]);
  const [result, setResult] = useState<AdminSourcePrecheckResult | null>(null);
  const [running, setRunning] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPrecheck = () => {
    setRunning(true);
    setError(null);
    void trackBusy(busy, () =>
      runPrecheckRequest(() => precheckAdminDataSource(source.id, { limit: 5 }), {
        onResult: setResult,
        onError: setError,
        onCompleted: onPrecheckCompleted,
      }),
    ).finally(() => setRunning(false));
  };

  const adoptSuggestedBaseUrl = () => {
    const suggested = result?.suggestedBaseUrl;
    if (!suggested) return;

    const confirmFn = confirmAdopt ?? ((message: string) => window.confirm(message));
    if (!confirmFn(t("admin.sourcePrecheckAdoptConfirm").replace("{url}", suggested))) return;

    setAdopting(true);
    setError(null);
    void runPanelWrite(busy, () => updateAdminDataSource(source.id, { baseUrl: suggested }), {
      onWritten: ({ source: updated }) => {
        onSourceUpdated(updated);
        setResult((current) => (current ? { ...current, suggestedBaseUrl: null } : current));
      },
      onError: setError,
      onSettled: () => setAdopting(false),
    });
  };

  return (
    <div
      className="mt-2 grid max-w-64 gap-2 rounded-md border border-slate-200 bg-white p-2 text-xs leading-5 text-slate-600"
      data-testid={`source-precheck-${source.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-700">{t("admin.sourcePrecheckTitle")}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={runPrecheck}
          disabled={disabled || running}
          className="h-7 rounded-lg border-slate-200 px-2 text-xs"
        >
          {running ? t("admin.sourcePrecheckRunning") : t("admin.sourcePrecheckRun")}
        </Button>
      </div>

      {!result && !error && <div className="text-slate-500">{t("admin.sourcePrecheckIdle")}</div>}

      {error && (
        <p role="alert" className="text-rose-600">
          {error}
        </p>
      )}

      {result && (
        <div className="grid gap-1" data-testid={`source-precheck-result-${source.id}`}>
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="outline" className={precheckVerdictTone(result.verdict)}>
              {t(`admin.sourcePrecheckVerdict_${result.verdict}`)}
            </Badge>
            <span className="text-slate-500">{result.checkedAt}</span>
          </div>

          <div>
            <span className="font-medium text-slate-600">{t("admin.sourcePrecheckRobots")}:</span>{" "}
            {result.robots.flagged ? t("admin.sourcePrecheckRobotsFlagged") : t("admin.sourcePrecheckRobotsClear")}
            {result.robots.flagReason ? ` · ${result.robots.flagReason}` : ""}
          </div>

          <div>
            <span className="font-medium text-slate-600">{t("admin.sourcePrecheckFetch")}:</span>{" "}
            {t(precheckFetchStatusKey(result))}
            {" · "}
            {t("admin.sourcePrecheckItems").replace("{count}", String(result.fetch.items))}
            {result.fetch.httpStatus ? ` · HTTP ${result.fetch.httpStatus}` : ""}
            {result.fetch.wafChallenge ? ` · ${t("admin.sourcePrecheckWaf")}` : ""}
          </div>

          {result.fetch.sample.length > 0 && (
            <ul className="grid gap-0.5 text-slate-500">
              {result.fetch.sample.slice(0, 3).map((item, index) => (
                <li
                  key={item.url ?? `sample-${index}`}
                  className="truncate"
                  title={item.title ?? item.url ?? undefined}
                >
                  {item.title ?? item.url ?? t("admin.sourcePrecheckSampleUntitled")}
                </li>
              ))}
            </ul>
          )}

          {result.fetch.listMethod && (
            <div>
              <span className="font-medium text-slate-600">{t("admin.sourcePrecheckListMethod")}:</span>{" "}
              {(() => {
                const key = precheckListMethodKey(result.fetch.listMethod);
                return key ? t(key) : result.fetch.listMethod;
              })()}
            </div>
          )}

          {(result.fetch.errorCode || result.fetch.errorMessage) && (
            <div className="text-rose-700">
              <span className="font-medium">{t("admin.sourcePrecheckError")}:</span>{" "}
              {[result.fetch.errorCode, result.fetch.errorMessage].filter(Boolean).join(" · ")}
            </div>
          )}

          {result.reasons.length > 0 && (
            <ul className="grid gap-0.5 text-slate-500">
              {result.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}

          {result.suggestedBaseUrl && (
            <div className="grid gap-1 rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">
              <div className="break-all">
                <span className="font-medium">{t("admin.sourcePrecheckSuggestedBaseUrl")}:</span>{" "}
                {result.suggestedBaseUrl}
              </div>
              <div>{t("admin.sourcePrecheckSuggestedBaseUrlHint")}</div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={adoptSuggestedBaseUrl}
                disabled={disabled || adopting}
                className="h-7 rounded-lg border-amber-300 px-2 text-xs text-amber-800"
              >
                {adopting ? t("admin.sourcePrecheckAdopting") : t("admin.sourcePrecheckAdopt")}
              </Button>
            </div>
          )}
        </div>
      )}

      {canApprove && isLocalJurisdictionSource(source) && (
        <ApproveLocalSourceDialog
          source={source}
          reviewerEmail={reviewerEmail}
          precheck={result}
          disabled={disabled}
          onApproved={onSourceUpdated}
          onBusyChange={approvalBusyChange}
        />
      )}
    </div>
  );
}
