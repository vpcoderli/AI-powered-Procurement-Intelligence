"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  confirmSubmission,
  fetchIntent,
  fetchSubmissionGuidance,
  updateIntentStatus,
  updateSubmissionGuidance,
} from "@/lib/api/intents";
import { lockedFeatureMessage, useFeature } from "@/lib/features/useFeature";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { IntentDetail, IntentStatus } from "@/server/intents/types";
import { INTENT_STATUSES } from "@/server/intents/types";
import type {
  SubmissionConfirmation,
  SubmissionGuidance,
  SubmissionMethod,
} from "@/server/submission/types";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  Gauge,
  Landmark,
  LockKeyhole,
  PackageCheck,
  Route,
  ShieldAlert,
  Sparkles,
  Target,
  Truck,
} from "lucide-react";

function scoreTone(score: number) {
  if (score >= 75) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (score >= 50) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-slate-600 bg-slate-50 border-slate-200";
}

function metricLabel(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
}

const prototypeWorkspace = "Intent Workspace";
const submissionPath = "Submission Path";

const submissionMethods: SubmissionMethod[] = [
  "external_portal",
  "email",
  "physical_delivery",
  "mixed",
  "unknown",
];

type SubmissionDraft = Pick<
  SubmissionGuidance,
  | "method"
  | "portalUrl"
  | "contactEmail"
  | "requiresRegistration"
  | "requiresPhysicalDelivery"
  | "requiresAddendaAcknowledgement"
>;

interface ConfirmationDraft {
  submittedAt: string;
  method: SubmissionMethod;
  confirmationReference: string;
  confirmationNotes: string;
}

const defaultSubmissionDraft: SubmissionDraft = {
  method: "unknown",
  portalUrl: "",
  contactEmail: "",
  requiresRegistration: false,
  requiresPhysicalDelivery: false,
  requiresAddendaAcknowledgement: false,
};

function currentDatetimeLocal() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;

  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toSubmissionDraft(submission: SubmissionGuidance): SubmissionDraft {
  return {
    method: submission.method,
    portalUrl: submission.portalUrl,
    contactEmail: submission.contactEmail,
    requiresRegistration: submission.requiresRegistration,
    requiresPhysicalDelivery: submission.requiresPhysicalDelivery,
    requiresAddendaAcknowledgement: submission.requiresAddendaAcknowledgement,
  };
}

