import { batchStatusFromRunResult } from "@/components/admin/JurisdictionBatchRunPanel";
import type { BatchUpdateAdminDataSourcesResponse, StateCrawlerRunResponse } from "@/lib/api/admin";
import type { AdminDataSourceIndexItem } from "@/server/admin/data-source-list-contract";
import { crawlerRunIdFor, type CrawlerRunSource } from "./crawler-run-id";

/** Spec §5.2 limits. */
// The precheck-requests route refuses more than MAX_REQUESTED_IDS (500) ids in one request (src/server/admin/precheck-queue.ts).
// That module belongs to the phase-3 governance code, which this page does not import from, so the limit is repeated here.
export const PRECHECK_REQUEST_CHUNK = 500;
export const RUN_NOW_LIMIT = 20;

export function runTargets(items: readonly CrawlerRunSource[]): { runIds: string[]; skippedIds: string[] } {
  const runIds: string[] = [];
  const skippedIds: string[] = [];
  for (const item of items) {
    const runId = crawlerRunIdFor(item);
    if (runId) runIds.push(runId);
    else skippedIds.push(item.id);
  }
  return { runIds: Array.from(new Set(runIds)), skippedIds };
}

/** success → ok; failure and unknown ids → failed; blocked/locked/disabled/deferred → skipped. */
export function summarizeRunResults(response: StateCrawlerRunResponse): { ok: number; failed: number; skipped: number } {
  let ok = 0;
  let failed = response.errors?.length ?? 0;
  let skipped = 0;
  for (const result of response.results) {
    if (result.status === "success") ok += 1;
    else if (result.status === "failure") failed += 1;
    else skipped += 1;
  }
  return { ok, failed, skipped };
}

/** What the precheck rule reads from a row; a list item and an index item both carry it. */
export type PrecheckCandidate = Pick<AdminDataSourceIndexItem, "id" | "level" | "approvalState" | "isEnabled">;

/**
 * A precheck is meant for a local source (any level other than federal/state, the crawler gate's rule) that is
 * enabled and still awaiting approval. The server does not narrow a by-id request: it flags whatever ids it is
 * given, the crawler worker then prechecks each one, and a precheck rewrites the row's robots.txt and live-health
 * fields, the same ones an admin edits by hand. So the page sends only rows that pass this. The level test cannot
 * be left to `approvalState`: a state or federal row an admin held is read as `awaiting` too.
 */
export function isPrecheckEligible(item: PrecheckCandidate): boolean {
  return item.level !== "federal" && item.level !== "state" && item.approvalState === "awaiting" && item.isEnabled;
}

export interface PrecheckSplit {
  eligibleIds: string[];
  /** How many of the rows were not eligible and are not sent. */
  leftOut: number;
}

export function splitPrecheckTargets(items: readonly PrecheckCandidate[]): PrecheckSplit {
  const eligibleIds: string[] = [];
  for (const item of items) {
    if (isPrecheckEligible(item)) eligibleIds.push(item.id);
  }
  return { eligibleIds, leftOut: items.length - eligibleIds.length };
}

/** What bulk Approve and Hold read from a row; a list item carries it. */
export type ApprovalCandidate = Pick<AdminDataSourceIndexItem, "id" | "approvalState">;

export interface ApprovalSplit {
  targetIds: string[];
  /** How many of the rows were blocked and are not sent. */
  blockedLeftOut: number;
}

/**
 * Bulk Approve and Hold leave blocked rows out. The batch route's hold writes `needs_review` to every id it is
 * given, which would lift a block that no control on the page can put back, and its approve takes a federal or
 * state row, blocked or not, through the generic write without a ledger. A blocked source is changed only on
 * its own page: an explicit Approve (federal/state) or the ledgered approval form (county/city/township).
 */
export function splitApprovalTargets(items: readonly ApprovalCandidate[]): ApprovalSplit {
  const targetIds: string[] = [];
  for (const item of items) {
    if (item.approvalState !== "blocked") targetIds.push(item.id);
  }
  return { targetIds, blockedLeftOut: items.length - targetIds.length };
}

/** What a chunked write added up to, and the failure that stopped it (`failed: false` when every chunk went through). */
export type ChunkedOutcome<Tally> = { tally: Tally; failed: false } | { tally: Tally; failed: true; failure: unknown };

/**
 * Sends the chunks one after another and adds each response to a running tally. The tally lives outside the
 * try/catch on purpose: when a chunk fails the ones before it are already written, so the caller still gets what
 * they added up to, together with the failure that stopped the rest (later chunks are not sent).
 */
