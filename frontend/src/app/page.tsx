"use client";

import { useMemo, useState } from "react";
import { Search, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { BidCard } from "@/components/bids/BidCard";
import { MOCK_BIDS, STATE_FILTERS, type DatePreset, type IssuerType, type SortOption } from "@/lib/mock-data";
import { useLanguage } from "@/lib/i18n/LanguageContext";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysFromToday(dateString: string) {
  const today = startOfDay(new Date());
  const target = startOfDay(new Date(dateString));
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}

function daysAgo(dateString: string) {
  const today = startOfDay(new Date());
  const target = startOfDay(new Date(dateString));
  return Math.round((today.getTime() - target.getTime()) / MS_PER_DAY);
}

function matchesDeadlinePreset(dateString: string, preset: DatePreset) {
  if (preset === "any") return true;
  const days = daysFromToday(dateString);
  if (preset === "next7") return days >= 0 && days <= 7;
  if (preset === "next30") return days >= 0 && days <= 30;
  return true;
}

function matchesPublishedPreset(dateString: string, preset: DatePreset) {
  if (preset === "any") return true;
  const days = daysAgo(dateString);
  if (preset === "last24") return days >= 0 && days <= 1;
  if (preset === "last7") return days >= 0 && days <= 7;
  return true;
}

const DEADLINE_PRESETS: Array<{ value: DatePreset; labelKey: string }> = [
  { value: "any", labelKey: "dashboard.anyTime" },
  { value: "next7", labelKey: "dashboard.next7Days" },
  { value: "next30", labelKey: "dashboard.next30Days" },
];

const PUBLISHED_PRESETS: Array<{ value: DatePreset; labelKey: string }> = [
  { value: "any", labelKey: "dashboard.anyTime" },
  { value: "last24", labelKey: "dashboard.last24Hours" },
  { value: "last7", labelKey: "dashboard.last7Days" },
];

export default function Dashboard() {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [issuerType, setIssuerType] = useState<"all" | IssuerType>("all");
  const [deadlinePreset, setDeadlinePreset] = useState<DatePreset>("any");
  const [publishedPreset, setPublishedPreset] = useState<DatePreset>("any");
  const [sortBy, setSortBy] = useState<SortOption>("relevance");

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

  const filteredBids = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const selectedFilters = STATE_FILTERS.filter((state) => selectedStates.includes(state.id));

    return MOCK_BIDS.filter((bid) => {
      const searchableText = [
        bid.title,
        bid.description,
        bid.issuerName,
        bid.originalCategory,
        ...bid.tags,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = normalizedQuery === "" || searchableText.includes(normalizedQuery);
      const matchesState =
        selectedFilters.length === 0 ||
        selectedFilters.some(
          (filter) =>
            filter.stateCode === bid.stateCode ||
            filter.label === bid.source ||
            bid.source.includes(filter.stateCode) ||
            bid.source.includes(filter.label.split(" ")[0])
        );
      const matchesIssuerType = issuerType === "all" || bid.issuerType === issuerType;
      const matchesDeadline = matchesDeadlinePreset(bid.deadlineDate, deadlinePreset);
      const matchesPublished = matchesPublishedPreset(bid.publishedDate, publishedPreset);

      return matchesSearch && matchesState && matchesIssuerType && matchesDeadline && matchesPublished;
    }).sort((a, b) => {
      if (sortBy === "deadline") {
        return new Date(a.deadlineDate).getTime() - new Date(b.deadlineDate).getTime();
      }
      if (sortBy === "newest") {
        return new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime();
      }
      return 0;
    });
  }, [deadlinePreset, issuerType, publishedPreset, searchQuery, selectedStates, sortBy]);

  return (
    <div className="flex flex-col lg:flex-row h-full gap-6">
      <aside className="w-full lg:w-64 shrink-0 flex flex-col gap-6 overflow-visible lg:overflow-y-auto pr-0 lg:pr-2 pb-4 lg:pb-8">
        <div>
          <h3 className="font-semibold text-sm text-slate-900 flex items-center gap-2 mb-3">
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

      <main className="flex-1 flex flex-col gap-5 min-w-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">{t("dashboard.title")}</h1>
          <p className="mt-1 text-sm text-slate-600">{t("dashboard.description")}</p>
        </div>

        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-900 transition-colors" size={20} />
          <Input
            placeholder={t("dashboard.searchPlaceholder")}
            className="pl-12 pr-32 h-14 text-base shadow-sm border-slate-200 focus-visible:ring-1 focus-visible:ring-slate-900 rounded-xl"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Button className="absolute right-2 top-1/2 -translate-y-1/2 h-10 px-6 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm transition-all">
            {t("dashboard.searchButton")}
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="text-sm text-slate-600 font-medium">
            {t("dashboard.resultsCount").replace("{count}", String(filteredBids.length))}
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
          {filteredBids.map((bid) => (
            <BidCard key={bid.id} bid={bid} />
          ))}

          {filteredBids.length === 0 && (
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
    </div>
  );
}
