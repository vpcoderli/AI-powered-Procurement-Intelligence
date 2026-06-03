"use client";

import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UniversalState } from "@/components/universal-state";
import type { ArtifactVault } from "@/server/artifacts/types";
import type { QuoteRequest, QuoteRequestStatus, QuoteWorkspace } from "@/server/quotes/types";
import { QUOTE_REQUEST_STATUSES } from "@/server/quotes/types";
import { ExternalLink, Handshake } from "lucide-react";

export interface QuoteDraft {
  partnerName: string;
  contactName: string;
  contactEmail: string;
  title: string;
  description: string;
  requestedDueAt: string;
  lineItems: string;
  artifactIds: string[];
}

type Translator = (key: string) => string;

interface QuoteWorkspacePanelProps {
  artifactVault: ArtifactVault | null;
  draft: QuoteDraft;
  error: Error | null;
  featureEnabled: boolean;
  isLoading: boolean;
  isSaving: boolean;
  lockedMessage: string;
  notice: string;
  onCreateRequest: () => void;
  onDraftChange: Dispatch<SetStateAction<QuoteDraft>>;
  onUpdateRequest: (
    request: QuoteRequest,
    patch: {
      status?: QuoteRequestStatus;
      quotedAmountCents?: number | null;
      responseNotes?: string;
    },
  ) => void;
  savingRequestId: string | null;
  t: Translator;
  workspace: QuoteWorkspace | null;
}

const quoteRequestStatusOptions: QuoteRequestStatus[] = [...QUOTE_REQUEST_STATUSES];

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

