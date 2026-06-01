"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, ExternalLink, FileText, LockKeyhole, RefreshCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { fetchKnowledgeItems } from "@/lib/api/knowledge";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { KNOWLEDGE_ITEM_TYPES, type KnowledgeItem, type KnowledgeItemType } from "@/server/knowledge/types";

const allTypes = "all";

type TypeFilter = typeof allTypes | KnowledgeItemType;

function safeKnowledgeSourceUrl(value: string) {
  if (value.startsWith("/")) return value;

  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:" ? value : "";
  } catch {
    return "";
  }
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function sourceLinks(item: KnowledgeItem) {
  const links: Array<{ href: string; labelKey: string; external?: boolean }> = [];

  if (item.sourceIntentId) {
    links.push({
      href: `/intents/${item.sourceIntentId}`,
      labelKey: "knowledge.sourceIntent",
    });
  }

  if (item.sourceBidId) {
    links.push({
      href: `/bids/${encodeURIComponent(item.sourceBidId)}`,
      labelKey: "knowledge.sourceBid",
    });
  }

  if (item.sourceUrl) {
    const sourceUrl = safeKnowledgeSourceUrl(item.sourceUrl);

    if (sourceUrl) {
      links.push({
        href: sourceUrl,
        labelKey: "knowledge.sourceUrl",
        external: !sourceUrl.startsWith("/"),
      });
    }
  }

  return links;
}

export default function KnowledgeLibraryPage() {
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(allTypes);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const hasKnowledgeAccess = user?.features.includes("knowledge_station") ?? false;
  const q = search.trim();
  const type = typeFilter === allTypes ? undefined : typeFilter;

  const typeOptions = useMemo(() => [...KNOWLEDGE_ITEM_TYPES], []);

  useEffect(() => {
    let cancelled = false;

    if (!hasKnowledgeAccess) {
      queueMicrotask(() => {
        if (cancelled) return;
        setItems([]);
        setIsLoading(false);
        setError(null);
      });

      return () => {
        cancelled = true;
      };
    }

    queueMicrotask(() => {
      if (cancelled) return;

      setIsLoading(true);
      setError(null);

      fetchKnowledgeItems({ q, type, limit: 50 })
        .then((response) => {
          if (cancelled) return;
          setItems(response.items);
        })
        .catch((err) => {
          if (cancelled) return;
          setItems([]);
          setError(err instanceof Error ? err : new Error("Failed to load knowledge items"));
        })
        .finally(() => {
          if (cancelled) return;
          setIsLoading(false);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [hasKnowledgeAccess, q, retryTick, type]);

  if (!hasKnowledgeAccess) {
    return (
      <div className="winbids-workspace">
        <section className="winbids-hero-panel rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="winbids-kicker">{t("knowledge.title")}</p>
              <h1 className="mt-2 text-3xl font-black tracking-normal text-slate-950">{t("knowledge.lockedTitle")}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{t("knowledge.libraryLockedBody")}</p>
            </div>
            <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
              <LockKeyhole aria-hidden="true" />
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="winbids-workspace">
      <section className="winbids-hero-panel rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="winbids-kicker">{t("knowledge.title")}</p>
            <h1 className="mt-2 text-3xl font-black tracking-normal text-slate-950 md:text-5xl">
              {t("knowledge.library")}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{t("knowledge.libraryDescription")}</p>
          </div>
          <Badge variant="outline" className="h-8 rounded-md border-blue-100 bg-blue-50 px-3 text-blue-700">
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            {items.length} {t("knowledge.items")}
          </Badge>
        </div>
      </section>

      <section className="winbids-panel rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <label className="block">
            <span className="mb-2 block text-xs font-black uppercase text-slate-500">{t("knowledge.search")}</span>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("knowledge.searchPlaceholder")}
                className="h-10 rounded-lg border-slate-200 bg-white pl-9 shadow-sm focus-visible:ring-slate-900"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-black uppercase text-slate-500">{t("knowledge.type")}</span>
            <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as TypeFilter)}>
              <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                <SelectItem value={allTypes}>{t("knowledge.allTypes")}</SelectItem>
                {typeOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`knowledge.types.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      </section>

      {isLoading ? (
        <section className="winbids-panel grid gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          {[0, 1, 2].map((item) => (
            <div key={item} className="rounded-lg border border-slate-200 p-4">
              <Skeleton className="h-5 w-1/3 rounded-md" />
              <Skeleton className="mt-3 h-4 w-full rounded-md" />
              <Skeleton className="mt-2 h-4 w-2/3 rounded-md" />
            </div>
          ))}
        </section>
      ) : error ? (
        <section className="winbids-panel rounded-lg border border-rose-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-black text-rose-700">{t("knowledge.loadFailed")}</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">{error.message}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-4 rounded-lg border-slate-200 text-slate-700 hover:bg-slate-50"
            onClick={() => setRetryTick((tick) => tick + 1)}
          >
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            {t("knowledge.retry")}
          </Button>
        </section>
      ) : items.length === 0 ? (
        <section className="winbids-panel flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-4 py-20 text-center shadow-sm">
          <FileText className="h-8 w-8 text-slate-400" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-black text-slate-950">{t("knowledge.empty")}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{t("knowledge.emptyLibraryBody")}</p>
        </section>
      ) : (
        <section className="grid gap-4">
          {items.map((item) => (
            <article key={item.id} className="winbids-panel rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-md border-slate-200 bg-slate-50 text-slate-600">
                      {t(`knowledge.types.${item.type}`)}
                    </Badge>
                    <span className="text-xs font-semibold text-slate-500">{formatDate(item.updatedAt, language)}</span>
                  </div>
                  <h2 className="mt-3 break-words text-xl font-black text-slate-950">{item.title}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {sourceLinks(item).map((link) =>
                    link.external ? (
                      <a
                        key={`${item.id}-${link.labelKey}`}
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                          className: "rounded-lg border-slate-200 text-slate-700 hover:bg-slate-50",
                        })}
                      >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        {t(link.labelKey)}
                      </a>
                    ) : (
                      <Link
                        key={`${item.id}-${link.labelKey}`}
                        href={link.href}
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                          className: "rounded-lg border-slate-200 text-slate-700 hover:bg-slate-50",
                        })}
                      >
                        {t(link.labelKey)}
                      </Link>
                    ),
                  )}
                </div>
              </div>

              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{item.body}</p>

              {item.tags.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2" aria-label={t("knowledge.tags")}>
                  {item.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="rounded-md border-blue-100 bg-blue-50 text-blue-700">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
