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
  fetchComplianceManifest,
  fetchIntent,
  fetchPursuitDecisionBoard,
  fetchQualificationCitations,
  fetchQualificationFreshness,
  fetchSubmissionGuidance,
  postQualificationQuestion,
  refreshQualificationEvidence,
  updateComplianceManifestItem,
  updateIntentStatus,
  updatePursuitDecision,
  updateSubmissionGuidance,
} from "@/lib/api/intents";
import { lockedFeatureMessage, useFeature } from "@/lib/features/useFeature";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { IntentDetail, IntentStatus } from "@/server/intents/types";
import { INTENT_STATUSES } from "@/server/intents/types";
import type {
  QualificationCitation,
  QualificationFreshnessResponse,
  QualificationQuestionResponse,
} from "@/server/qualification/types";
import type {
  ComplianceEvidenceStatus,
  ComplianceItemStatus,
  ComplianceManifest,
  ComplianceManifestItem,
} from "@/server/compliance/types";
import {
  COMPLIANCE_EVIDENCE_STATUSES,
  COMPLIANCE_ITEM_STATUSES,
} from "@/server/compliance/types";
import type {
  PursuitDecisionBoard,
  PursuitDecisionValue,
} from "@/server/pursuit/types";
import { PURSUIT_DECISIONS } from "@/server/pursuit/types";
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
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  Gauge,
  Landmark,
  LockKeyhole,
  PackageCheck,
  RefreshCcw,
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

function safeEvidenceUrl(value: string) {
  if (value.startsWith("/")) return value;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : "";
  } catch {
    return "";
  }
}

