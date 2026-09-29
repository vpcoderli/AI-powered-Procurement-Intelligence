"use client";

import { useCallback, useState } from "react";
import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listAdminCrawlerLogs, type AdminCrawlerLog, type AdminCrawlerLogsCursor } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { fallbackMessage, formatDate, statusTone } from "../admin-format";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";

const PAGE_SIZE = 25;

/** One crawler run (moved from the old page's recent-logs section, which still renders it until that section goes). */
export function CrawlerLogRow({ log }: { log: AdminCrawlerLog }) {
  const { t } = useLanguage();

  return (
    <div className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900">{log.source}</span>
          <Badge variant="outline" className={statusTone(log.status)}>
            {log.status}
          </Badge>
          <span className="text-xs text-slate-500">{formatDate(log.finishedAt ?? log.startedAt)}</span>
        </div>
        {log.errorMessage && <div className="mt-1 text-sm text-rose-700">{log.errorMessage}</div>}
        {log.fallbackSource && (
          <div className="mt-1 text-sm text-amber-700">
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
  const loadFirstPage = useCallback(
    () => listAdminCrawlerLogs({ sources: sourceKey ? sourceKey.split("\u0000") : undefined, limit: PAGE_SIZE }),
    [sourceKey],
  );
  const firstPage = useAdminResource(loadFirstPage);
  // Pages loaded with "load more" belong to one source set; a different set starts over.
  const [loaded, setLoaded] = useState<{ key: string; logs: AdminCrawlerLog[]; cursor: AdminCrawlerLogsCursor | null } | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  const more = loaded?.key === sourceKey ? loaded : null;
  const logs = [...(firstPage.data?.logs ?? []), ...(more?.logs ?? [])];
  const cursor = more ? more.cursor : (firstPage.data?.nextCursor ?? null);

  const loadMore = async () => {
    if (!cursor) return;
    setIsLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const page = await listAdminCrawlerLogs({
        sources: sourceKey ? sourceKey.split("\u0000") : undefined,
        limit: PAGE_SIZE,
        before: cursor.before,
        beforeId: cursor.beforeId,
      });
      setLoaded((current) => ({
        key: sourceKey,
        logs: [...(current?.key === sourceKey ? current.logs : []), ...page.logs],
        cursor: page.nextCursor,
      }));
    } catch {
      setLoadMoreFailed(true);
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (firstPage.status === "error" && !firstPage.data) {
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
  if (!firstPage.data) {
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
          <Button type="button" variant="outline" size="sm" disabled={isLoadingMore} onClick={() => void loadMore()}>
            {t("admin.loadMore")}
          </Button>
        </div>
      )}
    </section>
  );
}
