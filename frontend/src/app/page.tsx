"use client";

import { useEffect, useState } from "react";
import { Search, Filter, Gauge, ClipboardCheck, CircleAlert, FileCheck2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
      <section className="winbids-hero-grid" aria-label="WinBids overview">
        <article className="winbids-hero-panel">
          <p className="winbids-kicker">American Public Supply Intelligence LLC</p>
          <h1 className="winbids-title">{t("dashboard.title")}</h1>
          <p className="winbids-lead mt-4">{t("dashboard.description")}</p>
          <div className="relative group mt-6">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-700 transition-colors" size={20} />
            <Input
              placeholder={t("dashboard.searchPlaceholder")}
              className="pl-12 pr-32 h-14 text-base shadow-sm border-slate-200 focus-visible:ring-1 focus-visible:ring-blue-700 rounded-lg"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Button className="winbids-primary-action absolute right-2 top-1/2 -translate-y-1/2 h-10 border-0 px-6 hover:bg-blue-800">
              {t("dashboard.searchButton")}
            </Button>
          </div>
        </article>

        <div className="grid gap-3 sm:grid-cols-2" aria-label="Discovery metrics">
          {[
            { label: "High-fit bids", value: String(total), icon: Gauge },
            { label: "Active pursuits", value: "Intent", icon: ClipboardCheck },
            { label: "Submission risks", value: "Lite", icon: CircleAlert },
            { label: "Ready artifacts", value: "API", icon: FileCheck2 },
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
          <p className="winbids-kicker mb-2">Discovery controls</p>
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
            <p className="winbids-kicker">Discovery-first queue</p>
            <h2 className="winbids-section-title mt-1">New high-fit bids</h2>
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
            <div className="text-center py-16 border border-dashed border-slate-300 bg-white rounded-xl">
              <p className="text-slate-900 font-semibold mb-2">{t("dashboard.errorTitle")}</p>
              <p className="text-sm text-slate-500 mb-4">{t("dashboard.errorDescription")}</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
                <Button onClick={retryFetch} className="bg-slate-900 hover:bg-slate-800 text-white font-semibold">
                  {t("dashboard.retry")}
                </Button>
                <Button variant="link" onClick={clearFilters} className="text-slate-900 font-semibold hover:text-slate-700">
                  {t("dashboard.clearFilters")}
                </Button>
              </div>
            </div>
          )}

          {!isLoading && !hasError && bids.map((bid) => (
            <BidCard key={bid.id} bid={bid} />
          ))}

          {!isLoading && !hasError && bids.length === 0 && (
            <div className="text-center py-16 border border-dashed border-slate-300 bg-white rounded-xl">
              <p className="text-slate-900 font-semibold mb-2">{t("dashboard.noResultsTitle")}</p>
              <p className="text-sm text-slate-500 mb-4">{t("dashboard.noResultsDescription")}</p>
              <Button variant="link" onClick={clearFilters} className="text-slate-900 font-semibold hover:text-slate-700">
                {t("dashboard.clearFilters")}
              </Button>
            </div>
          )}
        </div>
      </main>
      </section>
    </div>
  );
}
