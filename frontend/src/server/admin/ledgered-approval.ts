import type { AppDatabase } from "@/server/db/client";
import {
  isGatedLocalJurisdictionLevel,
  listAdminDataSources,
  listAdminDataSourcesFromMysql,
  missingApprovalRequirements,
  updateAdminDataSource,
  updateAdminDataSourceFromMysql,
  type AdminDataSource,
  type MysqlDataSourcesStore,
  type UpdateAdminDataSourceInput,
} from "./data-sources-repository";
import {
  effectivePlatformReviewsByFamily,
  listPlatformReviews,
  listPlatformReviewsFromMysql,
  type EffectivePlatformReview,
  type MysqlPlatformReviewsStore,
  type PlatformReview,
} from "./platform-reviews-repository";
import { isHeldByPerson, precheckEvidence, type PrecheckEvidence } from "./precheck-queue";
import { precheckSuggestedBaseUrlFromNotes } from "./source-precheck";

export type LedgeredApprovalReason =
  | "not_local" | "already_approved" | "blocked" | "held" | "disabled" | "missing_platform_review" | "platform_review_expired"
  | "login_requirements_unmet" | "precheck_queued" | "precheck_missing" | "base_url_changed" | "precheck_superseded"
  | "precheck_stale" | "precheck_needs_fix";

export interface LedgeredApprovalEvaluation {
  eligible: boolean;
  reason: LedgeredApprovalReason | null;
  review: PlatformReview | null;
}

/** Mirrors the orchestrator's governance gate (blockedReasonFor): any set level other than federal/state is local. */
export function isLocalSource(source: Pick<AdminDataSource, "jurisdictionLevel">): boolean {
  return isGatedLocalJurisdictionLevel(source.jurisdictionLevel);
}

/** The skip reason for each precheck evidence state that cannot back an approval (`precheckEvidence`). */
const EVIDENCE_REASON: Record<Exclude<PrecheckEvidence, "usable">, LedgeredApprovalReason> = {
  missing: "precheck_missing",
  base_url_changed: "base_url_changed",
  superseded: "precheck_superseded",
  stale: "precheck_stale",
  needs_fix: "precheck_needs_fix",
};

/** The stored ledger columns `missingApprovalRequirements` reads, from the console's view of the row. */
function loginRequirementsRow(source: AdminDataSource): Parameters<typeof missingApprovalRequirements>[0] {
  return {
    requiresLogin: source.requiresLogin ? 1 : 0,
    complianceReviewer: source.complianceReviewer,
    legalOpinionReference: source.legalOpinionReference,
    tosReviewed: source.tosReviewed ? 1 : 0,
  };
}

/**
 * Spec 2026-09-24 §7.3 plus the final-review fixes, in order, first match wins, for one local source:
 * not local, already approved, blocked, held by a person (`isHeldByPerson`: approved only through the single-source
 * form — a later precheck does not lift a person's hold), disabled (approval would re-enable it), no valid platform
 * review (check 1), a login-gated source the review's ledger cannot satisfy (the write would throw
 * `SourceApprovalRequirementsError`), a precheck queued (the stored one no longer counts until it runs), and then the
 * stored precheck's evidence (checks 2 and 3, `precheckEvidence`).
 */
export function evaluateLedgeredApproval(
  source: AdminDataSource,
  effective: EffectivePlatformReview | undefined,
  now: Date,
): LedgeredApprovalEvaluation {
  if (!isLocalSource(source)) return { eligible: false, reason: "not_local", review: null };
  if (source.approvalStatus === "approved") return { eligible: false, reason: "already_approved", review: null };
  if (source.approvalStatus === "blocked") return { eligible: false, reason: "blocked", review: null };
  if (isHeldByPerson(source)) return { eligible: false, reason: "held", review: null };
  if (source.isEnabled === false) return { eligible: false, reason: "disabled", review: null };
  if (!effective || effective.status === "missing" || !effective.review) return { eligible: false, reason: "missing_platform_review", review: null };
  if (effective.status === "expired") return { eligible: false, reason: "platform_review_expired", review: effective.review };
  const review = effective.review;
  if (missingApprovalRequirements(loginRequirementsRow(source), ledgeredApprovalInput(source, review)).length > 0) {
    return { eligible: false, reason: "login_requirements_unmet", review };
  }
  if (source.precheckRequestedAt !== null) return { eligible: false, reason: "precheck_queued", review };
  const evidence = precheckEvidence(source, now);
  if (evidence !== "usable") return { eligible: false, reason: EVIDENCE_REASON[evidence], review };
  return { eligible: true, reason: null, review };
}

export function approvalNoteFor(review: PlatformReview, source: AdminDataSource): string {
  return `依据平台审查 #${review.id}；预检 ${source.liveHealthDisposition} @${source.liveHealthReviewedAt}`;
}

export function ledgeredApprovalInput(source: AdminDataSource, review: PlatformReview): UpdateAdminDataSourceInput {
  return {
    approvalStatus: "approved",
    approvedForIngestion: true,
    isEnabled: true,
    legalReviewStatus: "approved_public",
    complianceReviewer: review.reviewer,
    tosUrl: review.tosUrl,
    tosReviewed: true,
    tosReviewedAt: review.tosReviewedAt,
    legalOpinionReference: review.legalOpinionReference,
    complianceReviewDueAt: review.nextReviewAt,
    approvalNotes: approvalNoteFor(review, source),
  };
}

export type ApprovalReadinessBucket = "approvable" | "awaiting_precheck" | "needs_fix" | "missing_platform_review" | "approved" | "blocked";

