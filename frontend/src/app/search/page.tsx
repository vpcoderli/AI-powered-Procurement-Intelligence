"use client";

import { useEffect, useState } from "react";
import {
  Search,
  Filter,
  Gauge,
  ClipboardCheck,
  CircleAlert,
  FileCheck2,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { UniversalState } from "@/components/universal-state";
import { BidCard } from "@/components/bids/BidCard";
import { fetchBids } from "@/lib/api/bids";
import { STATE_FILTERS, type Bid, type IssuerType, type SortOption } from "@/lib/mock-data";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { DeadlinePreset, PublishedPreset } from "@/server/bids/types";

const DEADLINE_PRESETS: Array<{ value: DeadlinePreset; labelKey: string }> = [
  { value: "any", labelKey: "dashboard.anyTime" },
  { value: "next7", labelKey: "dashboard.next7Days" },
  { value: "next30", labelKey: "dashboard.next30Days" },
];

const PUBLISHED_PRESETS: Array<{ value: PublishedPreset; labelKey: string }> = [
  { value: "any", labelKey: "dashboard.anyTime" },
  { value: "last24", labelKey: "dashboard.last24Hours" },
  { value: "last7", labelKey: "dashboard.last7Days" },
];

export default function Dashboard() {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [issuerType, setIssuerType] = useState<"all" | IssuerType>("all");
  const [deadlinePreset, setDeadlinePreset] = useState<DeadlinePreset>("any");
  const [publishedPreset, setPublishedPreset] = useState<PublishedPreset>("any");
  const [sortBy, setSortBy] = useState<SortOption>("relevance");
  const [bids, setBids] = useState<Bid[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [authPromptVisible, setAuthPromptVisible] = useState(false);

  const toggleStateFilter = (stateId: string) => {
    setSelectedStates((prev) =>
      prev.includes(stateId) ? prev.filter((id) => id !== stateId) : [...prev, stateId]
    );
  };

  const clearFilters = () => {
    setSelectedStates([]);
    setSearchQuery("");
    setIssuerType("all");
    setDeadlinePreset("any");
    setPublishedPreset("any");
    setSortBy("relevance");
  };

  const retryFetch = () => {
    setRetryTick((tick) => tick + 1);
  };

  const formatMessage = (key: string, values: Record<string, string>) =>
    Object.entries(values).reduce(
      (message, [name, value]) => message.replace(`{${name}}`, value),
      t(key),
    );
  const selectedStateLabels = STATE_FILTERS.filter((state) => selectedStates.includes(state.id)).map((state) => state.label);
  const deadlineLabelKey = DEADLINE_PRESETS.find((option) => option.value === deadlinePreset)?.labelKey;
  const publishedLabelKey = PUBLISHED_PRESETS.find((option) => option.value === publishedPreset)?.labelKey;
  const sortLabelKey = sortBy === "deadline"
    ? "dashboard.soonestDeadline"
    : sortBy === "newest"
      ? "dashboard.newest"
      : "dashboard.relevance";
  const activeFilterLabels = [
    searchQuery.trim() ? formatMessage("dashboard.filterKeyword", { value: searchQuery.trim() }) : null,
    ...selectedStateLabels.map((label) => formatMessage("dashboard.filterRegion", { value: label })),
    issuerType !== "all"
      ? formatMessage("dashboard.filterIssuer", {
        value: issuerType === "federal" ? t("dashboard.federal") : t("dashboard.state"),
      })
      : null,
    deadlinePreset !== "any" && deadlineLabelKey
      ? formatMessage("dashboard.filterDeadline", { value: t(deadlineLabelKey) })
      : null,
    publishedPreset !== "any" && publishedLabelKey
      ? formatMessage("dashboard.filterPublished", { value: t(publishedLabelKey) })
      : null,
  ].filter((label): label is string => Boolean(label));
  const filterStatusLabel = activeFilterLabels.length > 0 ? t("dashboard.filtersActive") : t("dashboard.noFiltersActive");
  const resultStatusTitle = isLoading
    ? t("dashboard.updatingBidQueue")
    : hasError
      ? t("dashboard.searchRefreshFailed")
      : bids.length === 0
        ? t("dashboard.noMatchingBids")
        : formatMessage(total === 1 ? "dashboard.activeBid" : "dashboard.activeBids", { count: String(total) });
  const resultStatusDescription = isLoading
    ? t("dashboard.updatingBidQueueDescription")
    : hasError
      ? t("dashboard.searchRefreshFailedDescription")
      : bids.length === 0
        ? t("dashboard.noMatchingBidsDescription")
        : formatMessage("dashboard.searchReadyDescription", {
          filters: filterStatusLabel,
          sort: t(sortLabelKey),
        });

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      setIsLoading(true);
      setHasError(false);

      fetchBids({
        q: searchQuery,
        states: selectedStates,
        issuerType,
        deadline: deadlinePreset,
        published: publishedPreset,
        sort: sortBy,
      })
        .then((response) => {
          if (cancelled) return;
          setBids(response.bids);
          setTotal(response.total);
        })
        .catch(() => {
          if (cancelled) return;
          setBids([]);
          setTotal(0);
          setHasError(true);
        })
        .finally(() => {
          if (cancelled) return;
          setIsLoading(false);
        });
    });

    return () => {
      if (cancelled) return;
      cancelled = true;
    };
  }, [deadlinePreset, issuerType, publishedPreset, retryTick, searchQuery, selectedStates, sortBy]);

  return (
    <div className="winbids-workspace">
      <section className="winbids-hero-grid" aria-label={t("dashboard.overviewRegionLabel")}>
        <article className="winbids-hero-panel">
          <p className="winbids-kicker">American Public Supply Intelligence LLC</p>
          <h1 className="winbids-title">{t("dashboard.title")}</h1>
          <p className="winbids-lead mt-4">{t("dashboard.description")}</p>
          <div className="relative group mt-6 flex flex-col gap-2 sm:block">
            <Search className="absolute left-4 top-7 -translate-y-1/2 text-blue-700 transition-colors sm:top-1/2" size={20} />
            <Input
              placeholder={t("dashboard.searchPlaceholder")}
              className="h-14 rounded-lg border-slate-200 pl-12 pr-4 text-base shadow-sm focus-visible:ring-1 focus-visible:ring-blue-700 sm:pr-32"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Button className="winbids-primary-action h-10 border-0 px-6 hover:bg-blue-800 sm:absolute sm:right-2 sm:top-1/2 sm:-translate-y-1/2">
              {t("dashboard.searchButton")}
            </Button>
          </div>
        </article>

        <div className="grid gap-3 sm:grid-cols-2" aria-label={t("dashboard.discoveryMetricsLabel")}>
          {[
            { label: t("dashboard.highFitBids"), value: String(total), icon: Gauge },
            { label: t("dashboard.activePursuits"), value: t("dashboard.activePursuitsModeIntent"), icon: ClipboardCheck },
            { label: t("dashboard.submissionRisks"), value: t("dashboard.submissionRisksModeLite"), icon: CircleAlert },
            { label: t("dashboard.readyArtifacts"), value: t("dashboard.readyArtifactsModeApi"), icon: FileCheck2 },
          ].map((metric) => {
            const Icon = metric.icon;
            return (
              <article key={metric.label} className="winbids-metric-card">
                <Icon size={18} className="text-blue-700" aria-hidden="true" />
                <strong className="mt-4 block text-3xl font-black text-slate-950">{metric.value}</strong>
                <span className="mt-1 block text-xs font-black uppercase text-slate-500">{metric.label}</span>
              </article>
            );
          })}
        </div>
      </section>

      <section className="winbids-content-grid">
      <aside className="winbids-filter-panel flex flex-col gap-6 overflow-visible lg:overflow-y-auto pb-2">
        <div>
          <p className="winbids-kicker mb-2">{t("dashboard.discoveryControls")}</p>
          <h3 className="font-black text-sm text-slate-950 flex items-center gap-2 mb-3">
            <Filter size={16} />
            {t("dashboard.filters")}
          </h3>
          <Button
            variant="outline"
            className="w-full justify-start text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900 h-9 font-medium"
            onClick={clearFilters}
          >
            {t("dashboard.clearFilters")}
          </Button>
        </div>

        <Separator className="bg-slate-200" />

        <div>
          <h4 className="font-medium text-sm text-slate-900 mb-3">{t("dashboard.stateRegion")}</h4>
          <div className="space-y-2">
            {STATE_FILTERS.map((state) => (
              <div key={state.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`state-${state.id}`}
                  checked={selectedStates.includes(state.id)}
                  onCheckedChange={() => toggleStateFilter(state.id)}
                  className="border-slate-300 data-[state=checked]:bg-slate-900 data-[state=checked]:border-slate-900"
                />
                <Label htmlFor={`state-${state.id}`} className="text-sm font-normal text-slate-600 cursor-pointer">
                  {state.label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <Separator className="bg-slate-200" />

        <div>
          <h4 className="font-medium text-sm text-slate-900 mb-3">{t("dashboard.issuerType")}</h4>
          <Select value={issuerType} onValueChange={(value) => setIssuerType(value as "all" | IssuerType)}>
            <SelectTrigger className="h-10 bg-white border-slate-200 rounded-lg shadow-sm focus:ring-slate-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-lg border-slate-200 shadow-lg">
              <SelectItem value="all">{t("dashboard.allIssuerTypes")}</SelectItem>
              <SelectItem value="federal">{t("dashboard.federal")}</SelectItem>
              <SelectItem value="state">{t("dashboard.state")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator className="bg-slate-200" />

        <div>
          <h4 className="font-medium text-sm text-slate-900 mb-3">{t("dashboard.deadline")}</h4>
          <div className="space-y-2">
            {DEADLINE_PRESETS.map((option) => (
              <div key={option.value} className="flex items-center space-x-2">
                <input
                  type="radio"
                  id={`deadline-${option.value}`}
                  name="deadline"
                  checked={deadlinePreset === option.value}
                  onChange={() => setDeadlinePreset(option.value)}
                  className="w-4 h-4 text-slate-900 border-slate-300 focus:ring-slate-900 accent-slate-900"
                />
                <Label htmlFor={`deadline-${option.value}`} className="text-sm font-normal text-slate-600 cursor-pointer">
                  {t(option.labelKey)}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <Separator className="bg-slate-200" />

        <div>
          <h4 className="font-medium text-sm text-slate-900 mb-3">{t("dashboard.publishedDate")}</h4>
          <div className="space-y-2">
            {PUBLISHED_PRESETS.map((option) => (
              <div key={option.value} className="flex items-center space-x-2">
                <input
                  type="radio"
                  id={`published-${option.value}`}
                  name="published"
                  checked={publishedPreset === option.value}
                  onChange={() => setPublishedPreset(option.value)}
                  className="w-4 h-4 text-slate-900 border-slate-300 focus:ring-slate-900 accent-slate-900"
                />
                <Label htmlFor={`published-${option.value}`} className="text-sm font-normal text-slate-600 cursor-pointer">
                  {t(option.labelKey)}
                </Label>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <main className="winbids-main-column flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="winbids-kicker">{t("dashboard.discoveryFirstQueue")}</p>
            <h2 className="winbids-section-title mt-1">{t("dashboard.newHighFitBids")}</h2>
            <div className="mt-2 text-sm text-slate-600 font-medium">
              {t("dashboard.resultsCount").replace("{count}", String(total))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-500">{t("dashboard.sortBy")}</span>
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
              <SelectTrigger className="w-[160px] h-10 bg-white border-slate-200 rounded-lg shadow-sm focus:ring-slate-900">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                <SelectItem value="relevance">{t("dashboard.relevance")}</SelectItem>
                <SelectItem value="newest">{t("dashboard.newest")}</SelectItem>
                <SelectItem value="deadline">{t("dashboard.soonestDeadline")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <section
          aria-live="polite"
          className={`rounded-lg border p-4 shadow-sm ${
            hasError ? "border-rose-200 bg-rose-50/70" : isLoading ? "border-blue-100 bg-blue-50/60" : "border-slate-200 bg-white"
          }`}
          role={hasError ? "alert" : "status"}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-blue-700" /> : null}
                <p className="text-xs font-black uppercase text-slate-500">{t("dashboard.searchStatus")}</p>
              </div>
              <h3 className="mt-1 text-base font-semibold text-slate-950">{resultStatusTitle}</h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">{resultStatusDescription}</p>
            </div>
            <div className="flex min-w-0 flex-wrap gap-2 lg:max-w-[52%] lg:justify-end">
              <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                {filterStatusLabel}
              </span>
              {activeFilterLabels.length > 0 ? (
                activeFilterLabels.map((label) => (
                  <span
                    className="max-w-full rounded-md border border-blue-100 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 break-words"
                    key={label}
                  >
                    {label}
                  </span>
                ))
              ) : (
                <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500">
                  {t("dashboard.publicDiscoveryQueue")}
                </span>
              )}
            </div>
          </div>
        </section>

        {authPromptVisible && (
          <UniversalState
            actions={[
              { href: "/login", label: t("common.login") },
              { href: "/register", label: t("common.register"), variant: "secondary" },
              { label: t("common.dismiss"), onClick: () => setAuthPromptVisible(false), variant: "secondary" },
            ]}
            className="border-blue-100 bg-blue-50/60"
            code="permission_denied"
            message={t("dashboard.saveBidAuthDescription")}
            severity="info"
            title={t("dashboard.signInToSaveBid")}
          />
        )}

        <div className="flex flex-col gap-4 pb-8">
          {isLoading &&
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-3 flex-1">
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                    <Skeleton className="h-8 w-24 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <div className="flex gap-2">
                    <Skeleton className="h-7 w-20 rounded-full" />
                    <Skeleton className="h-7 w-24 rounded-full" />
                    <Skeleton className="h-7 w-16 rounded-full" />
                  </div>
                </div>
              </div>
            ))}

          {!isLoading && hasError && (
            <UniversalState
              actions={[
                { label: t("dashboard.retry"), onClick: retryFetch },
                { label: t("dashboard.clearFilters"), onClick: clearFilters, variant: "secondary" },
              ]}
              className="bg-white py-8"
              code="error"
              message={t("dashboard.errorDescription")}
              title={t("dashboard.errorTitle")}
            />
          )}

          {!isLoading && !hasError && bids.map((bid) => (
            <BidCard key={bid.id} bid={bid} onAuthPrompt={() => setAuthPromptVisible(true)} />
          ))}

          {!isLoading && !hasError && bids.length === 0 && (
            <UniversalState
              actions={[{ label: t("dashboard.clearFilters"), onClick: clearFilters, variant: "secondary" }]}
              className="bg-white py-8"
              code="empty"
              message={t("dashboard.noResultsDescription")}
              title={t("dashboard.noResultsTitle")}
            />
          )}
        </div>
      </main>
      </section>
    </div>
  );
}
