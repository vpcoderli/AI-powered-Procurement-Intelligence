"use client";

import { useState } from "react";
import { Bell, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deliverAdminNotifications, listAdminNotifications } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { compactErrorMessage, formatDate, statusTone } from "../admin-format";
import { useAdminSession } from "../admin-session";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";

const loadNotifications = () => listAdminNotifications({ limit: 10 }).then((response) => response.notifications);

export function NotificationsSection() {
  const { t } = useLanguage();
  const { canRunOperations } = useAdminSession();
  const outbox = useAdminResource(loadNotifications);
  const [notice, setNotice] = useState<string | null>(null);
  const [isDeliveringNotifications, setIsDeliveringNotifications] = useState(false);

  const deliverNotifications = () => {
    setIsDeliveringNotifications(true);
    setNotice(null);
    deliverAdminNotifications({ limit: 25, maxAttempts: 3 })
      .then(async (result) => {
        setNotice(
          t("admin.notificationDeliveryResult")
            .replace("{sent}", String(result.sent))
            .replace("{failed}", String(result.failed))
            .replace("{skipped}", String(result.skipped)),
        );
        await outbox.reload();
      })
      .catch(() => {
        setNotice(t("admin.notificationDeliveryFailed"));
      })
      .finally(() => {
        setIsDeliveringNotifications(false);
      });
  };

  const notifications = outbox.data ?? [];

  if (outbox.status === "error" && outbox.data === null) {
    return (
      <AdminSectionStateCard
        action={() => void outbox.reload()}
        actionLabel={t("admin.refresh")}
        code="error"
        message={t("admin.errorDescription")}
        title={t("admin.notificationDelivery")}
      />
    );
  }
  if (outbox.status === "loading" && outbox.data === null) {
    return <AdminSectionStateCard actionLabel={t("admin.refresh")} code="loading" message={t("admin.loading")} title={t("admin.notificationDelivery")} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminNotice message={notice} />
      {outbox.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 font-semibold text-slate-950">
            <Bell size={18} />
            {t("admin.notificationDelivery")}
          </div>
          {canRunOperations && (
            <Button
              type="button"
              variant="outline"
              onClick={deliverNotifications}
              disabled={isDeliveringNotifications}
              className="h-9 rounded-lg border-slate-200 px-3"
            >
              <Play size={14} />
              {isDeliveringNotifications ? t("admin.deliveringNotifications") : t("admin.deliverNotifications")}
            </Button>
          )}
        </div>
        <div className="divide-y divide-slate-100">
          {notifications.length === 0 && (
            <div className="px-4 py-5 text-sm text-slate-500">{t("admin.noNotifications")}</div>
          )}
          {notifications.map((notification) => (
            <div key={notification.id} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{notification.recipient}</span>
                  <Badge variant="outline" className={statusTone(notification.status)}>
                    {t(`admin.notificationStatus_${notification.status}`)}
                  </Badge>
                  <span className="text-xs text-slate-500">{formatDate(notification.sentAt ?? notification.createdAt)}</span>
                </div>
                <div className="mt-1 text-sm text-slate-600">{notification.subject}</div>
                {notification.lastError && (
                  <div className="mt-1 text-sm text-rose-700">{compactErrorMessage(notification.lastError)}</div>
                )}
              </div>
              <div className="text-xs font-medium text-slate-500">
                {t("admin.notificationAttempts").replace("{count}", String(notification.attemptCount))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