export async function sendInChunks<Tally, Response>(
  chunks: readonly (readonly string[])[],
  send: (chunk: string[]) => Promise<Response>,
  add: (tally: Tally, response: Response) => Tally,
  initial: Tally,
): Promise<ChunkedOutcome<Tally>> {
  let tally = initial;
  for (const chunk of chunks) {
    try {
      tally = add(tally, await send([...chunk]));
    } catch (failure) {
      return { tally, failed: true, failure };
    }
  }
  return { tally, failed: false };
}

export interface ApprovalTally {
  approved: number;
  skippedByReason: Record<string, number>;
}

export function emptyApprovalTally(): ApprovalTally {
  return { approved: 0, skippedByReason: {} };
}

/** Adds one batch response: its approved count, and each skipped row under the reason the server gave. */
export function addApprovalResponse(
  tally: ApprovalTally,
  response: Pick<BatchUpdateAdminDataSourcesResponse, "updatedCount" | "outcomes">,
): ApprovalTally {
  const skippedByReason = { ...tally.skippedByReason };
  for (const outcome of response.outcomes ?? []) {
    if (outcome.outcome !== "skipped") continue;
    const reason = outcome.reason ?? "unknown";
    skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
  }
  return { approved: tally.approved + response.updatedCount, skippedByReason };
}

export type Translate = (key: string) => string;

/**
 * The notice a bulk action ends with. `done`: every request went through. `failed`: one stopped the action, so part
 * of it may already be written. `refused`: nothing was sent, so nothing changed.
 */
export interface BulkReport {
  message: string;
  outcome: "done" | "failed" | "refused";
}

/** The server's own words for a failed request (LedgeredApprovalPanel's errorMessage); empty when there are none. */
export function errorText(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  return typeof caught === "string" ? caught : "";
}

function stoppedText(t: Translate, failure: unknown): string {
  return t("admin.sourcesBulkFailed").replace("{message}", errorText(failure) || t("admin.updateFailed"));
}

/** A sentence another can follow: closed with a full stop unless it already ends like a sentence. */
function closed(text: string): string {
  return /[.!?。！？]$/.test(text) ? text : `${text}.`;
}

/** The parts of a notice as one text: every part but the last is closed, so the next one reads as a new sentence. */
function sentences(parts: readonly string[]): string {
  return parts.map((part, index) => (index < parts.length - 1 ? closed(part) : part)).join(" ");
}

/** The sentence for blocked rows a bulk Approve or Hold left out. */
export function blockedLeftOutText(t: Translate, count: number): string {
  return t("admin.sourcesBlockedLeftOut").replace("{count}", String(count));
}

/** A request that failed on its own (not one chunk of several): nothing was tallied, the server's reason is the notice. */
export function failedReport(t: Translate, failure: unknown): BulkReport {
  return { message: stoppedText(t, failure), outcome: "failed" };
}

export function precheckReport(t: Translate, outcome: ChunkedOutcome<number>, leftOut: number): BulkReport {
  const parts: string[] = [];
  if (!outcome.failed || outcome.tally > 0) parts.push(t("admin.sourcesQueuedResult").replace("{count}", String(outcome.tally)));
  if (leftOut > 0) parts.push(t("admin.sourcesPrecheckLeftOut").replace("{count}", String(leftOut)));
  if (outcome.failed) parts.push(stoppedText(t, outcome.failure));
  return { message: parts.join(" "), outcome: outcome.failed ? "failed" : "done" };
}

export function approvalReport(
  text: { t: Translate; reasonLabel: (reason: string) => string },
  outcome: ChunkedOutcome<ApprovalTally>,
  blockedLeftOut = 0,
): BulkReport {
  const { t } = text;
  const { approved, skippedByReason } = outcome.tally;
  const skipped = Object.values(skippedByReason).reduce((sum, count) => sum + count, 0);
  const result = t("admin.ledgeredApprovalResult").replace("{approved}", String(approved)).replace("{skipped}", String(skipped));
  const reasons = Object.entries(skippedByReason)
    .map(([reason, count]) => `${text.reasonLabel(reason)} × ${count}`)
    .join("; ");

  const parts: string[] = [];
  if (!outcome.failed) parts.push(skipped === 0 ? t("admin.sourceBatchApprovalUpdated") : `${result} ${reasons}`);
  else if (approved + skipped > 0) parts.push(skipped === 0 ? result : `${result} ${reasons}`);
  if (blockedLeftOut > 0) parts.push(blockedLeftOutText(t, blockedLeftOut));
  if (outcome.failed) parts.push(stoppedText(t, outcome.failure));
  return { message: sentences(parts), outcome: outcome.failed ? "failed" : "done" };
}