function toIsoFromDatetimeLocal(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

const pursuitLanes = [
  { key: "intent", count: "1", items: ["match", "brief"] },
  { key: "review", count: "3", items: ["risk", "questions"] },
  { key: "prepare", count: "2", items: ["documents", "pricing"] },
  { key: "submit", count: "1", items: ["confirmation"] },
] as const;

export default function IntentWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useLanguage();
  const mountedRef = useRef(true);
  const saveRequestRef = useRef(0);
  const [intent, setIntent] = useState<IntentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [saveError, setSaveError] = useState<Error | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [submissionGuidance, setSubmissionGuidance] = useState<SubmissionGuidance | null>(null);
  const [submissionDraft, setSubmissionDraft] = useState<SubmissionDraft>(defaultSubmissionDraft);
  const [submissionConfirmation, setSubmissionConfirmation] = useState<SubmissionConfirmation | null>(null);
  const [confirmationDraft, setConfirmationDraft] = useState<ConfirmationDraft>({
    submittedAt: currentDatetimeLocal(),
    method: "unknown",
    confirmationReference: "",
    confirmationNotes: "",
  });
  const [isSubmissionLoading, setIsSubmissionLoading] = useState(false);
  const [isSubmissionSaving, setIsSubmissionSaving] = useState(false);
  const [isConfirmationSaving, setIsConfirmationSaving] = useState(false);
  const [submissionError, setSubmissionError] = useState<Error | null>(null);
  const [submissionNotice, setSubmissionNotice] = useState("");
  const submissionGuidanceFeature = useFeature("submission_guidance");

  const intentId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled || !mountedRef.current) return;

      setIntent(null);
      setLoadError(null);
      setIsLoading(true);

      if (!intentId) {
        setIsLoading(false);
        return;
      }

      fetchIntent(intentId)
        .then((response) => {
          if (cancelled || !mountedRef.current) return;
          setIntent(response.intent);
        })
        .catch((err) => {
          if (cancelled || !mountedRef.current) return;
          setLoadError(err instanceof Error ? err : new Error("Failed to load intent"));
        })
        .finally(() => {
          if (cancelled || !mountedRef.current) return;
          setIsLoading(false);
        });
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [intentId]);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled || !mountedRef.current) return;

      setSubmissionGuidance(null);
      setSubmissionDraft(defaultSubmissionDraft);
      setSubmissionConfirmation(null);
      setSubmissionNotice("");
      setSubmissionError(null);

      if (!intentId || !submissionGuidanceFeature.enabled) {
        setIsSubmissionLoading(false);
        return;
      }

      setIsSubmissionLoading(true);

      fetchSubmissionGuidance(intentId)
        .then((response) => {
          if (cancelled || !mountedRef.current) return;

          setSubmissionGuidance(response.submission);
          setSubmissionDraft(toSubmissionDraft(response.submission));
          setConfirmationDraft({
            submittedAt: currentDatetimeLocal(),
            method: response.submission.method,
            confirmationReference: "",
            confirmationNotes: "",
          });
        })
        .catch((err) => {
          if (cancelled || !mountedRef.current) return;
          setSubmissionError(err instanceof Error ? err : new Error("Failed to load submission guidance"));
        })
        .finally(() => {
          if (cancelled || !mountedRef.current) return;
          setIsSubmissionLoading(false);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [intentId, submissionGuidanceFeature.enabled]);

  const matchComponents = useMemo(() => {
    if (!intent) return [];
    return Object.entries(intent.match.components);
  }, [intent]);

  const handleStatusChange = async (status: IntentStatus | null) => {
    if (!intent || !status || status === intent.status || isSaving) return;

    const nextStatus = status;
    const previousIntent = intent;
    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;

    setIntent({ ...intent, status: nextStatus });
    setIsSaving(true);
    setIsSaved(false);
    setSaveError(null);

    try {
      const response = await updateIntentStatus(intent.id, nextStatus);
      if (!mountedRef.current || saveRequestRef.current !== requestId) return;

      setIntent(response.intent);
      setIsSaved(true);
    } catch (err) {
      if (!mountedRef.current || saveRequestRef.current !== requestId) return;

      setIntent(previousIntent);
      setSaveError(err instanceof Error ? err : new Error("Failed to save intent status"));
    } finally {
      if (mountedRef.current && saveRequestRef.current === requestId) {
        setIsSaving(false);
      }
    }
  };

  const handleSaveSubmissionGuidance = async () => {
    if (!intent || !submissionGuidanceFeature.enabled || isSubmissionSaving) return;

    setIsSubmissionSaving(true);
    setSubmissionNotice("");
    setSubmissionError(null);

    try {
      const response = await updateSubmissionGuidance(intent.id, submissionDraft);
      if (!mountedRef.current) return;

      setSubmissionGuidance(response.submission);
      setSubmissionDraft(toSubmissionDraft(response.submission));
      setConfirmationDraft((current) => ({ ...current, method: response.submission.method }));
      setSubmissionNotice(t("intentsPage.submissionGuidanceSaved"));
    } catch (err) {
      if (!mountedRef.current) return;
      setSubmissionError(err instanceof Error ? err : new Error("Failed to save submission guidance"));
    } finally {
      if (mountedRef.current) {
        setIsSubmissionSaving(false);
      }
    }
  };

  const handleConfirmSubmission = async () => {
    if (!intent || !submissionGuidanceFeature.enabled || isConfirmationSaving) return;

    setIsConfirmationSaving(true);
    setSubmissionNotice("");
    setSubmissionError(null);

    try {
      const response = await confirmSubmission(intent.id, {
        submittedAt: toIsoFromDatetimeLocal(confirmationDraft.submittedAt),
        method: confirmationDraft.method,
        confirmationReference: confirmationDraft.confirmationReference.trim(),
        confirmationNotes: confirmationDraft.confirmationNotes.trim(),
      });
      if (!mountedRef.current) return;

      setSubmissionConfirmation(response.confirmation);
      setConfirmationDraft({
        submittedAt: currentDatetimeLocal(),
        method: response.confirmation.method,
        confirmationReference: "",
        confirmationNotes: "",
      });
      setSubmissionNotice(t("intentsPage.submissionConfirmationSaved"));
    } catch (err) {
      if (!mountedRef.current) return;
      setSubmissionError(err instanceof Error ? err : new Error("Failed to confirm submission"));
    } finally {
      if (mountedRef.current) {
        setIsConfirmationSaving(false);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto flex flex-col gap-6 pb-16 pt-4">
        <Skeleton className="h-9 w-32" />
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="border-slate-200 shadow-sm rounded-xl bg-white">
              <CardHeader>
                <Skeleton className="h-5 w-40" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (loadError || !intent) {
    return (
      <div className="max-w-4xl mx-auto pt-4">
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-slate-900 font-semibold mb-2">{t("intentsPage.errorTitle")}</p>
          <p className="text-sm text-slate-500 mb-4">{t("intentsPage.detailErrorDescription")}</p>
          <Button onClick={() => router.back()} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" /> {t("detail.backToResults")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="winbids-detail-workspace prototypeWorkspace">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="ghost"
          onClick={() => router.back()}
          className="-ml-3 w-fit text-slate-500 hover:text-slate-900 font-medium"
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> {t("intentsPage.backToIntents")}
        </Button>
        <Link
          href={intent.bid.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({
            variant: "outline",
            className: "w-fit border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg",
          })}
        >
          <ExternalLink className="mr-2 h-4 w-4" /> {t("detail.viewSource")}
        </Link>
      </div>

      <section className="winbids-hero-panel rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-blue-700">
              {t("intentsPage.prototypeKicker")}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-md border-slate-200 bg-slate-50 text-slate-600">
                {t(`intentsPage.statuses.${intent.status}`)}
              </Badge>
              <Badge variant="outline" className={`rounded-md ${scoreTone(intent.match.score)}`}>
                {intent.match.score}% {t("intentsPage.matchSnapshot")}
              </Badge>
              <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-slate-500">
                <Building2 size={14} className="shrink-0 text-slate-400" />
                <span className="truncate">{intent.bid.issuerName}</span>
              </span>
            </div>
            <h1 className="mt-3 break-words text-3xl font-black leading-tight tracking-normal text-slate-950 md:text-5xl">
              {intent.bid.title}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
              {t("intentsPage.prototypeDescription")}
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-500">{t("intentsPage.status")}</span>
                <Select
                  value={intent.status}
                  onValueChange={(value) => void handleStatusChange(value)}
                  disabled={isSaving}
                >
                  <SelectTrigger className="h-9 min-w-56 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                    {INTENT_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {t(`intentsPage.statuses.${status}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="min-h-5 text-sm font-medium text-slate-500">
                {isSaving
                  ? t("intentsPage.savingStatus")
                  : isSaved
                    ? t("intentsPage.saveStatus")
                    : saveError
                      ? t("intentsPage.saveError")
                      : ""}
              </p>
            </div>
          </div>

          <div className={`rounded-lg border p-5 ${scoreTone(intent.match.score)}`}>
            <Gauge size={22} aria-hidden="true" />
            <p className="mt-4 text-xs font-black uppercase">{t("intentsPage.matchSnapshot")}</p>
            <p className="mt-2 text-5xl font-black leading-none">{intent.match.score}%</p>
            <p className="mt-2 text-sm font-bold">{t(`intentsPage.confidence.${intent.match.confidence}`)}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <article className="winbids-panel rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-blue-700">
                {prototypeWorkspace}
              </p>
              <h2 className="mt-1 text-2xl font-black text-slate-950">{t("intentsPage.brief")}</h2>
            </div>
            <span className="w-fit rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-500">
              {t("intentsPage.lowRiskPursuit")}
            </span>
          </div>
          <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
            {intent.generated.aiBidBrief}
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
              <CalendarClock size={18} className="text-blue-700" aria-hidden="true" />
              <p className="mt-3 text-sm font-black text-slate-950">{t("intentsPage.keyDates")}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                {intent.generated.keyDates.publishedDate} / {intent.generated.keyDates.deadlineDate}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
              <ShieldAlert size={18} className="text-amber-600" aria-hidden="true" />
              <p className="mt-3 text-sm font-black text-slate-950">{t("intentsPage.riskFlags")}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                {intent.generated.riskFlags[0] ?? t("intentsPage.noMajorRisks")}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
              <FileCheck2 size={18} className="text-emerald-700" aria-hidden="true" />
              <p className="mt-3 text-sm font-black text-slate-950">{t("intentsPage.checklist")}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                {intent.generated.initialChecklist.length} {t("intentsPage.items")}
              </p>
            </div>
          </div>
        </article>

        <aside className="winbids-panel rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-blue-700">
            {t("intentsPage.moduleMap")}
          </p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">{t("intentsPage.pursuitModules")}</h2>
          <div className="mt-5 grid gap-3">
            {[
              ["match", Target],
              ["brief", Sparkles],
              ["submission", Route],
              ["award", PackageCheck],
            ].map(([key, Icon]) => {
              const ModuleIcon = Icon as typeof Target;
              const isLocked = key === "submission" && !submissionGuidanceFeature.enabled;
              return (
                <div
                  key={key as string}
                  className={`flex gap-3 rounded-lg border p-4 ${
                    isLocked ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white"
                  }`}
                >
                  {isLocked ? (
                    <LockKeyhole className="mt-0.5 shrink-0 text-amber-700" size={18} aria-hidden="true" />
                  ) : (
                    <ModuleIcon className="mt-0.5 shrink-0 text-blue-700" size={18} aria-hidden="true" />
                  )}
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-black text-slate-950">
                        {t(`intentsPage.moduleItems.${key as string}.title`)}
                      </p>
                      {isLocked && (
                        <Badge variant="outline" className="border-amber-200 bg-white text-amber-700">
                          {submissionGuidanceFeature.requiredTier}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                      {isLocked
                        ? lockedFeatureMessage("submission_guidance")
                        : t(`intentsPage.moduleItems.${key as string}.description`)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <article className="winbids-panel rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-xl font-black text-slate-950">
            <CheckCircle2 size={19} className="text-emerald-700" aria-hidden="true" />
            {t("intentsPage.checklist")}
          </h2>
          <ul className="mt-4 space-y-3">
            {intent.generated.initialChecklist.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-6 text-slate-700">
                <CheckCircle2 size={16} className="mt-1 shrink-0 text-emerald-600" />
                <span className="break-words">{item}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="winbids-panel rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-xl font-black text-slate-950">
            <Target size={19} className="text-blue-700" aria-hidden="true" />
            {t("intentsPage.matchSnapshot")}
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {matchComponents.map(([key, value]) => (
              <div key={key} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                <p className="text-xs font-black uppercase text-slate-400">{metricLabel(key)}</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 break-words text-sm leading-6 text-slate-600">{intent.match.explanation}</p>
        </article>
      </section>

      <section
        className={`winbids-panel submissionPath rounded-lg border p-5 shadow-sm ${
          submissionGuidanceFeature.enabled ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/60"
        }`}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-blue-700">
              {submissionGuidanceFeature.enabled
                ? t("intentsPage.submissionGuidance")
                : t("intentsPage.nextPhasePreview")}
            </p>
            <h2 className="mt-1 flex items-center gap-2 text-2xl font-black text-slate-950">
              <Route size={21} className="text-blue-700" aria-hidden="true" />
              {submissionPath}
            </h2>
          </div>
          <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">
            {submissionGuidanceFeature.enabled
              ? submissionGuidance
                ? `${submissionGuidance.complexityScore}/100 ${t("intentsPage.complexityScore")}`
                : t("intentsPage.mediumComplexity")
              : lockedFeatureMessage("submission_guidance")}
          </span>
        </div>

        {!submissionGuidanceFeature.enabled ? (
          <>
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg bg-white/70 p-4 text-sm font-bold text-amber-800">
              <Landmark size={18} className="text-blue-700" aria-hidden="true" />
              <span>{t("intentsPage.externalPortal")}</span>
              <ArrowRight size={15} className="text-slate-400" aria-hidden="true" />
              <ShieldAlert size={18} className="text-blue-700" aria-hidden="true" />
              <span>{t("intentsPage.registrationCheck")}</span>
              <ArrowRight size={15} className="text-slate-400" aria-hidden="true" />
              <Truck size={18} className="text-blue-700" aria-hidden="true" />
              <span>{t("intentsPage.receiptCapture")}</span>
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-amber-800">
              {lockedFeatureMessage("submission_guidance")}
            </p>
          </>
        ) : (
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.95fr)]">
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-slate-950">{t("intentsPage.generatedGuidance")}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      {isSubmissionLoading
                        ? t("intentsPage.submissionLoading")
                        : submissionGuidance?.guidanceText ?? t("intentsPage.submissionUnavailable")}
                    </p>
                  </div>
                  {submissionDraft.portalUrl ? (
                    <Link
                      href={submissionDraft.portalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({
                        variant: "outline",
                        className: "h-9 w-fit rounded-lg border-slate-200 bg-white text-slate-700",
                      })}
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {t("intentsPage.openPortal")}
                    </Link>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.method")}
                  <Select
                    value={submissionDraft.method}
                    onValueChange={(value) =>
                      setSubmissionDraft((current) => ({
                        ...current,
                        method: value as SubmissionMethod,
                      }))
                    }
                    disabled={isSubmissionLoading || isSubmissionSaving}
                  >
                    <SelectTrigger className="h-9 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                      {submissionMethods.map((method) => (
                        <SelectItem key={method} value={method}>
                          {t(`intentsPage.submissionMethods.${method}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.portalUrl")}
                  <Input
                    value={submissionDraft.portalUrl}
                    onChange={(event) =>
                      setSubmissionDraft((current) => ({ ...current, portalUrl: event.target.value }))
                    }
                    disabled={isSubmissionLoading || isSubmissionSaving}
                    placeholder="https://"
                    className="h-9 border-slate-200 bg-white"
                  />
                </label>

                <label className="grid gap-1.5 text-sm font-bold text-slate-700 md:col-span-2">
                  {t("intentsPage.contactEmail")}
                  <Input
                    value={submissionDraft.contactEmail}
                    onChange={(event) =>
                      setSubmissionDraft((current) => ({ ...current, contactEmail: event.target.value }))
                    }
                    disabled={isSubmissionLoading || isSubmissionSaving}
                    placeholder="procurement@example.gov"
                    className="h-9 border-slate-200 bg-white"
                  />
                </label>
              </div>

              <div className="grid gap-2">
                {[
                  ["requiresRegistration", "registrationCheck"],
                  ["requiresPhysicalDelivery", "physicalDeliveryRequired"],
                  ["requiresAddendaAcknowledgement", "addendaAcknowledgementRequired"],
                ].map(([field, label]) => (
                  <label
                    key={field}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(submissionDraft[field as keyof SubmissionDraft])}
                      onChange={(event) =>
                        setSubmissionDraft((current) => ({
                          ...current,
                          [field]: event.target.checked,
                        }))
                      }
                      disabled={isSubmissionLoading || isSubmissionSaving}
                      className="size-4 rounded border-slate-300 text-blue-700"
                    />
                    <span>{t(`intentsPage.${label}`)}</span>
                  </label>
                ))}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  onClick={() => void handleSaveSubmissionGuidance()}
                  disabled={isSubmissionLoading || isSubmissionSaving}
                  className="w-fit rounded-lg bg-slate-950 text-white hover:bg-slate-800"
                >
                  {isSubmissionSaving ? t("intentsPage.submissionSaving") : t("intentsPage.saveSubmissionGuidance")}
                </Button>
                <p className="min-h-5 text-sm font-semibold text-slate-500">
                  {submissionError
                    ? t("intentsPage.submissionSaveError")
                    : submissionNotice}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-sm font-black text-slate-950">{t("intentsPage.readinessChecklist")}</p>
                <ul className="mt-3 space-y-2">
                  {(submissionGuidance?.readinessChecklist ?? []).map((item) => (
                    <li key={item} className="flex gap-2 text-sm font-semibold leading-6 text-slate-700">
                      <CheckCircle2 size={16} className="mt-1 shrink-0 text-emerald-600" aria-hidden="true" />
                      <span className="break-words">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-sm font-black text-slate-950">{t("intentsPage.submissionRiskFlags")}</p>
                <ul className="mt-3 space-y-2">
                  {(submissionGuidance?.riskFlags.length ? submissionGuidance.riskFlags : [t("intentsPage.noMajorRisks")]).map((item) => (
                    <li key={item} className="flex gap-2 text-sm font-semibold leading-6 text-slate-700">
                      <ShieldAlert size={16} className="mt-1 shrink-0 text-amber-600" aria-hidden="true" />
                      <span className="break-words">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4">
                <p className="text-sm font-black text-slate-950">{t("intentsPage.confirmSubmission")}</p>
                <div className="mt-3 grid gap-3">
                  <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                    {t("intentsPage.submittedAt")}
                    <Input
                      type="datetime-local"
                      value={confirmationDraft.submittedAt}
                      onChange={(event) =>
                        setConfirmationDraft((current) => ({ ...current, submittedAt: event.target.value }))
                      }
                      disabled={isConfirmationSaving}
                      className="h-9 border-slate-200 bg-white"
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                    {t("intentsPage.method")}
                    <Select
                      value={confirmationDraft.method}
                      onValueChange={(value) =>
                        setConfirmationDraft((current) => ({
                          ...current,
                          method: value as SubmissionMethod,
                        }))
                      }
                      disabled={isConfirmationSaving}
                    >
                      <SelectTrigger className="h-9 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                        {submissionMethods.map((method) => (
                          <SelectItem key={method} value={method}>
                            {t(`intentsPage.submissionMethods.${method}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                    {t("intentsPage.confirmationReference")}
                    <Input
                      value={confirmationDraft.confirmationReference}
                      onChange={(event) =>
                        setConfirmationDraft((current) => ({
                          ...current,
                          confirmationReference: event.target.value,
                        }))
                      }
                      disabled={isConfirmationSaving}
                      className="h-9 border-slate-200 bg-white"
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                    {t("intentsPage.confirmationNotes")}
                    <textarea
                      value={confirmationDraft.confirmationNotes}
                      onChange={(event) =>
                        setConfirmationDraft((current) => ({
                          ...current,
                          confirmationNotes: event.target.value,
                        }))
                      }
                      disabled={isConfirmationSaving}
                      className="min-h-20 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                    />
                  </label>
                  <Button
                    onClick={() => void handleConfirmSubmission()}
                    disabled={isConfirmationSaving || !confirmationDraft.submittedAt}
                    className="w-fit rounded-lg bg-blue-700 text-white hover:bg-blue-800"
                  >
                    {isConfirmationSaving ? t("intentsPage.submissionSaving") : t("intentsPage.confirmSubmission")}
                  </Button>
                  {submissionConfirmation ? (
                    <p className="text-sm font-semibold text-blue-900">
                      {t("intentsPage.latestConfirmation")}: {submissionConfirmation.confirmationReference || submissionConfirmation.method}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        {pursuitLanes.map((lane) => (
          <article key={lane.key} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-slate-950">
                {t(`intentsPage.pipeline.${lane.key}`)}
              </h3>
              <span className="grid h-6 min-w-7 place-items-center rounded-full bg-violet-50 px-2 text-xs font-black text-violet-700">
                {lane.count}
              </span>
            </div>
            <div className="mt-3 grid gap-2">
              {lane.items.map((item) => (
                <div key={item} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-xs font-bold text-slate-600">
                  {t(`intentsPage.pipelineItems.${item}`)}
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
