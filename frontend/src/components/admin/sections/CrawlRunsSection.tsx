"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JurisdictionBatchRunPanel } from "@/components/admin/JurisdictionBatchRunPanel";
import { listAdminDataSourceIndex, runStateCrawlersNow } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { useAdminSession } from "../admin-session";
import { ADMIN_PANEL_CARD, AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";
import { CrawlerLogList } from "../sources/CrawlerLogList";
import { crawlerRunIdFor } from "../sources/crawler-run-id";

const loadIndex = () => listAdminDataSourceIndex().then((response) => response.items);

export function CrawlRunsSection() {
  const { t } = useLanguage();
  const { canRunOperations } = useAdminSession();
  const index = useAdminResource(loadIndex);
  const [isRunning, setIsRunning] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: "info" | "error" } | null>(null);
  const [logsRevision, setLogsRevision] = useState(0);
  // The log list is keyed by this: a new key reads its first page again (the batch panel keeps its own report).
  const refreshLogs = () => setLogsRevision((revision) => revision + 1);

  // "Run state crawlers": every crawlable non-federal source.
  const runAll = async () => {
    setIsRunning(true);
    setNotice(null);
    try {
      await runStateCrawlersNow();
      setNotice({ message: t("admin.runQueued"), tone: "info" });
      refreshLogs();
    } catch {
      setNotice({ message: t("admin.runFailed"), tone: "error" });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {canRunOperations && (
        <div className="flex justify-end">
          <Button onClick={() => void runAll()} disabled={isRunning} className="h-10 rounded-lg bg-slate-900 text-white hover:bg-slate-800">
            <Play size={16} />
            {isRunning ? t("admin.running") : t("admin.runStateCrawlers")}
          </Button>
        </div>
      )}
      <AdminNotice message={notice?.message ?? null} tone={notice?.tone} />
      {index.data ? (
        <section className={ADMIN_PANEL_CARD}>
          <JurisdictionBatchRunPanel sources={index.data} crawlerSourceIdFor={crawlerRunIdFor} disabled={isRunning} onCompleted={refreshLogs} />
        </section>
      ) : (
        <AdminSectionStateCard
          action={index.status === "error" ? () => void index.reload() : undefined}
          actionLabel={t("admin.refresh")}
          code={index.status === "error" ? "error" : "loading"}
          message={index.status === "error" ? t("admin.errorDescription") : t("admin.loading")}
          title={t("admin.batchRunTitle")}
        />
      )}
      <CrawlerLogList key={logsRevision} title={t("admin.recentLogs")} />
    </div>
  );
}
