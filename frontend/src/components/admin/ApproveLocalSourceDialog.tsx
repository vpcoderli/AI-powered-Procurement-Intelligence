"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  updateAdminDataSource,
  type AdminDataSource,
  type AdminSourcePrecheckResult,
  type ApproveLocalSourceInput,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * "Approve county/city source" form (contract C6 of
 * docs/superpowers/plans/2026-09-16-local-source-governance-recovery.md).
 *
 * County/city rows are held by the governance gate in `orchestrator.ts` until a human approves
 * them — that gate is deliberate policy, not a crawler bug, and nothing in this dialog bypasses
 * it. The dialog only makes the ledger write a single, complete action: one PATCH that flips the
 * approval columns AND records who reviewed it, which ToS was read, the legal reference and the
 * next review date. Approving without that trail is exactly what the 2026-07-29 registry design
 * forbids.
 *
 * The pre-check result (when one has been run) is advisory: it decides whether a legal opinion
 * reference is demanded client-side, and nothing more. The compliance judgement stays with the
 * person filling the form.
 */

export interface ApproveLocalSourceForm {
  tosUrl: string;
  complianceReviewer: string;
  legalOpinionReference: string;
  complianceReviewDueAt: string;
  complianceNotes: string;
  approvalNotes: string;
}

/**
 * Jurisdiction levels the governance gate holds back. `blockedReasonFor()` requires explicit
 * approval for every level outside {federal, state}; legacy NULL rows are state portals.
 */
export function isLocalJurisdictionSource(
  source: Pick<AdminDataSource, "jurisdictionLevel" | "issuerType">,
): boolean {
  const level = source.jurisdictionLevel ?? (source.issuerType === "federal" ? "federal" : "state");
  return level !== "federal" && level !== "state";
}

/** Default compliance review due date: today + 12 months, as an ISO yyyy-mm-dd string (UTC). */
export function defaultComplianceReviewDueAt(today: Date): string {
  const due = new Date(today.getTime());
  due.setUTCFullYear(due.getUTCFullYear() + 1);
  return due.toISOString().slice(0, 10);
}

/**
 * A legal opinion reference is mandatory when robots.txt was flagged for this host by the last
 * pre-check, or when the row is marked `requires_login` — the two cases the 2026-07-29 design
 * says a person must have written down a legal position for. Otherwise it stays optional.
 */
export function legalReferenceRequired(
  source: Pick<AdminDataSource, "requiresLogin">,
  precheck: AdminSourcePrecheckResult | null,
): boolean {
  return Boolean(source.requiresLogin) || precheck?.robots.flagged === true;
}

export function approveLocalSourceFormFromSource(
  source: AdminDataSource,
  reviewerEmail: string | null,
  today: Date,
): ApproveLocalSourceForm {
  return {
    tosUrl: source.tosUrl ?? "",
    // Prefilled from the signed-in admin, editable: the reviewer is whoever takes responsibility,
    // which is usually but not always the person clicking.
    complianceReviewer: source.complianceReviewer ?? reviewerEmail ?? "",
    legalOpinionReference: source.legalOpinionReference ?? "",
    complianceReviewDueAt: source.complianceReviewDueAt?.slice(0, 10) ?? defaultComplianceReviewDueAt(today),
    complianceNotes: source.complianceNotes ?? "",
    approvalNotes: "",
  };
}

export type ApproveLocalSourceValidation = { ok: true } | { ok: false; messageKey: string };

export function validateApproveLocalSourceForm(
  form: ApproveLocalSourceForm,
  requireLegalReference: boolean,
): ApproveLocalSourceValidation {
  if (!form.complianceReviewer.trim()) {
    return { ok: false, messageKey: "admin.approveLocalSourceReviewerRequired" };
  }
  if (requireLegalReference && !form.legalOpinionReference.trim()) {
    return { ok: false, messageKey: "admin.approveLocalSourceLegalRequired" };
  }
  return { ok: true };
}

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The single PATCH body. `tosReviewed: true` is implied by submitting the form — the operator is
 * asserting they read the terms, which is why the checkbox is the submit gate rather than a
 * silent default.
 */
export function buildApproveLocalSourcePatch(form: ApproveLocalSourceForm): ApproveLocalSourceInput {
  return {
    approvalStatus: "approved",
    legalReviewStatus: "approved_public",
    approvedForIngestion: true,
    isEnabled: true,
    tosReviewed: true,
    tosUrl: trimmedOrNull(form.tosUrl),
    complianceReviewer: form.complianceReviewer.trim(),
    legalOpinionReference: trimmedOrNull(form.legalOpinionReference),
    complianceReviewDueAt: trimmedOrNull(form.complianceReviewDueAt),
    complianceNotes: trimmedOrNull(form.complianceNotes),
    approvalNotes: trimmedOrNull(form.approvalNotes),
  };
}

export interface ApproveLocalSourceDialogProps {
  source: AdminDataSource;
  /** Signed-in admin's email, used to prefill the reviewer. Empty when the session has none. */
  reviewerEmail: string | null;
  /** Most recent pre-check for this source in this session, if any. */
  precheck: AdminSourcePrecheckResult | null;
  disabled?: boolean;
  onApproved: (source: AdminDataSource) => void;
}

