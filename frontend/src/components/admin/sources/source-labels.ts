import type { AdminDataSource, UpdateAdminDataSourceInput } from "@/lib/api/admin";

export type SourceHealthClassificationFilter =
  | "all"
  | "ok"
  | "forbidden"
  | "timeout"
  | "bot_check"
  | "login_required"
  | "empty_or_placeholder"
  | "tls_or_network_error"
  | "http_error"
  | "unknown";

export type SourceHealthTriageStatus = "unassigned" | "overdue" | "scheduled" | "reviewed";
export type SourceHealthTriageAction = "assign" | "accepted_fallback" | "manual" | "vendor_account" | "clear";

export type SourceHealthTriageFields = {
  liveHealthOwner?: string | null;
  liveHealthDisposition?: string | null;
  liveHealthNextReviewAt?: string | null;
  liveHealthNotes?: string | null;
  liveHealthReviewedAt?: string | null;
};

export function liveSourceHealthTone(status: string | null | undefined) {
  if (status === "healthy") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "skipped") return "border-slate-200 bg-slate-50 text-slate-600";
  if (status === "unhealthy") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-white text-slate-500";
}

export function liveSourceHealthLabel(t: (key: string) => string, status: string | null | undefined) {
  if (status === "healthy") return t("admin.liveSourceHealth_healthy");
  if (status === "unhealthy") return t("admin.liveSourceHealth_unhealthy");
  if (status === "skipped") return t("admin.liveSourceHealth_skipped");
  return t("admin.liveSourceHealthNoCheck");
}

export function sourceHealthClassificationFor(source: {
  latestLiveHealth?: { classification?: string | null } | null;
}) {
  return source.latestLiveHealth?.classification ?? "unknown";
}

export function sourceHealthClassificationLabel(
  t: (key: string) => string,
  classification: SourceHealthClassificationFilter | string | null | undefined,
) {
  if (classification === "ok") return t("admin.sourceHealthClassification_ok");
  if (classification === "forbidden") return t("admin.sourceHealthClassification_forbidden");
  if (classification === "timeout") return t("admin.sourceHealthClassification_timeout");
  if (classification === "bot_check") return t("admin.sourceHealthClassification_bot_check");
  if (classification === "login_required") return t("admin.sourceHealthClassification_login_required");
  if (classification === "empty_or_placeholder") return t("admin.sourceHealthClassification_empty_or_placeholder");
  if (classification === "tls_or_network_error") return t("admin.sourceHealthClassification_tls_or_network_error");
  if (classification === "http_error") return t("admin.sourceHealthClassification_http_error");
  if (classification === "all") return t("admin.sourceHealthClassification_all");
  return t("admin.sourceHealthClassification_unknown");
}

export function sourceHealthTriageStatus(
  source: SourceHealthTriageFields,
  now: Date = new Date(),
): SourceHealthTriageStatus {
  if (source.liveHealthReviewedAt || source.liveHealthDisposition) return "reviewed";
  if (!source.liveHealthOwner) return "unassigned";
  if (!source.liveHealthNextReviewAt) return "unassigned";

  const nextReviewAt = new Date(source.liveHealthNextReviewAt);
  if (!Number.isFinite(nextReviewAt.getTime())) return "unassigned";

  return nextReviewAt.getTime() < now.getTime() ? "overdue" : "scheduled";
}

export function sourceHealthTriageTone(status: SourceHealthTriageStatus) {
  if (status === "overdue") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "scheduled") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "reviewed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function sourceHealthTriageLabel(t: (key: string) => string, status: SourceHealthTriageStatus) {
  if (status === "overdue") return t("admin.sourceHealthTriage_overdue");
  if (status === "scheduled") return t("admin.sourceHealthTriage_scheduled");
  if (status === "reviewed") return t("admin.sourceHealthTriage_reviewed");
  return t("admin.sourceHealthTriage_unassigned");
}

export function sourceHealthDispositionLabel(t: (key: string) => string, disposition: string | null | undefined) {
  if (disposition === "accepted_fallback") return t("admin.sourceHealthDisposition_accepted_fallback");
  if (disposition === "manual") return t("admin.sourceHealthDisposition_manual");
  if (disposition === "vendor_account") return t("admin.sourceHealthDisposition_vendor_account");
  if (disposition) return disposition;
  return t("admin.sourceHealthDisposition_pending");
}

