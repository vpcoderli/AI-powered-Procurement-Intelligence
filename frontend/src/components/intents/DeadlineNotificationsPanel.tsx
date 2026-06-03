"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UniversalState } from "@/components/universal-state";
import type { DeadlineReminder, DeadlineWorkspace } from "@/server/deadlines/types";
import { BellRing } from "lucide-react";

type Translator = (key: string) => string;

interface DeadlineNotificationsPanelProps {
  error: Error | null;
  featureEnabled: boolean;
  isLoading: boolean;
  lockedMessage: string;
  notice: string;
  onUpdateReminder: (reminder: DeadlineReminder, action: "acknowledge" | "snooze") => void;
  savingReminderId: string | null;
  t: Translator;
  workspace: DeadlineWorkspace | null;
}

function formatEvidenceDate(value: string | null) {
  if (!value) return "";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function LockedFeatureState({ message, title }: { message: string; title: string }) {
  return (
    <UniversalState
      className="mt-4 border-amber-200 bg-amber-50/60 p-4 shadow-none"
      code="plan_limit"
      message={message}
      title={title}
    />
  );
}

export function DeadlineNotificationsPanel({
  error,
  featureEnabled,
  isLoading,
  lockedMessage,
  notice,
  onUpdateReminder,
  savingReminderId,
  t,
  workspace,
}: DeadlineNotificationsPanelProps) {
  return (
    <section
      className={`winbids-panel deadlineNotifications rounded-lg border p-5 shadow-sm ${
        featureEnabled ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/60"
      }`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-blue-700">
            {featureEnabled ? t("intentsPage.deadlineNotifications") : t("intentsPage.nextPhasePreview")}
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-2xl font-black text-slate-950">
            <BellRing size={21} className="text-blue-700" aria-hidden="true" />
            {t("intentsPage.deadlineNotifications")}
          </h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
            {t("intentsPage.deadlineNotificationsDescription")}
          </p>
        </div>
        <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">
          {featureEnabled
            ? workspace
              ? `${workspace.summary.dueSoon}/${workspace.summary.active} ${t("intentsPage.deadlineDueSoon")}`
              : t("intentsPage.deadlineNotificationsLoading")
            : lockedMessage}
        </span>
      </div>

      {!featureEnabled ? (
        <LockedFeatureState message={lockedMessage} title={t("intentsPage.deadlineNotifications")} />
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-5">
            {[
              ["total", workspace?.summary.total ?? 0],
              ["active", workspace?.summary.active ?? 0],
              ["dueSoon", workspace?.summary.dueSoon ?? 0],
              ["overdue", workspace?.summary.overdue ?? 0],
              ["snoozed", workspace?.summary.snoozed ?? 0],
            ].map(([key, value]) => (
              <div key={key as string} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-xs font-black uppercase text-slate-400">
                  {t(`intentsPage.deadlineSummary.${key as string}`)}
                </p>
                <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
              </div>
            ))}
          </div>

          {error ? (
            <UniversalState
              className="border-red-100 bg-red-50/70 p-4 shadow-none"
              code="error"
              message={t("intentsPage.deadlineNotificationsErrorDescription")}
              title={t("intentsPage.deadlineNotificationsError")}
            />
          ) : isLoading ? (
            <p className="text-sm font-semibold text-slate-500">{t("intentsPage.deadlineNotificationsLoading")}</p>
          ) : workspace && workspace.reminders.length > 0 ? (
            <div className="grid gap-3">
              {workspace.reminders.map((reminder) => (
                <article key={reminder.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="border-blue-100 bg-blue-50 text-blue-700">
                          {t(`intentsPage.deadlineKinds.${reminder.kind}`)}
                        </Badge>
                        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                          {t(`intentsPage.deadlineStatuses.${reminder.status}`)}
                        </Badge>
                        <Badge variant="outline" className="border-amber-100 bg-amber-50 text-amber-700">
                          {t(`intentsPage.deadlinePriorities.${reminder.priority}`)}
                        </Badge>
                      </div>
                      <p className="mt-2 break-words text-sm font-black leading-6 text-slate-950">
                        {reminder.title}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-500">
                        {t("intentsPage.deadlineDueAt")}: {reminder.dueAt}
                      </p>
                      {reminder.snoozedUntil ? (
                        <p className="mt-1 text-xs font-bold text-slate-400">
                          {t("intentsPage.deadlineSnoozedUntil")}: {formatEvidenceDate(reminder.snoozedUntil)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onUpdateReminder(reminder, "acknowledge")}
                        disabled={Boolean(savingReminderId) || reminder.status === "acknowledged"}
                        className="h-9 rounded-lg border-slate-200 bg-white"
                      >
                        {t("intentsPage.acknowledgeReminder")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onUpdateReminder(reminder, "snooze")}
                        disabled={Boolean(savingReminderId)}
                        className="h-9 rounded-lg border-slate-200 bg-white"
                      >
                        {t("intentsPage.snoozeReminder")}
                      </Button>
                    </div>
                  </div>
                  {savingReminderId === reminder.id ? (
                    <p className="mt-2 text-xs font-bold text-slate-400">{t("intentsPage.submissionSaving")}</p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <UniversalState
              className="border-slate-200 bg-slate-50/70 p-4 shadow-none"
              code="empty"
              message={t("intentsPage.deadlineNotificationsEmptyDescription")}
              title={t("intentsPage.deadlineNotificationsEmpty")}
            />
          )}

          <p className="min-h-5 text-sm font-semibold text-slate-500">
            {error ? t("intentsPage.deadlineNotificationsSaveError") : notice}
          </p>
        </div>
      )}
    </section>
  );
}