export function readinessBucket(evaluation: LedgeredApprovalEvaluation): ApprovalReadinessBucket {
  if (evaluation.eligible) return "approvable";
  const reason = evaluation.reason;
  switch (reason) {
    case "already_approved":
      return "approved";
    case "blocked":
    case "held":
    case "disabled":
    case "login_requirements_unmet":
      return "blocked";
    case "missing_platform_review":
    case "platform_review_expired":
      return "missing_platform_review";
    case "precheck_needs_fix":
      return "needs_fix";
    case "precheck_queued":
    case "precheck_superseded":
    case "precheck_missing":
    case "precheck_stale":
    case "base_url_changed":
      return "awaiting_precheck";
    case "not_local":
    case null:
      // Never bucketed in practice: the summary skips non-local sources and an ineligible evaluation has a reason.
      return "awaiting_precheck";
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}

export interface ApprovalReadinessEntry {
  id: string;
  label: string;
  providerFamily: string;
  jurisdictionLevel: string | null;
  /** The row's current `base_url`. */
  baseUrl: string | null;
  /**
   * The address the tenant probe suggested in the stored precheck notes, for the console to show next to
   * `baseUrl` (spec §7.3). Display only: nothing ever writes it into `base_url`; a person applies it
   * through the existing source edit.
   */
  suggestedBaseUrl: string | null;
  bucket: ApprovalReadinessBucket;
  reason: LedgeredApprovalReason | null;
  precheckRequestedAt: string | null;
  liveHealthDisposition: string | null;
  liveHealthReviewedAt: string | null;
}

export interface ApprovalReadinessSummary {
  providerFamily: string | null;
  platformReview: EffectivePlatformReview | null;
  counts: Record<ApprovalReadinessBucket, number>;
  sources: ApprovalReadinessEntry[];
}

const EMPTY_COUNTS = (): Record<ApprovalReadinessBucket, number> => ({ approvable: 0, awaiting_precheck: 0, needs_fix: 0, missing_platform_review: 0, approved: 0, blocked: 0 });

export function summarizeApprovalReadiness(
  sources: readonly AdminDataSource[],
  reviews: readonly PlatformReview[],
  now: Date,
  providerFamily: string | null,
): ApprovalReadinessSummary {
  const effectiveByFamily = effectivePlatformReviewsByFamily(reviews, now);
  const counts = EMPTY_COUNTS();
  const entries: ApprovalReadinessEntry[] = [];
  for (const source of sources) {
    if (!isLocalSource(source)) continue;
    if (providerFamily && source.providerFamily !== providerFamily) continue;
    const evaluation = evaluateLedgeredApproval(source, effectiveByFamily[source.providerFamily], now);
    const bucket = readinessBucket(evaluation);
    counts[bucket] += 1;
    entries.push({
      id: source.id, label: source.label, providerFamily: source.providerFamily, jurisdictionLevel: source.jurisdictionLevel,
      baseUrl: source.baseUrl, suggestedBaseUrl: precheckSuggestedBaseUrlFromNotes(source.liveHealthNotes),
      bucket, reason: evaluation.reason, precheckRequestedAt: source.precheckRequestedAt,
      liveHealthDisposition: source.liveHealthDisposition, liveHealthReviewedAt: source.liveHealthReviewedAt,
    });
  }
  return {
    providerFamily,
    platformReview: providerFamily ? effectiveByFamily[providerFamily] ?? { status: "missing", review: null } : null,
    counts,
    sources: entries,
  };
}

export interface LedgeredBatchOutcome {
  sourceId: string;
  outcome: "approved" | "skipped" | "not_found";
  reason: LedgeredApprovalReason | null;
  source: AdminDataSource | null;
}

export interface ApproveSourcesWithLedgerOptions {
  actorUserId: string | null;
  now?: Date;
  /** What a non-local (federal/state) source still gets — the batch route's old generic input. */
  genericInput: UpdateAdminDataSourceInput;
}

export async function approveSourcesWithLedger(
  store: { database: AppDatabase; mysql?: MysqlDataSourcesStore & MysqlPlatformReviewsStore },
  sourceIds: readonly string[],
  options: ApproveSourcesWithLedgerOptions,
): Promise<LedgeredBatchOutcome[]> {
  const now = options.now ?? new Date();
  const { sources } = store.mysql ? await listAdminDataSourcesFromMysql(store.mysql) : await listAdminDataSources(store.database);
  const reviews = store.mysql ? await listPlatformReviewsFromMysql(store.mysql) : listPlatformReviews(store.database);
  const effectiveByFamily = effectivePlatformReviewsByFamily(reviews, now);
  const byId = new Map(sources.map((source) => [source.id, source]));
  const update = (id: string, input: UpdateAdminDataSourceInput) =>
    store.mysql
      ? updateAdminDataSourceFromMysql(store.mysql, id, input, { actorUserId: options.actorUserId })
      : updateAdminDataSource(store.database, id, input, { actorUserId: options.actorUserId });

  const outcomes: LedgeredBatchOutcome[] = [];
  for (const sourceId of sourceIds) {
    const source = byId.get(sourceId);
    if (!source) {
      outcomes.push({ sourceId, outcome: "not_found", reason: null, source: null });
      continue;
    }
    if (!isLocalSource(source)) {
      outcomes.push({ sourceId, outcome: "approved", reason: null, source: await update(sourceId, options.genericInput) });
      continue;
    }
    const evaluation = evaluateLedgeredApproval(source, effectiveByFamily[source.providerFamily], now);
    if (!evaluation.eligible || !evaluation.review) {
      outcomes.push({ sourceId, outcome: "skipped", reason: evaluation.reason, source });
      continue;
    }
    outcomes.push({ sourceId, outcome: "approved", reason: null, source: await update(sourceId, ledgeredApprovalInput(source, evaluation.review)) });
  }
  return outcomes;
}