function formatEvidenceDate(value: string | null) {
  if (!value) return "";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function freshnessTone(status: QualificationFreshnessResponse["status"] | undefined) {
  if (status === "current") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "stale") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
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

const complianceStatuses: ComplianceItemStatus[] = [...COMPLIANCE_ITEM_STATUSES];
const complianceEvidenceStatuses: ComplianceEvidenceStatus[] = [...COMPLIANCE_EVIDENCE_STATUSES];
const pursuitDecisionOptions: PursuitDecisionValue[] = [...PURSUIT_DECISIONS];

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

interface PursuitDecisionDraft {
  decision: PursuitDecisionValue;
  reasons: string;
  notes: string;
}

const defaultSubmissionDraft: SubmissionDraft = {
  method: "unknown",
  portalUrl: "",
  contactEmail: "",
  requiresRegistration: false,
  requiresPhysicalDelivery: false,
  requiresAddendaAcknowledgement: false,
};

const defaultPursuitDecisionDraft: PursuitDecisionDraft = {
  decision: "defer",
  reasons: "",
  notes: "",
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
  const [complianceManifest, setComplianceManifest] = useState<ComplianceManifest | null>(null);
  const [isComplianceLoading, setIsComplianceLoading] = useState(false);
  const [complianceSavingItemId, setComplianceSavingItemId] = useState<string | null>(null);
  const [complianceError, setComplianceError] = useState<Error | null>(null);
  const [complianceNotice, setComplianceNotice] = useState("");
  const [pursuitDecisionBoard, setPursuitDecisionBoard] = useState<PursuitDecisionBoard | null>(null);
  const [pursuitDecisionDraft, setPursuitDecisionDraft] = useState<PursuitDecisionDraft>(defaultPursuitDecisionDraft);
  const [isPursuitDecisionLoading, setIsPursuitDecisionLoading] = useState(false);
  const [isPursuitDecisionSaving, setIsPursuitDecisionSaving] = useState(false);
  const [pursuitDecisionError, setPursuitDecisionError] = useState<Error | null>(null);
  const [pursuitDecisionNotice, setPursuitDecisionNotice] = useState("");
  const [qualificationCitations, setQualificationCitations] = useState<QualificationCitation[]>([]);
  const [qualificationFreshness, setQualificationFreshness] = useState<QualificationFreshnessResponse | null>(null);
  const [isCitationsLoading, setIsCitationsLoading] = useState(false);
  const [isFreshnessLoading, setIsFreshnessLoading] = useState(false);
  const [isRefreshingQualification, setIsRefreshingQualification] = useState(false);
  const [qualificationRefreshError, setQualificationRefreshError] = useState<Error | null>(null);
  const [qaQuestion, setQaQuestion] = useState("");
  const [qaAnswer, setQaAnswer] = useState<QualificationQuestionResponse | null>(null);
  const [isQaLoading, setIsQaLoading] = useState(false);
  const [qaError, setQaError] = useState<Error | null>(null);
  const submissionGuidanceFeature = useFeature("submission_guidance");
  const complianceManifestFeature = useFeature("compliance_manifest");
  const pursuitDecisionFeature = useFeature("pursue_no_bid");
  const qualificationQaFeature = useFeature("bid.brief.full.generate");

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

      setQualificationCitations([]);
      setQualificationFreshness(null);
      setQualificationRefreshError(null);
      setQaAnswer(null);
      setQaError(null);

      if (!intentId) {
        setIsCitationsLoading(false);
        setIsFreshnessLoading(false);
        return;
      }

      setIsCitationsLoading(true);
      setIsFreshnessLoading(true);

      fetchQualificationFreshness(intentId)
        .then(async (freshnessResponse) => {
          const citationsResponse = await fetchQualificationCitations(intentId);
          if (cancelled || !mountedRef.current) return;
          setQualificationCitations(citationsResponse.citations);
          setQualificationFreshness(freshnessResponse);
        })
        .catch(() => {
          if (cancelled || !mountedRef.current) return;
          setQualificationCitations([]);
          setQualificationFreshness(null);
        })
        .finally(() => {
          if (cancelled || !mountedRef.current) return;
          setIsCitationsLoading(false);
          setIsFreshnessLoading(false);
        });
    });

    return () => {
      cancelled = true;
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

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled || !mountedRef.current) return;

      setComplianceManifest(null);
      setComplianceNotice("");
      setComplianceError(null);

      if (!intentId || !complianceManifestFeature.enabled) {
        setIsComplianceLoading(false);
        return;
      }

      setIsComplianceLoading(true);

      fetchComplianceManifest(intentId)
        .then((response) => {
          if (cancelled || !mountedRef.current) return;
          setComplianceManifest(response.manifest);
        })
        .catch((err) => {
          if (cancelled || !mountedRef.current) return;
          setComplianceError(err instanceof Error ? err : new Error("Failed to load compliance manifest"));
        })
        .finally(() => {
          if (cancelled || !mountedRef.current) return;
          setIsComplianceLoading(false);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [intentId, complianceManifestFeature.enabled]);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled || !mountedRef.current) return;

      setPursuitDecisionBoard(null);
      setPursuitDecisionDraft(defaultPursuitDecisionDraft);
      setPursuitDecisionNotice("");
      setPursuitDecisionError(null);

      if (!intentId || !pursuitDecisionFeature.enabled) {
        setIsPursuitDecisionLoading(false);
        return;
      }

      setIsPursuitDecisionLoading(true);

      fetchPursuitDecisionBoard(intentId)
        .then((response) => {
          if (cancelled || !mountedRef.current) return;

          setPursuitDecisionBoard(response.decisionBoard);
          if (response.decisionBoard.currentDecision) {
            setPursuitDecisionDraft({
              decision: response.decisionBoard.currentDecision.decision,
              reasons: response.decisionBoard.currentDecision.reasons.join("\n"),
              notes: response.decisionBoard.currentDecision.notes,
            });
          }
        })
        .catch((err) => {
          if (cancelled || !mountedRef.current) return;
          setPursuitDecisionError(err instanceof Error ? err : new Error("Failed to load pursuit decision"));
        })
        .finally(() => {
          if (cancelled || !mountedRef.current) return;
          setIsPursuitDecisionLoading(false);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [intentId, pursuitDecisionFeature.enabled]);

  const matchComponents = useMemo(() => {
    if (!intent) return [];
    return Object.entries(intent.match.components);
  }, [intent]);

  const handleAskEvidenceQuestion = async () => {
    if (!intent || !qualificationQaFeature.enabled || isQaLoading) return;

    const question = qaQuestion.trim();
    if (!question) {
      setQaError(new Error("Question is required"));
      return;
    }

    setIsQaLoading(true);
    setQaAnswer(null);
    setQaError(null);

    try {
      const response = await postQualificationQuestion(intent.id, { question });
      if (!mountedRef.current) return;

      setQaAnswer(response);
      setQaQuestion(response.question);
    } catch (err) {
      if (!mountedRef.current) return;
      setQaError(err instanceof Error ? err : new Error("Failed to answer question"));
    } finally {
      if (mountedRef.current) {
        setIsQaLoading(false);
      }
    }
  };

  const handleRefreshQualificationEvidence = async () => {
    if (!intent || isRefreshingQualification) return;

    setIsRefreshingQualification(true);
    setQualificationRefreshError(null);

    try {
      const response = await refreshQualificationEvidence(intent.id);
      if (!mountedRef.current) return;

      setIntent(response.intent);
      setQualificationCitations(response.citations.citations);
      setQualificationFreshness(response.freshness);
      setQaAnswer(null);
      setQaError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setQualificationRefreshError(err instanceof Error ? err : new Error("Failed to refresh qualification evidence"));
    } finally {
      if (mountedRef.current) {
        setIsRefreshingQualification(false);
      }
    }
  };

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

  function updateLocalComplianceItem(
    itemId: string,
    patch: Partial<Pick<ComplianceManifestItem, "status" | "evidenceStatus" | "notes">>,
  ) {
    setComplianceManifest((current) => current
      ? {
          ...current,
          items: current.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
        }
      : current);
  }

  const handleComplianceItemUpdate = async (
    item: ComplianceManifestItem,
    patch: Partial<Pick<ComplianceManifestItem, "status" | "evidenceStatus" | "notes">>,
  ) => {
    if (!intent || !complianceManifestFeature.enabled || complianceSavingItemId) return;

    setComplianceSavingItemId(item.id);
    setComplianceNotice("");
    setComplianceError(null);

    try {
      const response = await updateComplianceManifestItem(intent.id, {
        itemId: item.id,
        ...patch,
      });
      if (!mountedRef.current) return;

      setComplianceManifest(response.manifest);
      setComplianceNotice(t("intentsPage.complianceManifestSaved"));
    } catch (err) {
      if (!mountedRef.current) return;
      setComplianceError(err instanceof Error ? err : new Error("Failed to save compliance manifest"));
    } finally {
      if (mountedRef.current) {
        setComplianceSavingItemId(null);
      }
    }
  };

  const handleSavePursuitDecision = async () => {
    if (!intent || !pursuitDecisionFeature.enabled || isPursuitDecisionSaving) return;

    setIsPursuitDecisionSaving(true);
    setPursuitDecisionNotice("");
    setPursuitDecisionError(null);

    try {
      const response = await updatePursuitDecision(intent.id, {
        decision: pursuitDecisionDraft.decision,
        reasons: pursuitDecisionDraft.reasons
          .split("\n")
          .map((reason) => reason.trim())
          .filter(Boolean),
        notes: pursuitDecisionDraft.notes.trim(),
      });
      if (!mountedRef.current) return;

      setPursuitDecisionBoard(response.decisionBoard);
      setPursuitDecisionNotice(t("intentsPage.pursuitDecisionSaved"));
    } catch (err) {
      if (!mountedRef.current) return;
      setPursuitDecisionError(err instanceof Error ? err : new Error("Failed to save pursuit decision"));
    } finally {
      if (mountedRef.current) {
        setIsPursuitDecisionSaving(false);
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
          <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black text-slate-950">{t("intentsPage.evidenceCitations")}</p>
              <Badge variant="outline" className="border-blue-200 bg-white text-blue-700">
                {qualificationCitations.length}
              </Badge>
            </div>
            <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-black text-slate-950">
                      {t("intentsPage.qualificationFreshness")}
                    </p>
                    <Badge
                      variant="outline"
                      className={`w-fit ${freshnessTone(qualificationFreshness?.status)}`}
                    >
                      {qualificationFreshness
                        ? t(`intentsPage.qualificationFreshnessStatuses.${qualificationFreshness.status}`)
                        : isFreshnessLoading
                          ? t("intentsPage.evidenceCitationsLoading")
                          : t("intentsPage.qualificationFreshnessStatuses.not_refreshed")}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
                    {qualificationFreshness?.status === "stale"
                      ? t("intentsPage.qualificationFreshnessStale")
                      : qualificationFreshness?.status === "current"
                        ? t("intentsPage.qualificationFreshnessCurrent")
                        : t("intentsPage.qualificationFreshnessNotRefreshed")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                    <span>
                      {t("intentsPage.qualificationSignalCount").replace(
                        "{count}",
                        String(qualificationFreshness?.signalCount ?? 0),
                      )}
                    </span>
                    <span>
                      {t("intentsPage.qualificationLastRefreshed").replace(
                        "{date}",
                        formatEvidenceDate(qualificationFreshness?.lastRefreshedAt ?? null)
                          || t("intentsPage.notAvailable"),
                      )}
                    </span>
                  </div>
                  {qualificationFreshness?.latestSignal ? (
                    <p className="mt-2 line-clamp-2 break-words text-xs font-semibold leading-5 text-amber-700">
                      {t("intentsPage.qualificationLatestSignal")}: {qualificationFreshness.latestSignal.label}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs font-semibold text-slate-400">
                      {t("intentsPage.qualificationNoSignals")}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  onClick={() => void handleRefreshQualificationEvidence()}
                  disabled={!intent || isFreshnessLoading || isRefreshingQualification}
                  variant="outline"
                  className="w-fit rounded-lg border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                >
                  <RefreshCcw
                    size={15}
                    className={`mr-2 ${isRefreshingQualification ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  {isRefreshingQualification
                    ? t("intentsPage.refreshingQualificationEvidence")
                    : t("intentsPage.refreshQualificationEvidence")}
                </Button>
              </div>
              {qualificationRefreshError ? (
                <p className="mt-2 text-xs font-semibold text-rose-600">
                  {t("intentsPage.qualificationRefreshError")}
                </p>
              ) : null}
            </div>
            {isCitationsLoading ? (
              <p className="mt-3 text-sm font-semibold text-slate-500">{t("intentsPage.evidenceCitationsLoading")}</p>
            ) : qualificationCitations.length === 0 ? (
              <p className="mt-3 text-sm font-semibold text-slate-500">{t("intentsPage.noEvidenceCitations")}</p>
            ) : (
              <div className="mt-3 grid gap-2">
                {qualificationCitations.slice(0, 6).map((citation) => {
                  const evidenceUrl = safeEvidenceUrl(citation.url);

                  return (
                    <article key={citation.id} className="rounded-lg border border-blue-100 bg-white p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                          {t(`intentsPage.citationSections.${citation.section}`)}
                        </Badge>
                        <span className="text-xs font-black text-slate-900">{citation.sourceLabel}</span>
                        <span className="text-xs font-bold text-slate-400">
                          {t(`intentsPage.confidence.${citation.confidence}`)}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 break-words text-xs font-semibold leading-5 text-slate-600">
                        {citation.excerpt}
                      </p>
                      {evidenceUrl ? (
                        <Link
                          href={evidenceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center text-xs font-black text-blue-700 hover:text-blue-900"
                        >
                          <ExternalLink size={13} className="mr-1.5" aria-hidden="true" />
                          {t("intentsPage.openEvidence")}
                        </Link>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
          <div className={`mt-4 rounded-lg border p-4 ${
            qualificationQaFeature.enabled ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/60"
          }`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-black text-slate-950">{t("intentsPage.askEvidenceQuestion")}</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                  {qualificationQaFeature.enabled
                    ? t("intentsPage.groundedByEvidence")
                    : lockedFeatureMessage("bid.brief.full.generate")}
                </p>
              </div>
              {qaAnswer ? (
                <Badge variant="outline" className="w-fit border-emerald-200 bg-emerald-50 text-emerald-700">
                  {t("intentsPage.groundedAnswer")}
                </Badge>
              ) : null}
            </div>
            {qualificationQaFeature.enabled ? (
              <div className="mt-3 grid gap-3">
                <textarea
                  value={qaQuestion}
                  onChange={(event) => setQaQuestion(event.target.value)}
                  disabled={isQaLoading}
                  placeholder={t("intentsPage.askEvidenceQuestionPlaceholder")}
                  className="min-h-20 w-full resize-y rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm font-semibold leading-6 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                />
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button
                    onClick={() => void handleAskEvidenceQuestion()}
                    disabled={isQaLoading || !qaQuestion.trim()}
                    className="w-fit rounded-lg bg-slate-950 text-white hover:bg-slate-800"
                  >
                    {isQaLoading ? t("intentsPage.askingQuestion") : t("intentsPage.askQuestion")}
                  </Button>
                  <p className="min-h-5 text-sm font-semibold text-slate-500">
                    {qaError ? t("intentsPage.qaError") : ""}
                  </p>
                </div>
                {qaAnswer ? (
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-4">
                    <p className="text-sm font-black text-slate-950">{t("intentsPage.groundedAnswer")}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-7 text-slate-700">
                      {qaAnswer.answer}
                    </p>
                    <p className="mt-4 text-xs font-black uppercase text-slate-400">
                      {t("intentsPage.answerEvidence")}
                    </p>
                    <div className="mt-2 grid gap-2">
                      {qaAnswer.citations.map((citation) => {
                        const evidenceUrl = safeEvidenceUrl(citation.url);

                        return (
                          <article key={citation.id} className="rounded-lg border border-emerald-100 bg-white p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                                {t(`intentsPage.citationSections.${citation.section}`)}
                              </Badge>
                              <span className="text-xs font-black text-slate-900">{citation.sourceLabel}</span>
                            </div>
                            <p className="mt-2 line-clamp-2 break-words text-xs font-semibold leading-5 text-slate-600">
                              {citation.excerpt}
                            </p>
                            {evidenceUrl ? (
                              <Link
                                href={evidenceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 inline-flex items-center text-xs font-black text-blue-700 hover:text-blue-900"
                              >
                                <ExternalLink size={13} className="mr-1.5" aria-hidden="true" />
                                {t("intentsPage.openEvidence")}
                              </Link>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm font-semibold leading-6 text-amber-800">
                {lockedFeatureMessage("bid.brief.full.generate")}
              </p>
            )}
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
              ["compliance", FileCheck2],
              ["decision", ClipboardCheck],
              ["award", PackageCheck],
            ].map(([key, Icon]) => {
              const ModuleIcon = Icon as typeof Target;
              const isSubmissionLocked = key === "submission" && !submissionGuidanceFeature.enabled;
              const isComplianceLocked = key === "compliance" && !complianceManifestFeature.enabled;
              const isDecisionLocked = key === "decision" && !pursuitDecisionFeature.enabled;
              const isLocked = isSubmissionLocked || isComplianceLocked || isDecisionLocked;
              const requiredTier = isComplianceLocked
                ? complianceManifestFeature.requiredTier
                : isDecisionLocked
                  ? pursuitDecisionFeature.requiredTier
                  : submissionGuidanceFeature.requiredTier;
              const lockedMessage = isComplianceLocked
                ? lockedFeatureMessage("compliance_manifest")
                : isDecisionLocked
                  ? lockedFeatureMessage("pursue_no_bid")
                  : lockedFeatureMessage("submission_guidance");
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
                          {requiredTier}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                      {isLocked
                        ? lockedMessage
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
        className={`winbids-panel pursuitDecision rounded-lg border p-5 shadow-sm ${
          pursuitDecisionFeature.enabled ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/60"
        }`}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-blue-700">
              {pursuitDecisionFeature.enabled
                ? t("intentsPage.pursuitDecision")
                : t("intentsPage.nextPhasePreview")}
            </p>
            <h2 className="mt-1 flex items-center gap-2 text-2xl font-black text-slate-950">
              <ClipboardCheck size={21} className="text-blue-700" aria-hidden="true" />
              {t("intentsPage.pursuitDecision")}
            </h2>
          </div>
          <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">
            {pursuitDecisionFeature.enabled
              ? pursuitDecisionBoard
                ? t(`intentsPage.pursuitRecommendations.${pursuitDecisionBoard.recommendation.recommendation}`)
                : t("intentsPage.pursuitDecisionLoading")
              : lockedFeatureMessage("pursue_no_bid")}
          </span>
        </div>

        {!pursuitDecisionFeature.enabled ? (
          <p className="mt-4 text-sm font-semibold leading-6 text-amber-800">
            {lockedFeatureMessage("pursue_no_bid")}
          </p>
        ) : (
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(300px,1.05fr)]">
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-sm font-black text-slate-950">{t("intentsPage.recommendation")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-blue-100 bg-blue-50 text-blue-700">
                  {pursuitDecisionBoard
                    ? t(`intentsPage.pursuitRecommendations.${pursuitDecisionBoard.recommendation.recommendation}`)
                    : t("intentsPage.pursuitDecisionLoading")}
                </Badge>
                {pursuitDecisionBoard && (
                  <Badge variant="outline" className="border-slate-200 bg-white text-slate-700">
                    {t(`intentsPage.pursuitConfidence.${pursuitDecisionBoard.recommendation.confidence}`)}
                  </Badge>
                )}
              </div>
              <ul className="mt-4 space-y-2">
                {(pursuitDecisionBoard?.recommendation.reasons ?? [t("intentsPage.pursuitDecisionLoading")]).map((reason) => (
                  <li key={reason} className="flex gap-2 text-sm font-semibold leading-6 text-slate-700">
                    <ShieldAlert size={16} className="mt-1 shrink-0 text-amber-600" aria-hidden="true" />
                    <span className="break-words">{reason}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                <p className="text-xs font-black uppercase text-slate-400">
                  {t("intentsPage.reasonTaxonomy")}
                </p>
                <div className="mt-3 grid gap-3">
                  {(pursuitDecisionBoard?.recommendation.reasonDetails ?? []).map((detail) => (
                    <article key={`${detail.category}-${detail.summary}`} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="border-blue-100 bg-blue-50 text-blue-700">
                          {t(`intentsPage.pursuitReasonCategories.${detail.category}`)}
                        </Badge>
                        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                          {t(`intentsPage.pursuitReasonSeverities.${detail.severity}`)}
                        </Badge>
                      </div>
                      <p className="mt-2 break-words text-sm font-black leading-6 text-slate-950">
                        {detail.summary}
                      </p>
                      <p className="mt-1 break-words text-xs font-semibold leading-5 text-slate-600">
                        {detail.explanation}
                      </p>
                      <div className="mt-3 grid gap-2 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                        <p className="text-xs font-bold leading-5 text-slate-500">
                          <span className="font-black text-slate-700">{t("intentsPage.evidenceLabel")}:</span>{" "}
                          {detail.evidenceLabel}
                        </p>
                        <p className="text-xs font-bold leading-5 text-slate-500">
                          <span className="font-black text-slate-700">{t("intentsPage.suggestedAction")}:</span>{" "}
                          {detail.suggestedAction}
                        </p>
                      </div>
                    </article>
                  ))}
                  {pursuitDecisionBoard && pursuitDecisionBoard.recommendation.reasonDetails.length === 0 ? (
                    <p className="text-sm font-semibold text-slate-500">{t("intentsPage.noReasonDetails")}</p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.decision")}
                  <Select
                    value={pursuitDecisionDraft.decision}
                    onValueChange={(value) =>
                      setPursuitDecisionDraft((current) => ({
                        ...current,
                        decision: value as PursuitDecisionValue,
                      }))
                    }
                    disabled={isPursuitDecisionLoading || isPursuitDecisionSaving}
                  >
                    <SelectTrigger className="h-9 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                      {pursuitDecisionOptions.map((decision) => (
                        <SelectItem key={decision} value={decision}>
                          {t(`intentsPage.pursuitDecisions.${decision}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.decisionReasons")}
                  <textarea
                    value={pursuitDecisionDraft.reasons}
                    onChange={(event) =>
                      setPursuitDecisionDraft((current) => ({ ...current, reasons: event.target.value }))
                    }
                    disabled={isPursuitDecisionLoading || isPursuitDecisionSaving}
                    placeholder={t("intentsPage.decisionReasonsPlaceholder")}
                    className="min-h-20 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                  />
                </label>
              </div>

              <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                {t("intentsPage.decisionNotes")}
                <textarea
                  value={pursuitDecisionDraft.notes}
                  onChange={(event) =>
                    setPursuitDecisionDraft((current) => ({ ...current, notes: event.target.value }))
                  }
                  disabled={isPursuitDecisionLoading || isPursuitDecisionSaving}
                  placeholder={t("intentsPage.decisionNotesPlaceholder")}
                  className="min-h-20 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                />
              </label>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  onClick={() => void handleSavePursuitDecision()}
                  disabled={isPursuitDecisionLoading || isPursuitDecisionSaving}
                  className="w-fit rounded-lg bg-slate-950 text-white hover:bg-slate-800"
                >
                  {isPursuitDecisionSaving ? t("intentsPage.submissionSaving") : t("intentsPage.savePursuitDecision")}
                </Button>
                <p className="min-h-5 text-sm font-semibold text-slate-500">
                  {pursuitDecisionError
                    ? t("intentsPage.pursuitDecisionSaveError")
                    : pursuitDecisionNotice}
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-sm font-black text-slate-950">{t("intentsPage.decisionHistory")}</p>
                <div className="mt-3 space-y-2">
                  {(pursuitDecisionBoard?.history.length ? pursuitDecisionBoard.history : []).map((decision) => (
                    <div key={decision.id} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="border-slate-200 bg-white text-slate-700">
                          {t(`intentsPage.pursuitDecisions.${decision.decision}`)}
                        </Badge>
                        <span className="text-xs font-bold text-slate-400">{decision.createdAt}</span>
                      </div>
                      {decision.reasons.length > 0 && (
                        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                          {decision.reasons.join(" / ")}
                        </p>
                      )}
                      {decision.notes && (
                        <p className="mt-1 text-sm leading-6 text-slate-500">{decision.notes}</p>
                      )}
                    </div>
                  ))}
                  {!pursuitDecisionBoard?.history.length && (
                    <p className="text-sm font-semibold text-slate-500">{t("intentsPage.noDecisionHistory")}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
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

      <section
        className={`winbids-panel complianceManifest rounded-lg border p-5 shadow-sm ${
          complianceManifestFeature.enabled ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/60"
        }`}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-blue-700">
              {complianceManifestFeature.enabled
                ? t("intentsPage.complianceManifest")
                : t("intentsPage.nextPhasePreview")}
            </p>
            <h2 className="mt-1 flex items-center gap-2 text-2xl font-black text-slate-950">
              <FileCheck2 size={21} className="text-blue-700" aria-hidden="true" />
              {t("intentsPage.complianceManifest")}
            </h2>
          </div>
          <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">
            {complianceManifestFeature.enabled
              ? complianceManifest
                ? `${complianceManifest.summary.completed}/${complianceManifest.summary.total} ${t("intentsPage.complianceComplete")}`
                : t("intentsPage.complianceLoading")
              : lockedFeatureMessage("compliance_manifest")}
          </span>
        </div>

        {!complianceManifestFeature.enabled ? (
          <p className="mt-4 text-sm font-semibold leading-6 text-amber-800">
            {lockedFeatureMessage("compliance_manifest")}
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ["total", complianceManifest?.summary.total ?? 0],
                ["completed", complianceManifest?.summary.completed ?? 0],
                ["blocked", complianceManifest?.summary.blocked ?? 0],
                ["evidenceAttached", complianceManifest?.summary.evidenceAttached ?? 0],
              ].map(([key, value]) => (
                <div key={key as string} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <p className="text-xs font-black uppercase text-slate-400">
                    {t(`intentsPage.complianceSummary.${key as string}`)}
                  </p>
                  <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
                </div>
              ))}
            </div>

            {isComplianceLoading ? (
              <p className="text-sm font-semibold text-slate-500">{t("intentsPage.complianceLoading")}</p>
            ) : (
              <div className="grid gap-3">
                {(complianceManifest?.items ?? []).map((item) => (
                  <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="border-blue-100 bg-blue-50 text-blue-700">
                            {t(`intentsPage.complianceCategories.${item.category}`)}
                          </Badge>
                          {complianceSavingItemId === item.id && (
                            <span className="text-xs font-bold text-slate-400">
                              {t("intentsPage.submissionSaving")}
                            </span>
                          )}
                        </div>
                        <p className="mt-2 break-words text-sm font-black leading-6 text-slate-950">{item.title}</p>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:w-[360px]">
                        <Select
                          value={item.status}
                          onValueChange={(value) =>
                            void handleComplianceItemUpdate(item, { status: value as ComplianceItemStatus })
                          }
                          disabled={Boolean(complianceSavingItemId)}
                        >
                          <SelectTrigger className="h-9 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                            {complianceStatuses.map((status) => (
                              <SelectItem key={status} value={status}>
                                {t(`intentsPage.complianceStatuses.${status}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={item.evidenceStatus}
                          onValueChange={(value) =>
                            void handleComplianceItemUpdate(item, { evidenceStatus: value as ComplianceEvidenceStatus })
                          }
                          disabled={Boolean(complianceSavingItemId)}
                        >
                          <SelectTrigger className="h-9 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                            {complianceEvidenceStatuses.map((status) => (
                              <SelectItem key={status} value={status}>
                                {t(`intentsPage.complianceEvidenceStatuses.${status}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <textarea
                      value={item.notes}
                      onChange={(event) => updateLocalComplianceItem(item.id, { notes: event.target.value })}
                      onBlur={(event) => void handleComplianceItemUpdate(item, { notes: event.currentTarget.value })}
                      disabled={Boolean(complianceSavingItemId)}
                      placeholder={t("intentsPage.complianceNotesPlaceholder")}
                      className="mt-3 min-h-16 w-full resize-y rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                    />
                  </article>
                ))}
              </div>
            )}

            <p className="min-h-5 text-sm font-semibold text-slate-500">
              {complianceError
                ? t("intentsPage.complianceSaveError")
                : complianceNotice}
            </p>
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