export function isoDaysFrom(now: Date, days: number) {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

export function sourceHealthTriagePatchForAction(
  action: SourceHealthTriageAction,
  owner: string,
  now: Date = new Date(),
): UpdateAdminDataSourceInput {
  if (action === "clear") {
    return {
      liveHealthOwner: null,
      liveHealthDisposition: null,
      liveHealthNextReviewAt: null,
      liveHealthNotes: null,
      liveHealthReviewedAt: null,
    };
  }

  if (action === "assign") {
    return {
      liveHealthOwner: owner,
      liveHealthDisposition: null,
      liveHealthNextReviewAt: isoDaysFrom(now, 1),
      liveHealthNotes: "Scheduled for operator review from Admin source health triage.",
      liveHealthReviewedAt: null,
    };
  }

  return {
    liveHealthOwner: owner,
    liveHealthDisposition: action,
    liveHealthNextReviewAt: null,
    liveHealthNotes: `Admin source health triage disposition: ${action}.`,
    liveHealthReviewedAt: now.toISOString(),
  };
}

export function liveSourceOperationalSeverityTone(value: string | null | undefined) {
  if (value === "critical") return "border-rose-200 bg-rose-50 text-rose-700";
  if (value === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  if (value === "info") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function liveSourceRecommendedActionLabel(t: (key: string) => string, action: string | null | undefined) {
  if (action === "update_registry_url") return t("admin.sourceHealthAction_update_registry_url");
  if (action === "browser_or_access_review") return t("admin.sourceHealthAction_browser_or_access_review");
  if (action === "retry_or_increase_timeout") return t("admin.sourceHealthAction_retry_or_increase_timeout");
  if (action === "network_or_tls_review") return t("admin.sourceHealthAction_network_or_tls_review");
  if (action === "add_base_url") return t("admin.sourceHealthAction_add_base_url");
  if (action && action !== "none") return action;
  return t("admin.sourceHealthAction_none");
}

export function liveSourceTrendStatusLabel(t: (key: string) => string, status: string | null | undefined) {
  if (status === "healthy") return t("admin.liveSourceHealth_healthy");
  if (status === "unhealthy") return t("admin.liveSourceHealth_unhealthy");
  if (status === "skipped") return t("admin.liveSourceHealth_skipped");
  return t("admin.liveSourceHealthNoCheck");
}

export function crawlerTone(value: string | null | undefined) {
  if (value === "dedicated" || value === "verified") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "generic") return "border-slate-200 bg-slate-50 text-slate-600";
  if (value === "beta") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-white text-slate-500";
}

export function sourceApprovalTone(value: AdminDataSource["approvalStatus"]) {
  if (value === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "blocked") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function robotsTxtTone(value: AdminDataSource["robotsTxtStatus"]) {
  if (value === "clear" || value === "not_found") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "disallow_all" || value === "disallow_crawled_paths") return "border-rose-200 bg-rose-50 text-rose-700";
  if (value === "unreachable") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function robotsTxtStatusLabel(t: (key: string) => string, value: AdminDataSource["robotsTxtStatus"]) {
  if (value === "clear") return t("admin.robotsTxt_clear");
  if (value === "disallow_all") return t("admin.robotsTxt_disallow_all");
  if (value === "disallow_crawled_paths") return t("admin.robotsTxt_disallow_crawled_paths");
  if (value === "not_found") return t("admin.robotsTxt_not_found");
  if (value === "unreachable") return t("admin.robotsTxt_unreachable");
  return t("admin.robotsTxt_unknown");
}

export function tosReviewedTone(value: AdminDataSource["tosReviewed"]) {
  if (value === true) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function sourceTrustTone(value: AdminDataSource["trustStatus"]) {
  if (value === "verified") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "fallback" || value === "beta") return "border-amber-200 bg-amber-50 text-amber-700";
  if (value === "blocked") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function crawlerAdapterLabel(t: (key: string) => string, adapterKind: AdminDataSource["crawlerAdapterKind"]) {
  if (adapterKind === "dedicated") return t("admin.crawlerAdapter_dedicated");
  if (adapterKind === "generic") return t("admin.crawlerAdapter_generic");
  return t("admin.crawlerAdapter_none");
}

export function crawlerMaturityLabel(t: (key: string) => string, maturity: AdminDataSource["crawlerMaturity"]) {
  if (maturity === "verified") return t("admin.crawlerMaturity_verified");
  if (maturity === "beta") return t("admin.crawlerMaturity_beta");
  if (maturity === "generic") return t("admin.crawlerMaturity_generic");
  return t("admin.crawlerMaturity_none");
}

export function crawlerCapabilityLabel(t: (key: string) => string, capability: AdminDataSource["crawlerCapabilities"][number]) {
  if (capability === "attachments") return t("admin.crawlerCapability_attachments");
  if (capability === "detail_pages") return t("admin.crawlerCapability_detail_pages");
  if (capability === "pagination") return t("admin.crawlerCapability_pagination");
  return t("admin.crawlerCapability_query");
}

export function sourceApprovalLabel(t: (key: string) => string, source: AdminDataSource) {
  if (source.approvalStatus === "approved") return t("admin.sourceApproval_approved");
  if (source.approvalStatus === "blocked") return t("admin.sourceApproval_blocked");
  return t("admin.sourceApproval_needs_review");
}

/** The crawler gate also lets a plain `approved` through (orchestrator.ts), so it gets the approved tone. */
export function sourceLegalReviewTone(value: string | null | undefined) {
  if (value === "approved_public" || value === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "restricted") return "border-rose-200 bg-rose-50 text-rose-700";
  if (value === "not_reviewed") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

/** A value outside the three the registry writes is shown as stored, never as "not reviewed". */
export function sourceLegalReviewLabel(t: (key: string) => string, value: string | null | undefined) {
  if (value === "approved_public") return t("admin.sourceLegalReview_approved_public");
  if (value === "not_reviewed") return t("admin.sourceLegalReview_not_reviewed");
  if (value === "restricted") return t("admin.sourceLegalReview_restricted");
  return value || "-";
}

export function sourceApprovalActionLabel(t: (key: string) => string, action: string) {
  if (action === "approved") return t("admin.sourceApprovalAction_approved");
  if (action === "blocked") return t("admin.sourceApprovalAction_blocked");
  if (action === "held") return t("admin.sourceApprovalAction_held");
  return t("admin.sourceApprovalAction_updated");
}

export function sourceAuthorityLabel(t: (key: string) => string, value: AdminDataSource["sourceAuthority"]) {
  if (value === "official_aggregator") return t("admin.sourceAuthority_official_aggregator");
  if (value === "public_aggregator") return t("admin.sourceAuthority_public_aggregator");
  return t("admin.sourceAuthority_official");
}

export function sourceTrustLabel(t: (key: string) => string, value: AdminDataSource["trustStatus"]) {
  if (value === "verified") return t("admin.sourceTrust_verified");
  if (value === "fallback") return t("admin.sourceTrust_fallback");
  if (value === "blocked") return t("admin.sourceTrust_blocked");
  if (value === "needs_review") return t("admin.sourceTrust_needs_review");
  return t("admin.sourceTrust_beta");
}

export function sourceEvidenceLabel(t: (key: string) => string, value: AdminDataSource["evidenceMode"]) {
  if (value === "api") return t("admin.sourceEvidence_api");
  if (value === "aggregator_page") return t("admin.sourceEvidence_aggregator_page");
  if (value === "fixture_fallback") return t("admin.sourceEvidence_fixture_fallback");
  return t("admin.sourceEvidence_direct_portal");
}

export function sourceRequirementLabels(t: (key: string) => string, source: AdminDataSource) {
  return [
    source.requiresBrowser ? t("admin.sourceRequiresBrowser") : null,
    source.requiresLogin ? t("admin.sourceRequiresLogin") : null,
    source.requiresManual ? t("admin.sourceRequiresManual") : null,
  ].filter((value): value is string => Boolean(value));
}

export function formatCrawlerBaseUrl(value: string | null) {
  if (!value) return null;

  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}
