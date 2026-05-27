"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchIntents } from "@/lib/api/intents";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { IntentSummary } from "@/server/intents/types";
import { ArrowRight, BriefcaseBusiness, CalendarClock, ClipboardList, Target } from "lucide-react";

const productLabel = "Intent to Bid";

function scoreTone(score: number) {
  if (score >= 75) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (score >= 50) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export default function IntentsPage() {
  const { t } = useLanguage();
  const [intents, setIntents] = useState<IntentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      setIsLoading(true);
      setError(null);

      fetchIntents()
        .then((response) => {
          if (cancelled) return;
          setIntents(response.intents);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err : new Error("Failed to load intents"));
        })
        .finally(() => {
          if (cancelled) return;
          setIsLoading(false);
        });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col h-full gap-6 max-w-5xl mx-auto pb-12">
      <div className="flex items-center gap-3 pb-4 border-b border-slate-200">
        <div className="p-2.5 bg-slate-100 text-slate-700 rounded-lg border border-slate-200 shadow-sm">
          <BriefcaseBusiness size={22} strokeWidth={2.5} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-slate-400">{productLabel}</p>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t("intentsPage.title")}</h1>
          <p className="text-sm text-slate-500 font-medium mt-0.5">{t("intentsPage.description")}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-8">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="border-slate-200 shadow-sm rounded-xl bg-white">
              <CardHeader>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-8 w-full" />
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error && intents.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-slate-300 bg-white rounded-xl">
          <p className="text-slate-900 font-semibold mb-2">{t("intentsPage.errorTitle")}</p>
          <p className="text-sm text-slate-500">{t("intentsPage.errorDescription")}</p>
        </div>
      ) : intents.length > 0 ? (
        <div className="flex flex-col gap-4 pb-8">
          {error && (
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
              <span className="font-semibold text-slate-900">{t("intentsPage.errorTitle")}</span>
              <span className="ml-2">{t("intentsPage.errorDescription")}</span>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {intents.map((intent) => (
              <Card key={intent.id} className="border-slate-200 shadow-sm rounded-xl bg-white">
                <CardHeader className="gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <Badge variant="outline" className="rounded-md border-slate-200 bg-slate-50 text-slate-600">
                      {t(`intentsPage.statuses.${intent.status}`)}
                    </Badge>
                    <Badge variant="outline" className={`rounded-md ${scoreTone(intent.match.score)}`}>
                      {intent.match.score}% {t("intentsPage.matchSnapshot")}
                    </Badge>
                  </div>
                  <CardTitle className="text-lg font-semibold text-slate-900 break-words line-clamp-2">
                    {intent.bid.title}
                  </CardTitle>
                  <p className="flex items-center gap-1.5 text-sm font-medium text-slate-500 truncate">
                    <Target size={14} className="shrink-0 text-slate-400" />
                    <span className="truncate">{intent.bid.issuerName}</span>
                  </p>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-400">
                      <CalendarClock size={13} /> {t("bid.deadline")}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{intent.bid.deadlineDate}</p>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-400">
                      <ClipboardList size={13} /> {t("intentsPage.checklist")}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {intent.generated.initialChecklist.length} {t("intentsPage.items")}
                    </p>
                  </div>
                </CardContent>
                <CardFooter className="justify-end bg-slate-50/50 border-slate-100">
                  <Link
                    href={`/intents/${intent.id}`}
                    className={buttonVariants({
                      className: "bg-slate-900 hover:bg-slate-800 text-white rounded-lg",
                    })}
                  >
                    {t("intentsPage.openWorkspace")}
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 px-4 text-center border border-dashed border-slate-300 rounded-xl bg-slate-50/50 mt-4">
          <div className="h-16 w-16 bg-white border border-slate-100 shadow-sm rounded-full flex items-center justify-center text-slate-400 mb-5">
            <BriefcaseBusiness size={28} />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">{t("intentsPage.emptyTitle")}</h2>
          <p className="text-slate-500 font-medium max-w-md">{t("intentsPage.emptyDescription")}</p>
        </div>
      )}
    </div>
  );
}
