"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UniversalState } from "@/components/universal-state";
import type { ArtifactVault } from "@/server/artifacts/types";
import type {
  AwardNextAction,
  AwardOutcome,
  AwardOutcomeStatus,
  LossReasonCode,
  UpdateAwardOutcomeInput,
} from "@/server/awards/types";
import {
  AWARD_NEXT_ACTIONS,
  AWARD_OUTCOME_STATUSES,
  LOSS_REASON_CODES,
} from "@/server/awards/types";
import { ExternalLink, Trophy } from "lucide-react";

type Translator = (key: string) => string;

interface AwardDraft {
  status: AwardOutcomeStatus;
  awardNoticeUrl: string;
  tabulationArtifactId: string | null;
  tabulationArtifactUrl: string;
  winnerName: string;
  awardAmount: string;
  currency: string;
  lossReason: LossReasonCode;
  lossReasonNotes: string;
  nextAction: AwardNextAction;
  nextActionDueAt: string;
  notes: string;
}

interface AwardWinLossPanelProps {
  availableArtifacts: ArtifactVault["artifacts"];
  error: Error | null;
  featureEnabled: boolean;
  isLoading: boolean;
  isSaving: boolean;
  lockedMessage: string;
  notice: string;
  onUpdate: (patch: UpdateAwardOutcomeInput) => void;
  outcome: AwardOutcome | null;
  t: Translator;
}

const noArtifactValue = "__none__";
const statusOptions: AwardOutcomeStatus[] = [...AWARD_OUTCOME_STATUSES];
const lossReasonOptions: LossReasonCode[] = [...LOSS_REASON_CODES];
const nextActionOptions: AwardNextAction[] = [...AWARD_NEXT_ACTIONS];

function formatAmountInput(value: number | null) {
  return value === null ? "" : (value / 100).toFixed(2);
}

function toDateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function safeExternalUrl(value: string) {
  if (!value) return "";

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function toDraft(outcome: AwardOutcome | null): AwardDraft {
  return {
    status: outcome?.status ?? "awaiting_award",
    awardNoticeUrl: outcome?.awardNoticeUrl ?? "",
    tabulationArtifactId: outcome?.tabulationArtifactId ?? null,
    tabulationArtifactUrl: outcome?.tabulationArtifactUrl ?? "",
    winnerName: outcome?.winnerName ?? "",
    awardAmount: formatAmountInput(outcome?.awardAmountCents ?? null),
    currency: outcome?.currency ?? "USD",
    lossReason: outcome?.lossReason ?? "unknown",
    lossReasonNotes: outcome?.lossReasonNotes ?? "",
    nextAction: outcome?.nextAction ?? "capture_tabulation",
    nextActionDueAt: toDateInput(outcome?.nextActionDueAt ?? null),
    notes: outcome?.notes ?? "",
  };
}

function toAwardAmountCents(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;

  const dollars = Number(normalized);
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
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

export function AwardWinLossPanel({
  availableArtifacts,
  error,
  featureEnabled,
  isLoading,
  isSaving,
  lockedMessage,
  notice,
  onUpdate,
  outcome,
  t,
}: AwardWinLossPanelProps) {
  const [draft, setDraft] = useState<AwardDraft>(() => toDraft(outcome));
  const awardNoticeUrl = safeExternalUrl(draft.awardNoticeUrl);
  const tabulationArtifactUrl = safeExternalUrl(draft.tabulationArtifactUrl);

  const handleSave = () => {
    onUpdate({
      status: draft.status,
      awardNoticeUrl: draft.awardNoticeUrl.trim(),
      tabulationArtifactId: draft.tabulationArtifactId,
      tabulationArtifactUrl: draft.tabulationArtifactUrl.trim(),
      winnerName: draft.winnerName.trim(),
      awardAmountCents: toAwardAmountCents(draft.awardAmount),
      currency: draft.currency.trim().toUpperCase() || "USD",
      lossReason: draft.lossReason,
      lossReasonNotes: draft.lossReasonNotes.trim(),
      nextAction: draft.nextAction,
      nextActionDueAt: draft.nextActionDueAt || null,
      notes: draft.notes.trim(),
    });
  };

  return (
    <section
      className={`winbids-panel awardWinLoss rounded-lg border p-5 shadow-sm ${
        featureEnabled ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/60"
      }`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-blue-700">
            {featureEnabled ? t("intentsPage.awardWinLoss") : t("intentsPage.nextPhasePreview")}
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-2xl font-black text-slate-950">
            <Trophy size={21} className="text-blue-700" aria-hidden="true" />
            {t("intentsPage.awardWinLoss")}
          </h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
            {t("intentsPage.awardWinLossDescription")}
          </p>
        </div>
        <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">
          {featureEnabled
            ? outcome
              ? t(`intentsPage.awardStatuses.${outcome.status}`)
              : t("intentsPage.awardOutcomeLoading")
            : lockedMessage}
        </span>
      </div>

      {!featureEnabled ? (
        <LockedFeatureState message={lockedMessage} title={t("intentsPage.awardWinLoss")} />
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-xs font-black uppercase text-slate-400">{t("intentsPage.awardOutcomeStatus")}</p>
              <p className="mt-1 break-words text-sm font-black text-slate-950">
                {t(`intentsPage.awardStatuses.${draft.status}`)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-xs font-black uppercase text-slate-400">{t("intentsPage.winnerName")}</p>
              <p className="mt-1 break-words text-sm font-black text-slate-950">
                {draft.winnerName || t("intentsPage.notAvailable")}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-xs font-black uppercase text-slate-400">{t("intentsPage.awardAmount")}</p>
              <p className="mt-1 break-words text-sm font-black text-slate-950">
                {draft.awardAmount ? `${draft.currency || "USD"} ${draft.awardAmount}` : t("intentsPage.notAvailable")}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-xs font-black uppercase text-slate-400">{t("intentsPage.nextAction")}</p>
              <p className="mt-1 break-words text-sm font-black text-slate-950">
                {t(`intentsPage.awardNextActions.${draft.nextAction}`)}
              </p>
            </div>
          </div>

          {error ? (
            <UniversalState
              className="border-rose-200 bg-rose-50/70 p-4 shadow-none"
              code="error"
              message={t("intentsPage.awardOutcomeErrorDescription")}
              title={t("intentsPage.awardOutcomeError")}
            />
          ) : null}

          {isLoading ? (
            <p className="text-sm font-semibold text-slate-500">{t("intentsPage.awardOutcomeLoading")}</p>
          ) : outcome ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
              <div className="grid gap-3 lg:grid-cols-3">
                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.awardOutcomeStatus")}
                  <Select
                    value={draft.status}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, status: value as AwardOutcomeStatus }))
                    }
                    disabled={isSaving}
                  >
                    <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                      {statusOptions.map((status) => (
                        <SelectItem key={status} value={status}>
                          {t(`intentsPage.awardStatuses.${status}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.winnerName")}
                  <Input
                    value={draft.winnerName}
                    onChange={(event) => setDraft((current) => ({ ...current, winnerName: event.target.value }))}
                    disabled={isSaving}
                    className="h-10 rounded-lg border-slate-200 bg-white"
                  />
                </label>

                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.currency")}
                  <Input
                    value={draft.currency}
                    onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value }))}
                    disabled={isSaving}
                    className="h-10 rounded-lg border-slate-200 bg-white"
                  />
                </label>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.awardNoticeUrl")}
                  <Input
                    type="url"
                    value={draft.awardNoticeUrl}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, awardNoticeUrl: event.target.value }))
                    }
                    disabled={isSaving}
                    placeholder="https://agency.example.gov/award"
                    className="h-10 rounded-lg border-slate-200 bg-white"
                  />
                </label>

                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.awardAmount")}
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.awardAmount}
                    onChange={(event) => setDraft((current) => ({ ...current, awardAmount: event.target.value }))}
                    disabled={isSaving}
                    className="h-10 rounded-lg border-slate-200 bg-white"
                  />
                </label>
              </div>

              {awardNoticeUrl ? (
                <a
                  href={awardNoticeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center text-xs font-black text-blue-700 hover:text-blue-900"
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {t("intentsPage.openAwardNotice")}
                </a>
              ) : null}

              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.tabulationArtifact")}
                  <Select
                    value={draft.tabulationArtifactId ?? noArtifactValue}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        tabulationArtifactId: value === noArtifactValue ? null : value,
                      }))
                    }
                    disabled={isSaving}
                  >
                    <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                      <SelectItem value={noArtifactValue}>{t("intentsPage.noTabulationArtifact")}</SelectItem>
                      {availableArtifacts.map((artifact) => (
                        <SelectItem key={artifact.id} value={artifact.id}>
                          {artifact.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.tabulationArtifactUrl")}
                  <Input
                    type="url"
                    value={draft.tabulationArtifactUrl}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, tabulationArtifactUrl: event.target.value }))
                    }
                    disabled={isSaving}
                    placeholder="https://agency.example.gov/tabulation"
                    className="h-10 rounded-lg border-slate-200 bg-white"
                  />
                </label>
              </div>

              {tabulationArtifactUrl ? (
                <a
                  href={tabulationArtifactUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center text-xs font-black text-blue-700 hover:text-blue-900"
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {t("intentsPage.openTabulationArtifact")}
                </a>
              ) : null}

              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.lossReason")}
                  <Select
                    value={draft.lossReason}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, lossReason: value as LossReasonCode }))
                    }
                    disabled={isSaving}
                  >
                    <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                      {lossReasonOptions.map((reason) => (
                        <SelectItem key={reason} value={reason}>
                          {t(`intentsPage.lossReasons.${reason}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.nextAction")}
                  <Select
                    value={draft.nextAction}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, nextAction: value as AwardNextAction }))
                    }
                    disabled={isSaving}
                  >
                    <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                      {nextActionOptions.map((action) => (
                        <SelectItem key={action} value={action}>
                          {t(`intentsPage.awardNextActions.${action}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.nextActionDueAt")}
                  <Input
                    type="date"
                    value={draft.nextActionDueAt}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, nextActionDueAt: event.target.value }))
                    }
                    disabled={isSaving}
                    className="h-10 rounded-lg border-slate-200 bg-white"
                  />
                </label>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.lossReasonNotes")}
                  <textarea
                    value={draft.lossReasonNotes}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, lossReasonNotes: event.target.value }))
                    }
                    disabled={isSaving}
                    className="min-h-24 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                  />
                </label>

                <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                  {t("intentsPage.awardNotes")}
                  <textarea
                    value={draft.notes}
                    onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                    disabled={isSaving}
                    className="min-h-24 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                  />
                </label>
              </div>

              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="w-fit rounded-lg bg-slate-950 text-white hover:bg-slate-800"
                >
                  {isSaving ? t("intentsPage.submissionSaving") : t("intentsPage.saveAwardOutcome")}
                </Button>
                <p className="min-h-5 text-sm font-semibold text-slate-500">
                  {error ? t("intentsPage.awardOutcomeSaveError") : notice}
                </p>
              </div>
            </div>
          ) : error ? null : (
            <UniversalState
              className="border-slate-200 bg-slate-50/70 p-4 shadow-none"
              code="empty"
              message={t("intentsPage.awardOutcomeEmptyDescription")}
              title={t("intentsPage.awardOutcomeEmpty")}
            />
          )}

          {outcome ? (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                {t("intentsPage.nextActionDueAt")}: {draft.nextActionDueAt || t("intentsPage.notAvailable")}
              </Badge>
              <Badge variant="outline" className="border-blue-100 bg-blue-50 text-blue-700">
                {t("intentsPage.lossReason")}: {t(`intentsPage.lossReasons.${draft.lossReason}`)}
              </Badge>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
