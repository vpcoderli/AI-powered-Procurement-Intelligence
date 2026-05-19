"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Search, BellRing, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createSearchAlert,
  deleteSearchAlert,
  listSearchAlerts,
  updateSearchAlert,
} from "@/lib/api/search-alerts";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { SearchAlert } from "@/server/search-alerts/types";

export default function SearchAlertsPage() {
  const { t } = useLanguage();
  const [alerts, setAlerts] = useState<SearchAlert[]>([]);
  const [quickSearch, setQuickSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(false);
  const [pendingAlertIds, setPendingAlertIds] = useState<Set<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      setIsLoading(true);
      setError(false);

      listSearchAlerts()
        .then((response) => {
          if (cancelled) return;
          setAlerts(response.alerts);
        })
        .catch(() => {
          if (cancelled) return;
          setAlerts([]);
          setError(true);
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
  }, []);

  const updatePending = (id: string, isPending: boolean) => {
    setPendingAlertIds((current) => {
      const next = new Set(current);
      if (isPending) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleCreateAlert = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    const query = quickSearch.trim();
    if (!query || isCreating) return;

    setIsCreating(true);
    setError(false);

    try {
      const response = await createSearchAlert({
        name: query,
        query: {
          q: query,
          states: [],
          issuerType: "all",
          deadline: "any",
          published: "any",
          sort: "relevance",
        },
        frequency: "daily",
        isEnabled: true,
      });

      setAlerts((current) => [response.alert, ...current]);
      setQuickSearch("");
    } catch {
      setError(true);
    } finally {
      setIsCreating(false);
    }
  };

  const toggleAlert = async (alert: SearchAlert) => {
    const nextEnabled = !alert.isEnabled;
    updatePending(alert.id, true);
    setError(false);
    setAlerts((current) =>
      current.map((item) => (item.id === alert.id ? { ...item, isEnabled: nextEnabled } : item)),
    );

    try {
      const response = await updateSearchAlert(alert.id, { isEnabled: nextEnabled });
      setAlerts((current) =>
        current.map((item) => (item.id === alert.id ? response.alert : item)),
      );
    } catch {
      setAlerts((current) =>
        current.map((item) => (item.id === alert.id ? { ...item, isEnabled: alert.isEnabled } : item)),
      );
      setError(true);
    } finally {
      updatePending(alert.id, false);
    }
  };

  const removeAlert = async (alert: SearchAlert) => {
    const previousAlerts = alerts;
    updatePending(alert.id, true);
    setError(false);
    setAlerts((current) => current.filter((item) => item.id !== alert.id));

    try {
      await deleteSearchAlert(alert.id);
    } catch {
      setAlerts(previousAlerts);
      setError(true);
    } finally {
      updatePending(alert.id, false);
    }
  };

  const focusQuickSearch = () => {
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full gap-8 max-w-5xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 text-slate-700 rounded-lg border border-slate-200 shadow-sm">
            <Search size={22} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-normal">
              {t("searchAlerts.title")}
            </h1>
            <p className="text-sm text-slate-500 font-medium mt-0.5">
              {t("searchAlerts.description")}
            </p>
          </div>
        </div>
        <Button
          className="shrink-0 bg-slate-900 hover:bg-slate-800 text-white shadow-sm rounded-lg h-10 px-5"
          onClick={focusQuickSearch}
        >
          <Plus className="mr-2 h-4 w-4" /> {t("searchAlerts.createNew")}
        </Button>
      </div>

      <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
        <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
          <CardTitle className="text-lg font-semibold text-slate-900">
            {t("searchAlerts.quickSearch")}
          </CardTitle>
          <CardDescription className="text-slate-500 font-medium">
            {t("searchAlerts.quickSearchDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <form className="flex flex-col md:flex-row gap-4" onSubmit={handleCreateAlert}>
            <div className="flex-1">
              <div className="relative group">
                <Search
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-900 transition-colors"
                  size={18}
                />
                <Input
                  ref={inputRef}
                  placeholder={t("searchAlerts.quickSearchPlaceholder")}
                  className="pl-11 h-11 border-slate-200 focus-visible:ring-1 focus-visible:ring-slate-900 rounded-lg text-slate-900"
                  value={quickSearch}
                  onChange={(event) => setQuickSearch(event.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-3 shrink-0">
              <Button
                type="submit"
                disabled={!quickSearch.trim() || isCreating}
                className="h-11 px-8 bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm rounded-lg"
              >
                {isCreating ? t("searchAlerts.creating") : t("searchAlerts.createAlert")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 mt-2">
        <div className="flex items-center justify-between gap-4 mb-2">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <BellRing size={18} className="text-slate-400" />
            {t("searchAlerts.subscriptions")}
          </h2>
        </div>

        {error && (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
            <span className="font-semibold text-slate-900">{t("searchAlerts.errorTitle")}</span>
            <span className="ml-2">{t("searchAlerts.errorDescription")}</span>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4">
                  <Skeleton className="h-5 w-2/5" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-9 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : alerts.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {alerts.map((alert) => {
              const isPending = pendingAlertIds.has(alert.id);
              const keywords = alert.query.q?.trim() || t("searchAlerts.anyKeywords");
              const regions = alert.query.states?.length
                ? alert.query.states.join(", ")
                : t("searchAlerts.allRegions");

              return (
                <Card
                  key={alert.id}
                  className={`border-slate-200 rounded-xl overflow-hidden transition-all duration-200 hover:shadow-md hover:border-slate-300 ${
                    !alert.isEnabled ? "bg-slate-50/50 opacity-80" : "bg-white shadow-sm"
                  }`}
                >
                  <CardContent className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex-1 flex flex-col gap-2.5 min-w-0">
                      <div className="flex items-center gap-3">
                        <h3
                          className={`font-semibold text-lg tracking-normal truncate ${
                            alert.isEnabled ? "text-slate-900" : "text-slate-500"
                          }`}
                        >
                          {alert.name}
                        </h3>
                        {!alert.isEnabled && (
                          <Badge
                            variant="outline"
                            className="text-xs font-medium border-slate-200 text-slate-500 bg-slate-100 rounded-md px-2 py-0.5"
                          >
                            {t("searchAlerts.paused")}
                          </Badge>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-400 uppercase text-[11px]">
                            {t("searchAlerts.keywordsLabel")}
                          </span>
                          <span className="font-medium text-slate-700">{keywords}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-400 uppercase text-[11px]">
                            {t("searchAlerts.regionsLabel")}
                          </span>
                          <span className="font-medium text-slate-700">{regions}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-400 uppercase text-[11px]">
                            {t("searchAlerts.frequencyLabel")}
                          </span>
                          <span className="font-medium text-slate-700">
                            {alert.frequency === "weekly"
                              ? t("searchAlerts.weekly")
                              : t("searchAlerts.daily")}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 md:border-l border-slate-100 md:pl-8 shrink-0">
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="flex items-center space-x-3">
                          <Switch
                            id={`alert-${alert.id}`}
                            checked={alert.isEnabled}
                            disabled={isPending}
                            onCheckedChange={() => toggleAlert(alert)}
                            className="data-[state=checked]:bg-slate-900"
                          />
                          <Label
                            htmlFor={`alert-${alert.id}`}
                            className="text-sm font-medium cursor-pointer w-12 text-slate-700"
                          >
                            {alert.isEnabled ? t("searchAlerts.active") : t("searchAlerts.off")}
                          </Label>
                        </div>
                        <span className="text-[11px] font-medium text-slate-400 uppercase">
                          {alert.lastMatchedAt
                            ? t("searchAlerts.lastMatch").replace("{date}", alert.lastMatchedAt)
                            : t("searchAlerts.noMatches")}
                        </span>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={isPending}
                        onClick={() => removeAlert(alert)}
                        className="h-9 w-9 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        aria-label={t("searchAlerts.deleteAlert")}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="text-center p-12 border border-dashed border-slate-300 rounded-xl bg-slate-50/50 flex flex-col items-center gap-4">
            <div className="p-4 bg-white rounded-full border border-slate-100 shadow-sm">
              <BellRing size={24} className="text-slate-300" />
            </div>
            <div>
              <p className="text-slate-900 font-semibold mb-1">{t("searchAlerts.emptyTitle")}</p>
              <p className="text-sm text-slate-500 font-medium">
                {t("searchAlerts.emptyDescription")}
              </p>
            </div>
            <Button
              variant="outline"
              className="mt-2 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium rounded-lg"
              onClick={focusQuickSearch}
            >
              <Plus className="mr-2 h-4 w-4" /> {t("searchAlerts.createAlert")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