export function QuoteWorkspacePanel({
  artifactVault,
  draft,
  error,
  featureEnabled,
  isLoading,
  isSaving,
  lockedMessage,
  notice,
  onCreateRequest,
  onDraftChange,
  onUpdateRequest,
  savingRequestId,
  t,
  workspace,
}: QuoteWorkspacePanelProps) {
  return (
    <section
      className={`winbids-panel quoteWorkspace rounded-lg border p-5 shadow-sm ${
        featureEnabled ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/60"
      }`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-blue-700">
            {featureEnabled ? t("intentsPage.quoteWorkspace") : t("intentsPage.nextPhasePreview")}
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-2xl font-black text-slate-950">
            <Handshake size={21} className="text-blue-700" aria-hidden="true" />
            {t("intentsPage.quoteWorkspace")}
          </h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
            {t("intentsPage.quoteWorkspaceDescription")}
          </p>
        </div>
        <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">
          {featureEnabled
            ? workspace
              ? `${workspace.summary.received}/${workspace.summary.requests} ${t("intentsPage.quoteReceived")}`
              : t("intentsPage.quoteWorkspaceLoading")
            : lockedMessage}
        </span>
      </div>

      {!featureEnabled ? (
        <LockedFeatureState message={lockedMessage} title={t("intentsPage.quoteWorkspace")} />
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-5">
            {([
              ["partners", workspace?.summary.partners ?? 0],
              ["requests", workspace?.summary.requests ?? 0],
              ["draft", workspace?.summary.draft ?? 0],
              ["received", workspace?.summary.received ?? 0],
              ["accepted", workspace?.summary.accepted ?? 0],
            ] as const).map(([key, value]) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-xs font-black uppercase text-slate-400">
                  {t(`intentsPage.quoteSummary.${key}`)}
                </p>
                <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
            <div className="grid gap-3 lg:grid-cols-3">
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                {t("intentsPage.partnerName")}
                <Input
                  value={draft.partnerName}
                  onChange={(event) => onDraftChange((current) => ({ ...current, partnerName: event.target.value }))}
                  disabled={isSaving}
                  placeholder={t("intentsPage.partnerNamePlaceholder")}
                  className="h-10 rounded-lg border-slate-200 bg-white"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                {t("intentsPage.partnerContact")}
                <Input
                  value={draft.contactName}
                  onChange={(event) => onDraftChange((current) => ({ ...current, contactName: event.target.value }))}
                  disabled={isSaving}
                  className="h-10 rounded-lg border-slate-200 bg-white"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                {t("intentsPage.partnerEmail")}
                <Input
                  value={draft.contactEmail}
                  onChange={(event) => onDraftChange((current) => ({ ...current, contactEmail: event.target.value }))}
                  disabled={isSaving}
                  placeholder="quotes@example.com"
                  className="h-10 rounded-lg border-slate-200 bg-white"
                />
              </label>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                {t("intentsPage.quoteTitle")}
                <Input
                  value={draft.title}
                  onChange={(event) => onDraftChange((current) => ({ ...current, title: event.target.value }))}
                  disabled={isSaving}
                  placeholder={t("intentsPage.quoteTitlePlaceholder")}
                  className="h-10 rounded-lg border-slate-200 bg-white"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                {t("intentsPage.quoteDue")}
                <Input
                  type="date"
                  value={draft.requestedDueAt}
                  onChange={(event) =>
                    onDraftChange((current) => ({ ...current, requestedDueAt: event.target.value }))
                  }
                  disabled={isSaving}
                  className="h-10 rounded-lg border-slate-200 bg-white"
                />
              </label>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                {t("intentsPage.quoteDescription")}
                <textarea
                  value={draft.description}
                  onChange={(event) =>
                    onDraftChange((current) => ({ ...current, description: event.target.value }))
                  }
                  disabled={isSaving}
                  className="min-h-24 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                {t("intentsPage.quoteLineItems")}
                <textarea
                  value={draft.lineItems}
                  onChange={(event) => onDraftChange((current) => ({ ...current, lineItems: event.target.value }))}
                  disabled={isSaving}
                  placeholder={t("intentsPage.quoteLineItemsPlaceholder")}
                  className="min-h-24 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                />
              </label>
            </div>

            {artifactVault?.artifacts.length ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-black text-slate-950">{t("intentsPage.quoteLinkedArtifacts")}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {artifactVault.artifacts.map((artifact) => (
                    <label
                      key={artifact.id}
                      className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/70 p-2 text-xs font-bold text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={draft.artifactIds.includes(artifact.id)}
                        onChange={(event) =>
                          onDraftChange((current) => ({
                            ...current,
                            artifactIds: event.target.checked
                              ? [...current.artifactIds, artifact.id]
                              : current.artifactIds.filter((id) => id !== artifact.id),
                          }))
                        }
                        disabled={isSaving}
                        className="mt-0.5 size-4 rounded border-slate-300"
                      />
                      <span className="break-words">{artifact.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                onClick={onCreateRequest}
                disabled={isSaving || !draft.partnerName.trim() || !draft.title.trim()}
                className="w-fit rounded-lg bg-slate-950 text-white hover:bg-slate-800"
              >
                {isSaving ? t("intentsPage.submissionSaving") : t("intentsPage.createQuoteRequest")}
              </Button>
              <p className="min-h-5 text-sm font-semibold text-slate-500">{notice}</p>
            </div>
          </div>

          {error ? (
            <UniversalState
              className="border-rose-200 bg-rose-50/70 p-4 shadow-none"
              code="error"
              message={t("intentsPage.quoteRequestSaveError")}
              title={t("intentsPage.quoteWorkspace")}
            />
          ) : null}

          {isLoading ? (
            <p className="text-sm font-semibold text-slate-500">{t("intentsPage.quoteWorkspaceLoading")}</p>
          ) : workspace && workspace.requests.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {workspace.requests.map((request) => (
                <article key={request.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-black leading-6 text-slate-950">{request.title}</p>
                      <p className="mt-1 break-words text-xs font-bold text-slate-500">
                        {request.partnerName}
                        {request.requestedDueAt
                          ? ` \u00b7 ${t("intentsPage.quoteDue")}: ${request.requestedDueAt}`
                          : ""}
                      </p>
                    </div>
                    <Select
                      value={request.status}
                      onValueChange={(value) => onUpdateRequest(request, { status: value as QuoteRequestStatus })}
                      disabled={Boolean(savingRequestId)}
                    >
                      <SelectTrigger className="h-9 min-w-36 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                        {quoteRequestStatusOptions.map((status) => (
                          <SelectItem key={status} value={status}>
                            {t(`intentsPage.quoteStatuses.${status}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {request.description ? (
                    <p className="mt-3 break-words text-sm leading-6 text-slate-600">{request.description}</p>
                  ) : null}
                  {request.lineItems.length > 0 ? (
                    <ul className="mt-3 space-y-1 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                      {request.lineItems.map((item) => (
                        <li key={item} className="text-xs font-bold leading-5 text-slate-600">
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {request.artifacts.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {request.artifacts.map((artifact) => (
                        <Link
                          key={artifact.id}
                          href={artifact.downloadUrl}
                          className="inline-flex min-h-7 items-center rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-black text-blue-700 hover:bg-white"
                        >
                          <ExternalLink size={12} className="mr-1.5 shrink-0" aria-hidden="true" />
                          {artifact.title}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
                    <label className="grid gap-1.5 text-xs font-black text-slate-500">
                      {t("intentsPage.quoteAmount")}
                      <Input
                        type="number"
                        min="0"
                        defaultValue={
                          request.quotedAmountCents === null ? "" : Math.round(request.quotedAmountCents / 100)
                        }
                        onBlur={(event) => {
                          const value = event.currentTarget.value.trim();
                          onUpdateRequest(request, {
                            quotedAmountCents: value ? Math.round(Number(value) * 100) : null,
                          });
                        }}
                        disabled={Boolean(savingRequestId)}
                        className="h-9 border-slate-200 bg-white"
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-black text-slate-500">
                      {t("intentsPage.quoteResponseNotes")}
                      <Input
                        defaultValue={request.responseNotes}
                        onBlur={(event) => onUpdateRequest(request, { responseNotes: event.currentTarget.value })}
                        disabled={Boolean(savingRequestId)}
                        className="h-9 border-slate-200 bg-white"
                      />
                    </label>
                  </div>
                  {savingRequestId === request.id ? (
                    <p className="mt-2 text-xs font-bold text-slate-400">{t("intentsPage.submissionSaving")}</p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <UniversalState
              className="border-slate-200 bg-slate-50/70 p-4 shadow-none"
              code="empty"
              message={t("intentsPage.quoteWorkspaceEmptyDescription")}
              title={t("intentsPage.quoteWorkspaceEmpty")}
            />
          )}
        </div>
      )}
    </section>
  );
}