const inputClass =
  "h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none";

export function ApproveLocalSourceDialog({
  source,
  reviewerEmail,
  precheck,
  disabled = false,
  onApproved,
}: ApproveLocalSourceDialogProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ApproveLocalSourceForm>(() =>
    approveLocalSourceFormFromSource(source, reviewerEmail, new Date()),
  );
  const [tosAcknowledged, setTosAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requireLegalReference = legalReferenceRequired(source, precheck);

  const update = <K extends keyof ApproveLocalSourceForm>(key: K, value: ApproveLocalSourceForm[K]) => {
    setError(null);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const openDialog = () => {
    setForm(approveLocalSourceFormFromSource(source, reviewerEmail, new Date()));
    setTosAcknowledged(false);
    setError(null);
    setOpen(true);
  };

  const submit = () => {
    const validation = validateApproveLocalSourceForm(form, requireLegalReference);
    if (!validation.ok) {
      setError(t(validation.messageKey));
      return;
    }

    setSaving(true);
    setError(null);
    updateAdminDataSource(source.id, buildApproveLocalSourcePatch(form))
      .then(({ source: updated }) => {
        onApproved(updated);
        setOpen(false);
      })
      .catch((caught: unknown) => {
        // Server rejections (missing reviewer on a requires_login row, invalid URL, …) are shown
        // verbatim: the API message is the actionable part, and paraphrasing it hides which
        // ledger field the server refused.
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => setSaving(false));
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openDialog}
        disabled={disabled}
        className="h-7 rounded-lg border-emerald-200 px-2 text-xs text-emerald-700"
      >
        {t("admin.approveLocalSourceOpen")}
      </Button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label={t("admin.approveLocalSourceTitle")}
      className="mt-2 grid w-full gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-left text-xs"
      data-testid={`approve-local-source-${source.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-800">{t("admin.approveLocalSourceTitle")}</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-slate-500 underline-offset-2 hover:underline"
        >
          {t("admin.approveLocalSourceClose")}
        </button>
      </div>
      <p className="text-slate-600">{t("admin.approveLocalSourceDescription")}</p>

      <label className="grid gap-1">
        <span className="font-medium text-slate-600">{t("admin.approveLocalSourceReviewer")}</span>
        <input
          type="text"
          value={form.complianceReviewer}
          onChange={(event) => update("complianceReviewer", event.target.value)}
          className={inputClass}
        />
      </label>

      <label className="grid gap-1">
        <span className="font-medium text-slate-600">{t("admin.approveLocalSourceTosUrl")}</span>
        <input
          type="url"
          value={form.tosUrl}
          onChange={(event) => update("tosUrl", event.target.value)}
          className={inputClass}
        />
      </label>

      <label className="grid gap-1">
        <span className="font-medium text-slate-600">
          {requireLegalReference
            ? t("admin.approveLocalSourceLegalReferenceRequired")
            : t("admin.approveLocalSourceLegalReference")}
        </span>
        <input
          type="text"
          value={form.legalOpinionReference}
          onChange={(event) => update("legalOpinionReference", event.target.value)}
          className={inputClass}
        />
        {requireLegalReference && (
          <span className="text-amber-700">{t("admin.approveLocalSourceLegalReferenceHint")}</span>
        )}
      </label>

      <label className="grid gap-1">
        <span className="font-medium text-slate-600">{t("admin.approveLocalSourceReviewDue")}</span>
        <input
          type="date"
          value={form.complianceReviewDueAt}
          onChange={(event) => update("complianceReviewDueAt", event.target.value)}
          className={inputClass}
        />
      </label>

      <label className="grid gap-1">
        <span className="font-medium text-slate-600">{t("admin.approveLocalSourceComplianceNotes")}</span>
        <textarea
          value={form.complianceNotes}
          onChange={(event) => update("complianceNotes", event.target.value)}
          rows={2}
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none"
        />
      </label>

      <label className="grid gap-1">
        <span className="font-medium text-slate-600">{t("admin.approveLocalSourceApprovalNotes")}</span>
        <textarea
          value={form.approvalNotes}
          onChange={(event) => update("approvalNotes", event.target.value)}
          rows={2}
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none"
        />
      </label>

      <label className="flex items-start gap-2 font-medium text-slate-700">
        <input
          type="checkbox"
          checked={tosAcknowledged}
          onChange={(event) => {
            setError(null);
            setTosAcknowledged(event.target.checked);
          }}
          className="mt-0.5"
        />
        {t("admin.approveLocalSourceTosAcknowledge")}
      </label>

      {error && (
        <p role="alert" className="text-rose-600">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={disabled || saving || !tosAcknowledged}
          className="h-8 rounded-lg px-3"
        >
          {saving ? t("admin.approveLocalSourceSaving") : t("admin.approveLocalSourceSubmit")}
        </Button>
      </div>
    </div>
  );
}
