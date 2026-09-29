"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createAdminPlatformReview,
  listAdminPlatformReviews,
  type AdminEffectivePlatformReview,
  type AdminPlatformReview,
  type CreateAdminPlatformReviewInput,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * Platform compliance review panel (spec docs/superpowers/specs/2026-09-24-county-data-completeness-design.md
 * §7.1).
 *
 * One review row states "this platform was reviewed on this day": terms of service, robots.txt, the
 * access boundary, who reviewed it and when the next review is due. The newest review of a platform is
 * its effective one; while it is valid the ledgered batch approval may approve that platform's local
 * sources in bulk, and once it lapses the batch stops (already approved sources keep running).
 *
 * Every admin-console role reads the list; only an admin may record or renew a review, which is why the
 * form is gated by `canManage` here and by `requireAdminAccess({ roles: ["admin"] })` on the route. The
 * server owns validation, so its message (every issue joined by "; ") is shown verbatim on a rejection.
 */

/**
 * The boundary every review states (spec §7.1). Copied from the server constant on purpose: a client
 * component must not import a server module, and the test file pins the two strings together. The form
 * only displays it; the server fills it in when the request does not carry one.
 */
export const ACCESS_BOUNDARY_TEXT = "只读公开列表与详情页；不登录、不取会员内容、不绕 WAF";

export interface PlatformReviewForm {
  providerFamily: string;
  tosUrl: string;
  tosReviewedAt: string;
  robotsUrl: string;
  robotsCheckedAt: string;
  robotsSummary: string;
  legalOpinionReference: string;
  nextReviewAt: string;
  notes: string;
}

/** Fresh review: terms reviewed today, robots.txt checked now, next review in 12 months (all UTC). */
export function defaultPlatformReviewForm(now: Date, providerFamily = "bidnet"): PlatformReviewForm {
  const today = now.toISOString().slice(0, 10);
  const next = new Date(now);
  next.setUTCFullYear(next.getUTCFullYear() + 1);
  return {
    providerFamily,
    tosUrl: "",
    tosReviewedAt: today,
    robotsUrl: "",
    robotsCheckedAt: now.toISOString(),
    robotsSummary: "",
    legalOpinionReference: "",
    nextReviewAt: next.toISOString().slice(0, 10),
    notes: "",
  };
}

/**
 * "Renew" form: today's dates again, with only the two addresses carried over from the previous
 * review. The robots.txt summary, legal reference and notes stay blank on purpose: each states what a
 * person found on the day of the check, so a renewal must restate it rather than inherit it.
 */
export function renewPlatformReviewForm(
  previous: Pick<AdminPlatformReview, "providerFamily" | "tosUrl" | "robotsUrl">,
  now: Date,
): PlatformReviewForm {
  return {
    ...defaultPlatformReviewForm(now, previous.providerFamily),
    tosUrl: previous.tosUrl,
    robotsUrl: previous.robotsUrl,
  };
}

export function buildPlatformReviewInput(form: PlatformReviewForm, reviewer: string): CreateAdminPlatformReviewInput {
  const optional = (value: string) => (value.trim() === "" ? null : value.trim());
  return {
    providerFamily: form.providerFamily.trim().toLowerCase(),
    tosUrl: form.tosUrl.trim(),
    tosReviewedAt: form.tosReviewedAt.trim(),
    robotsUrl: form.robotsUrl.trim(),
    robotsCheckedAt: form.robotsCheckedAt.trim(),
    robotsSummary: form.robotsSummary.trim(),
    reviewer: reviewer.trim(),
    legalOpinionReference: optional(form.legalOpinionReference),
    nextReviewAt: form.nextReviewAt.trim(),
    notes: optional(form.notes),
  };
}

