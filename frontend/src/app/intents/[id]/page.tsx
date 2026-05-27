"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchIntent, updateIntentStatus } from "@/lib/api/intents";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { IntentDetail, IntentStatus } from "@/server/intents/types";
import { INTENT_STATUSES } from "@/server/intents/types";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  Target,
} from "lucide-react";

function scoreTone(score: number) {
  if (score >= 75) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (score >= 50) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-slate-600 bg-slate-50 border-slate-200";
}

function metricLabel(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
}

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
    <div className="max-w-5xl mx-auto flex flex-col gap-6 pb-16 pt-4">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => router.back()} className="-ml-3 text-slate-500 hover:text-slate-900 font-medium">
          <ArrowLeft className="mr-2 h-4 w-4" /> {t("intentsPage.backToIntents")}
        </Button>
        <Link
          href={intent.bid.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({
            variant: "outline",
            className: "border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg",
          })}
        >
          <ExternalLink className="mr-2 h-4 w-4" /> {t("detail.viewSource")}
        </Link>
      </div>

      <div className="flex flex-col gap-4 pb-4 border-b border-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-md border-slate-200 bg-slate-50 text-slate-600">
            {t(`intentsPage.statuses.${intent.status}`)}
          </Badge>
          <Badge variant="outline" className={`rounded-md ${scoreTone(intent.match.score)}`}>
            {intent.match.score}% {t("intentsPage.matchSnapshot")}
          </Badge>
          <span className="text-sm font-medium text-slate-500 flex min-w-0 items-center gap-1.5">
            <Building2 size={14} className="shrink-0 text-slate-400" />
            <span className="truncate">{intent.bid.issuerName}</span>
          </span>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 leading-tight tracking-tight break-words">
          {intent.bid.title}
        </h1>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-500">{t("intentsPage.status")}</span>
            <Select
              value={intent.status}
              onValueChange={(value) => void handleStatusChange(value)}
              disabled={isSaving}
            >
              <SelectTrigger className="h-9 min-w-56 bg-white border-slate-200 rounded-lg shadow-sm focus:ring-slate-900">
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
            {isSaving ? t("intentsPage.savingStatus") : isSaved ? t("intentsPage.saveStatus") : saveError ? t("intentsPage.saveError") : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <Card className="border-slate-200 shadow-sm rounded-xl bg-white">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Sparkles size={18} className="text-slate-400" /> {t("intentsPage.brief")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap leading-7 text-slate-700 break-words">{intent.generated.aiBidBrief}</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm rounded-xl bg-white">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <CalendarClock size={18} className="text-slate-400" /> {t("intentsPage.keyDates")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
              <p className="text-xs font-semibold uppercase text-slate-400">{t("dashboard.publishedDate")}</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{intent.generated.keyDates.publishedDate}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
              <p className="text-xs font-semibold uppercase text-slate-400">{t("bid.deadline")}</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{intent.generated.keyDates.deadlineDate}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-slate-200 shadow-sm rounded-xl bg-white">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <CheckCircle2 size={18} className="text-slate-400" /> {t("intentsPage.checklist")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {intent.generated.initialChecklist.map((item) => (
                <li key={item} className="flex gap-2 text-sm leading-6 text-slate-700">
                  <CheckCircle2 size={16} className="mt-1 shrink-0 text-emerald-600" />
                  <span className="break-words">{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm rounded-xl bg-white">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <ShieldAlert size={18} className="text-slate-400" /> {t("intentsPage.riskFlags")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {intent.generated.riskFlags.map((item) => (
                <li key={item} className="flex gap-2 text-sm leading-6 text-slate-700">
                  <ShieldAlert size={16} className="mt-1 shrink-0 text-amber-600" />
                  <span className="break-words">{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-xl bg-white">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Target size={18} className="text-slate-400" /> {t("intentsPage.matchSnapshot")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[0.7fr_1.3fr]">
          <div className={`rounded-xl border p-5 ${scoreTone(intent.match.score)}`}>
            <p className="text-xs font-semibold uppercase">{t("intentsPage.matchSnapshot")}</p>
            <p className="mt-2 text-4xl font-bold">{intent.match.score}%</p>
            <p className="mt-1 text-sm font-semibold">{t(`intentsPage.confidence.${intent.match.confidence}`)}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {matchComponents.map(([key, value]) => (
              <div key={key} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                <p className="text-xs font-semibold uppercase text-slate-400">{metricLabel(key)}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
          <p className="md:col-span-2 text-sm leading-6 text-slate-600 break-words">{intent.match.explanation}</p>
        </CardContent>
      </Card>
    </div>
  );
}
