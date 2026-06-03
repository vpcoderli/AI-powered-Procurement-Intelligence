"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { fetchIntents } from "@/lib/api/intents";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { IntentSummary } from "@/server/intents/types";
import { ArrowRight, BriefcaseBusiness, CalendarClock, ClipboardList, Route, Target } from "lucide-react";

const productLabel = "Intent to Bid";
const PIPELINE_FILTERS = {
  qualifying: {
    href: "/intents?pipeline=qualifying",
    labelKey: "intentsPage.pipelineFilters.qualifying",
    descriptionKey: "intentsPage.pipelineFilterDescriptions.qualifying",
    statuses: ["needs_review", "questions_needed", "sourcing_needed"],
  },
  ready: {
    href: "/intents?pipeline=ready",
    labelKey: "intentsPage.pipelineFilters.ready",
    descriptionKey: "intentsPage.pipelineFilterDescriptions.ready",
    statuses: ["pursuit_decision_needed"],
  },
  blocked: {
    href: "/intents?pipeline=blocked",
    labelKey: "intentsPage.pipelineFilters.blocked",
    descriptionKey: "intentsPage.pipelineFilterDescriptions.blocked",
    statuses: null,
  },
  open: {
    href: "/intents?pipeline=open",
    labelKey: "intentsPage.pipelineFilters.open",
    descriptionKey: "intentsPage.pipelineFilterDescriptions.open",
    statuses: null,
  },
  "missing-artifacts": {
    href: "/intents?pipeline=missing-artifacts",
    labelKey: "intentsPage.pipelineFilters.missingArtifacts",
    descriptionKey: "intentsPage.pipelineFilterDescriptions.missingArtifacts",
    statuses: null,
  },
  exported: {
    href: "/intents?pipeline=exported",
    labelKey: "intentsPage.pipelineFilters.exported",
    descriptionKey: "intentsPage.pipelineFilterDescriptions.exported",
    statuses: null,
  },
} as const;

type PipelineFilterKey = keyof typeof PIPELINE_FILTERS;

function isPipelineFilterKey(value: string | null): value is PipelineFilterKey {
  return value !== null && value in PIPELINE_FILTERS;
}

function scoreTone(score: number) {
  if (score >= 75) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (score >= 50) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function IntentsPageContent() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [intents, setIntents] = useState<IntentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const pipelineFilter = searchParams.get("pipeline");
  const activePipelineFilter = isPipelineFilterKey(pipelineFilter) ? PIPELINE_FILTERS[pipelineFilter] : null;

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      return () => {
        cancelled = true;
      };
    }

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
  }, [user]);

  const filterStatuses: readonly string[] | null = activePipelineFilter?.statuses ?? null;
  const visibleIntents = filterStatuses
    ? intents.filter((intent) => filterStatuses.includes(intent.status))
    : intents;

  if (!user) return <AuthRequiredState />;

  return (
    <div className="winbids-workspace">
      <section className="winbids-hero-panel flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="winbids-sidebar-mark">
            <BriefcaseBusiness size={20} strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="winbids-kicker">{productLabel}</p>
            <h1 className="winbids-title">{t("intentsPage.title")}</h1>
            <p className="winbids-lead mt-2">{t("intentsPage.description")}</p>
          </div>
        </div>
        <div className="winbids-score-badge">
          <Route size={22} aria-hidden="true" />
          <span className="text-[11px] font-black uppercase">Path</span>
        </div>
      </section>

      <nav className="flex flex-wrap gap-2" aria-label={t("intentsPage.pipelineFilterNav")}>
        <Link
          href="/intents"
          className={buttonVariants({
            variant: activePipelineFilter ? "outline" : "default",
            className: "h-9 rounded-lg",
          })}
        >
          {t("intentsPage.pipelineFilters.all")}
        </Link>
        {Object.entries(PIPELINE_FILTERS).map(([key, filter]) => (
          <Link
            key={key}
            href={filter.href}
            className={buttonVariants({
              variant: pipelineFilter === key ? "default" : "outline",
              className: "h-9 rounded-lg",
            })}
          >
            {t(filter.labelKey)}
          </Link>
        ))}
      </nav>

      {!isLoading && activePipelineFilter && (
        <div className="winbids-panel flex flex-col gap-3 border-blue-100 bg-blue-50/40 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
          <div>
            <Badge variant="outline" className="rounded-md border-blue-200 bg-white text-blue-700">
              {t(activePipelineFilter.labelKey)}
            </Badge>
            <p className="mt-2 font-medium">{t(activePipelineFilter.descriptionKey)}</p>
          </div>
          <Link
            href="/intents"
            className={buttonVariants({
              variant: "outline",
              className: "h-9 rounded-lg border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
            })}
          >
            {t("intentsPage.clearPipelineFilter")}
          </Link>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-8">
          {Array.from({ length: 4 }).map((_, index) => (
              <Card key={index} className="winbids-panel border-slate-200 shadow-sm rounded-lg bg-white">
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
            <div className="winbids-panel text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{t("intentsPage.errorTitle")}</span>
              <span className="ml-2">{t("intentsPage.errorDescription")}</span>
            </div>
          )}
          {visibleIntents.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleIntents.map((intent) => (
                <Card key={intent.id} className="winbids-panel border-slate-200 rounded-lg bg-white">
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
          ) : (
            <div className="winbids-panel flex flex-col items-center justify-center py-16 px-4 text-center border-dashed border-slate-300">
              <h2 className="text-xl font-semibold text-slate-900 mb-2">{t("intentsPage.filteredEmptyTitle")}</h2>
              <p className="text-slate-500 font-medium max-w-md">{t("intentsPage.filteredEmptyDescription")}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="winbids-panel flex flex-col items-center justify-center py-24 px-4 text-center border-dashed border-slate-300 mt-4">
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

export default function IntentsPage() {
  return (
    <Suspense fallback={null}>
      <IntentsPageContent />
    </Suspense>
  );
}