export function platformReviewStatusTone(status: "valid" | "expired" | "missing"): string {
  if (status === "valid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "expired") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

/** "2026-09-29T08:00:00.000Z" -> "2026-09-29"; a value that does not start with a date is shown as stored. */
export function platformReviewDateLabel(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
}

/** Only http(s) addresses become links; anything else is rendered as plain text. */
function httpHref(value: string): string | null {
  return /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function FormField({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <Label className={`grid gap-1 text-xs font-medium text-slate-600 ${className ?? ""}`}>
      <span>{label}</span>
      {children}
    </Label>
  );
}

function AddressLink({ value }: { value: string }) {
  const href = httpHref(value);
  if (!href) return <span className="block max-w-44 truncate" title={value}>{value}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={value}
      className="block max-w-44 truncate text-sky-700 underline-offset-2 hover:underline"
    >
      {value}
    </a>
  );
}

export interface PlatformReviewsPanelProps {
  canManage: boolean;
  /** Signed-in admin's email; recorded as the review's reviewer. */
  reviewerEmail: string | null;
  disabled?: boolean;
  /**
   * Called after a review is saved. The ledgered approval panel reads the platform review too, so the
   * page uses this to have it re-read the readiness instead of showing the previous review's state.
   */
  onSaved?: () => void;
}

export function PlatformReviewsPanel({ canManage, reviewerEmail, disabled = false, onSaved }: PlatformReviewsPanelProps) {
  const { t } = useLanguage();
  const [reviews, setReviews] = useState<AdminPlatformReview[]>([]);
  const [effective, setEffective] = useState<Record<string, AdminEffectivePlatformReview>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"new" | "renew">("new");
  const [form, setForm] = useState<PlatformReviewForm>(() => defaultPlatformReviewForm(new Date()));
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      setIsLoading(true);
      setLoadError(null);
      listAdminPlatformReviews()
        .then((response) => {
          if (cancelled) return;
          setReviews(response.reviews);
          setEffective(response.effective);
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
  }, [reloadTick]);

  const openForm = (next: PlatformReviewForm, mode: "new" | "renew") => {
    setForm(next);
    setFormMode(mode);
    setFormError(null);
    setJustSaved(false);
    setFormOpen(true);
  };

  const update = <K extends keyof PlatformReviewForm>(key: K, value: PlatformReviewForm[K]) => {
    setFormError(null);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = () => {
    setIsSaving(true);
    setFormError(null);
    createAdminPlatformReview(buildPlatformReviewInput(form, reviewerEmail ?? ""))
      .then(() => {
        setFormOpen(false);
        setJustSaved(true);
        setReloadTick((tick) => tick + 1);
        onSaved?.();
      })
      .catch((caught: unknown) => {
        // The route joins every validation issue into one message; showing it as-is tells the admin
        // exactly which field the server refused, which a paraphrase would hide.
        setFormError(errorMessage(caught));
      })
      .finally(() => setIsSaving(false));
  };

  return (
    <div className="border-b border-slate-100 px-4 py-3" data-testid="platform-reviews-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-950">{t("admin.platformReviewsTitle")}</div>
          <div className="text-xs text-slate-500">{t("admin.platformReviewsDescription")}</div>
          <div className="text-xs text-slate-500">
            {t("admin.platformReviewAccessBoundary")}: {ACCESS_BOUNDARY_TEXT}
          </div>
        </div>
        {canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openForm(defaultPlatformReviewForm(new Date()), "new")}
            disabled={disabled || isSaving || formOpen}
            className="h-8 rounded-lg border-slate-200 px-3 text-xs"
          >
            {t("admin.platformReviewNew")}
          </Button>
        ) : (
          <span className="text-xs font-medium text-slate-500">{t("admin.platformReviewReadOnly")}</span>
        )}
      </div>

      {canManage && formOpen && (
        <div
          role="dialog"
          aria-label={t("admin.platformReviewsTitle")}
          className="mt-2 grid gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs"
          data-testid="platform-review-form"
        >
          <div className="font-semibold text-slate-800">
            {formMode === "renew" ? t("admin.platformReviewRenew") : t("admin.platformReviewNew")}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <FormField label={t("admin.platformReviewFamily")}>
              <Input
                value={form.providerFamily}
                onChange={(event) => update("providerFamily", event.target.value)}
                className="h-8 text-xs"
              />
            </FormField>
            <FormField label={t("admin.platformReviewReviewer")}>
              <Input value={reviewerEmail ?? ""} readOnly className="h-8 bg-slate-100 text-xs text-slate-600" />
            </FormField>
            <FormField label={t("admin.platformReviewTos")}>
              <Input
                type="url"
                value={form.tosUrl}
                onChange={(event) => update("tosUrl", event.target.value)}
                placeholder="https://"
                className="h-8 text-xs"
              />
            </FormField>
            <FormField label={`${t("admin.platformReviewTos")} - ${t("admin.platformReviewReviewedAt")}`}>
              <Input
                type="date"
                value={form.tosReviewedAt}
                onChange={(event) => update("tosReviewedAt", event.target.value)}
                className="h-8 text-xs"
              />
            </FormField>
            <FormField label={t("admin.platformReviewRobots")}>
              <Input
                type="url"
                value={form.robotsUrl}
                onChange={(event) => update("robotsUrl", event.target.value)}
                placeholder="https://"
                className="h-8 text-xs"
              />
            </FormField>
            <FormField label={`${t("admin.platformReviewRobots")} - ${t("admin.platformReviewReviewedAt")}`}>
              <Input
                value={form.robotsCheckedAt}
                onChange={(event) => update("robotsCheckedAt", event.target.value)}
                className="h-8 text-xs"
              />
            </FormField>
            <FormField label={t("admin.platformReviewRobotsSummary")} className="md:col-span-2">
              <Input
                value={form.robotsSummary}
                onChange={(event) => update("robotsSummary", event.target.value)}
                className="h-8 text-xs"
              />
            </FormField>
            <FormField label={t("admin.platformReviewLegalReference")}>
              <Input
                value={form.legalOpinionReference}
                onChange={(event) => update("legalOpinionReference", event.target.value)}
                className="h-8 text-xs"
              />
            </FormField>
            <FormField label={t("admin.platformReviewNextReviewAt")}>
              <Input
                type="date"
                value={form.nextReviewAt}
                onChange={(event) => update("nextReviewAt", event.target.value)}
                className="h-8 text-xs"
              />
            </FormField>
            <FormField label={t("admin.platformReviewNotes")} className="md:col-span-2">
              <Input
                value={form.notes}
                onChange={(event) => update("notes", event.target.value)}
                className="h-8 text-xs"
              />
            </FormField>
          </div>

          <div className="text-slate-600">
            <span className="font-medium">{t("admin.platformReviewAccessBoundary")}:</span> {ACCESS_BOUNDARY_TEXT}
          </div>

          {formError && (
            <p role="alert" className="text-rose-600">
              {formError}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFormOpen(false)}
              disabled={isSaving}
              className="h-8 rounded-lg border-slate-200 px-3 text-xs"
            >
              {t("admin.platformReviewCancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={disabled || isSaving}
              className="h-8 rounded-lg px-3 text-xs"
            >
              {t("admin.platformReviewSubmit")}
            </Button>
          </div>
        </div>
      )}

      {justSaved && (
        <p role="status" className="mt-2 text-xs font-medium text-emerald-700">
          {t("admin.platformReviewSaved")}
        </p>
      )}

      {loadError && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <p role="alert" className="text-rose-600">
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => setReloadTick((tick) => tick + 1)}
            className="text-slate-500 underline-offset-2 hover:underline"
          >
            {t("admin.refresh")}
          </button>
        </div>
      )}

      {isLoading && reviews.length === 0 && !loadError && (
        <div className="mt-2 text-xs font-medium text-slate-500">{t("admin.loading")}</div>
      )}

      {!isLoading && !loadError && reviews.length === 0 && (
        <div className="mt-2 text-xs font-medium text-slate-500">{t("admin.platformReviewEmpty")}</div>
      )}

      {reviews.length > 0 && (
        <div className="mt-2 rounded-lg border border-slate-100">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.platformReviewFamily")}</TableHead>
                <TableHead>{t("admin.platformReviewStatus")}</TableHead>
                <TableHead>{t("admin.platformReviewReviewer")}</TableHead>
                <TableHead>{t("admin.platformReviewReviewedAt")}</TableHead>
                <TableHead>{t("admin.platformReviewNextReviewAt")}</TableHead>
                <TableHead>{t("admin.platformReviewTos")}</TableHead>
                <TableHead>{t("admin.platformReviewRobots")}</TableHead>
                <TableHead>{t("admin.platformReviewLegalReference")}</TableHead>
                {canManage && (
                  <TableHead className="text-right">
                    <span className="sr-only">{t("admin.platformReviewRenew")}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((review) => {
                // The badge and Renew belong to the newest review of each platform only: it is the
                // one the server resolves as effective, older rows are history.
                const current = effective[review.providerFamily];
                const isEffective = current?.review?.id === review.id;
                return (
                  <TableRow key={review.id} data-testid={`platform-review-row-${review.id}`} className="text-xs">
                    <TableCell className="min-w-32 align-top whitespace-normal">
                      <div className="font-medium text-slate-900">{review.providerFamily}</div>
                      {/* The standard boundary is stated once above; a row shows its own only when it differs. */}
                      {review.accessBoundary !== ACCESS_BOUNDARY_TEXT && (
                        <div className="mt-0.5 max-w-64 text-amber-700">
                          {t("admin.platformReviewAccessBoundary")}: {review.accessBoundary}
                        </div>
                      )}
                      {review.notes && (
                        <div className="mt-0.5 max-w-64 text-slate-500">
                          {t("admin.platformReviewNotes")}: {review.notes}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      {isEffective && current ? (
                        <Badge variant="outline" className={platformReviewStatusTone(current.status)}>
                          {t(`admin.platformReviewStatus_${current.status}`)}
                        </Badge>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">{review.reviewer}</TableCell>
                    <TableCell className="align-top">{platformReviewDateLabel(review.reviewedAt)}</TableCell>
                    <TableCell className="align-top">{platformReviewDateLabel(review.nextReviewAt)}</TableCell>
                    <TableCell className="align-top">
                      <AddressLink value={review.tosUrl} />
                      <div className="text-slate-500">{platformReviewDateLabel(review.tosReviewedAt)}</div>
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      <AddressLink value={review.robotsUrl} />
                      <div className="text-slate-500">{platformReviewDateLabel(review.robotsCheckedAt)}</div>
                      <div className="max-w-44 text-slate-500">{review.robotsSummary}</div>
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      {review.legalOpinionReference ?? <span className="text-slate-400">-</span>}
                    </TableCell>
                    {canManage && (
                      <TableCell className="align-top text-right">
                        {isEffective && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openForm(renewPlatformReviewForm(review, new Date()), "renew")}
                            disabled={disabled || isSaving || formOpen}
                            className="h-7 rounded-lg border-slate-200 px-2 text-xs"
                          >
                            {t("admin.platformReviewRenew")}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
