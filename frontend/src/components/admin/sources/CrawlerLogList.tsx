"use client";

import { useCallback, useState } from "react";
import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listAdminCrawlerLogs, type AdminCrawlerLog } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { fallbackMessage, formatDate, statusTone, textPreview } from "../admin-format";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";
import { appendCrawlerLogPage, visibleCrawlerLogs, type CrawlerLogMore, type CrawlerLogPage } from "./crawler-log-pages";

const PAGE_SIZE = 25;

/** How much of a crawler error a row shows before the rest goes behind "Show full error". */
export const CRAWLER_LOG_ERROR_PREVIEW_CHARS = 300;

const ERROR_LINE_CLASS = "mt-1 text-sm break-words text-rose-700 [overflow-wrap:anywhere]";

/**
 * A run's error. A short one is shown whole. A long one (a failed portal fetch can carry the whole HTML page it got,
 * tens of thousands of characters) shows its opening, with the full text behind a native expander whose box has its
 * own scroll, so even opened it cannot stretch the list.
 */
function CrawlerLogError({ message }: { message: string }) {
  const { t } = useLanguage();
  const preview = textPreview(message, CRAWLER_LOG_ERROR_PREVIEW_CHARS);
  if (preview === null) return <div className={ERROR_LINE_CLASS}>{message}</div>;

  return (
    <div className={ERROR_LINE_CLASS}>
      {preview}
      <details className="mt-1">
        <summary className="cursor-pointer text-xs font-medium">{t("admin.crawlerLogShowFullError")}</summary>
        <div className="mt-1 max-h-64 overflow-y-auto rounded border border-rose-100 bg-rose-50/40 p-2 text-xs whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {message}
        </div>
      </details>
    </div>
  );
}

/**
 * One crawler run. Its text column may shrink below its content (min-w-0) and its messages wrap anywhere: a crawler
 * error carries the whole portal URL, which would otherwise widen a phone-sized page.
 */
export function CrawlerLogRow({ log }: { log: AdminCrawlerLog }) {
  const { t } = useLanguage();

  return (
    <div className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-all text-slate-900">{log.source}</span>
          <Badge variant="outline" className={statusTone(log.status)}>
            {log.status}
          </Badge>
          <span className="text-xs text-slate-500">{formatDate(log.finishedAt ?? log.startedAt)}</span>
        </div>
        {log.errorMessage && <CrawlerLogError message={log.errorMessage} />}
        {log.fallbackSource && (
          <div className="mt-1 text-sm break-words text-amber-700 [overflow-wrap:anywhere]">
            <span className="font-medium">{t("admin.fallbackUsed")}</span>
            {fallbackMessage(log) ? `: ${fallbackMessage(log)}` : null}
          </div>
        )}
      </div>
      <div className="text-sm text-slate-500">
        {log.fetchedCount}/{log.insertedCount}/{log.updatedCount}/{log.failedCount}
      </div>
    </div>
  );
}

/** Crawler runs, newest first, with "load more" on the API cursor (spec §6.1). */
export function CrawlerLogList({ sources, title }: { sources?: readonly string[]; title: string }) {
  const { t } = useLanguage();
  const sourceKey = sources?.join("\u0000") ?? "";
  // The page carries the source set it was read for: the resource keeps the previous set's page while a new one loads.
  const loadFirstPage = useCallback(
    async (): Promise<CrawlerLogPage> => ({
      ...(await listAdminCrawlerLogs({ sources: sourceKey ? sourceKey.split("\u0000") : undefined, limit: PAGE_SIZE })),
      // After the response, so nothing in it can overwrite the tag.
      key: sourceKey,
    }),
    [sourceKey],
  );
  const firstPage = useAdminResource(loadFirstPage);
  // Pages appended with "load more"; they count only while they continue from the first page shown.
  const [more, setMore] = useState<CrawlerLogMore | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  const { first, logs, cursor } = visibleCrawlerLogs(sourceKey, firstPage.data, more);

  const loadMore = async () => {
    if (!first || !cursor) return;
    setIsLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const page = await listAdminCrawlerLogs({
        sources: sourceKey ? sourceKey.split("\u0000") : undefined,
        limit: PAGE_SIZE,
        before: cursor.before,
        beforeId: cursor.beforeId,
      });
      setMore((current) => appendCrawlerLogPage(first, current, page));
    } catch {
      setLoadMoreFailed(true);
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (!first && firstPage.status === "error") {
    return (
      <AdminSectionStateCard
        action={() => void firstPage.reload()}
        actionLabel={t("admin.refresh")}
        code="error"
        message={t("admin.errorDescription")}
        title={title}
      />
    );
  }
  if (!first) {
    return <AdminSectionStateCard actionLabel={t("admin.refresh")} code="loading" message={t("admin.loading")} title={title} />;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 font-semibold text-slate-950">
        <Activity size={18} />
        {title}
      </div>
      {loadMoreFailed && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}
      {logs.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">{t("admin.noLogs")}</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {logs.map((log) => (
            <CrawlerLogRow key={log.id} log={log} />
          ))}
        </div>
      )}
      {cursor && (
        <div className="border-t border-slate-100 px-4 py-3">
          <Button type="button" variant="outline" size="sm" disabled={isLoadingMore || firstPage.status === "loading"} onClick={() => void loadMore()}>
            {t("admin.loadMore")}
          </Button>
        </div>
      )}
    </section>
  );
}