export function holdReport(t: Translate, outcome: ChunkedOutcome<number>, blockedLeftOut = 0): BulkReport {
  const parts: string[] = [];
  if (!outcome.failed || outcome.tally > 0) parts.push(t("admin.sourcesHeldResult").replace("{count}", String(outcome.tally)));
  if (blockedLeftOut > 0) parts.push(blockedLeftOutText(t, blockedLeftOut));
  if (outcome.failed) parts.push(stoppedText(t, outcome.failure));
  return { message: sentences(parts), outcome: outcome.failed ? "failed" : "done" };
}

/** What the run requests of a "Run now" added up to (`summarizeRunResults` of each response). */
export interface RunTally {
  ok: number;
  failed: number;
  skipped: number;
}

export function emptyRunTally(): RunTally {
  return { ok: 0, failed: 0, skipped: 0 };
}

export function addRunResponse(tally: RunTally, response: StateCrawlerRunResponse): RunTally {
  const summary = summarizeRunResults(response);
  return { ok: tally.ok + summary.ok, failed: tally.failed + summary.failed, skipped: tally.skipped + summary.skipped };
}

/** The list's "Run now": what the requests that went through ran, the rows without a run id, and the error that stopped the rest. */
export function runReport(t: Translate, outcome: ChunkedOutcome<RunTally>, notRunnable: number): BulkReport {
  const { ok, failed, skipped } = outcome.tally;
  const ran = ok + failed + skipped;
  const result = t("admin.sourcesRunResult")
    .replace("{count}", String(ran))
    .replace("{ok}", String(ok))
    .replace("{failed}", String(failed))
    .replace("{skipped}", String(skipped));
  const parts: string[] = [];
  if (ran > 0) parts.push(result);
  if (notRunnable > 0) parts.push(t("admin.sourcesNotRunnable").replace("{count}", String(notRunnable)));
  if (outcome.failed) parts.push(stoppedText(t, outcome.failure));
  if (parts.length === 0) parts.push(result);
  return { message: sentences(parts), outcome: outcome.failed ? "failed" : "done" };
}

/**
 * The detail page's "Run now" of one source. The run route answers 200 for a run it did not make (a governance
 * hold, a lock, a platform deferral), so the notice names the source's own outcome instead of a blanket success.
 */
export function singleRunReport(
  t: Translate,
  label: string,
  response: StateCrawlerRunResponse,
): { message: string; tone: "info" | "error" } {
  const summary = summarizeRunResults(response);
  if (summary.failed > 0) return { message: t("admin.runSourceFailed").replace("{source}", label), tone: "error" };
  if (summary.ok > 0 && summary.skipped === 0) return { message: t("admin.runSourceQueued").replace("{source}", label), tone: "info" };
  // The batch panel's reading of a run status: a status it does not know (or no result at all) reads as unknown.
  const notRun = response.results.find((result) => result.status !== "success");
  const read = notRun ? batchStatusFromRunResult(notRun) : null;
  const status = read?.phase === "done" ? read.status : "unknown";
  return {
    message: t("admin.runSourceSkipped").replace("{source}", label).replace("{status}", t(`admin.batchRunStatus_${status}`)),
    tone: "info",
  };
}

/** The question before "Queue all matching" sends anything: how many rows will really be queued, and how many are left out. */
export function precheckConfirmText(t: Translate, split: PrecheckSplit): string {
  const parts = [t("admin.sourcesQueueAllConfirm").replace("{count}", String(split.eligibleIds.length))];
  if (split.leftOut > 0) parts.push(t("admin.sourcesPrecheckLeftOut").replace("{count}", String(split.leftOut)));
  return parts.join(" ");
}

/**
 * A hold stops ingestion (a state or federal portal's too) and a held local source is lifted only on its own page,
 * so a batch hold asks first, with the count it will really send and the blocked rows it leaves out.
 */
export function holdConfirmText(t: Translate, split: ApprovalSplit): string {
  const parts = [t("admin.sourcesHoldConfirm").replace("{count}", String(split.targetIds.length))];
  if (split.blockedLeftOut > 0) parts.push(blockedLeftOutText(t, split.blockedLeftOut));
  return parts.join(" ");
}
