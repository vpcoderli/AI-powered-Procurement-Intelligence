"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UniversalState } from "@/components/universal-state";
import type { ArtifactPurpose, ArtifactType, ArtifactVault } from "@/server/artifacts/types";
import { ARTIFACT_PURPOSES, ARTIFACT_TYPES } from "@/server/artifacts/types";
import { ExternalLink, FileArchive, RefreshCcw, Trash2, Upload } from "lucide-react";

export interface ArtifactDraft {
  title: string;
  artifactType: ArtifactType;
  purpose: ArtifactPurpose;
  expiresAt: string;
  notes: string;
  file: File | null;
}

type Translator = (key: string) => string;

interface ArtifactVaultPanelProps {
  draft: ArtifactDraft;
  error: Error | null;
  featureEnabled: boolean;
  isLoading: boolean;
  deletingArtifactId: string | null;
  replacingArtifactId: string | null;
  isUploading: boolean;
  lockedMessage: string;
  notice: string;
  onDraftChange: Dispatch<SetStateAction<ArtifactDraft>>;
  onDelete: (artifactId: string) => void;
  onReplace: (artifactId: string, file: File, replacementReason: string) => Promise<void> | void;
  onUpload: () => void;
  t: Translator;
  vault: ArtifactVault | null;
}

function formatFileSize(value: number) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
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

function latestVersionNumber(artifact: ArtifactVault["artifacts"][number]) {
  return artifact.versions.reduce((latest, version) => Math.max(latest, version.versionNumber), 1);
}

export function ArtifactVaultPanel({
  draft,
  error,
  featureEnabled,
  isLoading,
  deletingArtifactId,
  replacingArtifactId,
  isUploading,
  lockedMessage,
  notice,
  onDraftChange,
  onDelete,
  onReplace,
  onUpload,
  t,
  vault,
}: ArtifactVaultPanelProps) {
  const [replacementArtifactId, setReplacementArtifactId] = useState<string | null>(null);
  const [replacementFiles, setReplacementFiles] = useState<Record<string, File | null>>({});
  const [replacementReasons, setReplacementReasons] = useState<Record<string, string>>({});

  function resetReplacementDraft(artifactId: string) {
    setReplacementFiles((current) => ({ ...current, [artifactId]: null }));
    setReplacementReasons((current) => ({ ...current, [artifactId]: "" }));
    setReplacementArtifactId(null);
  }

  return (
    <section
      className={`winbids-panel artifactVault rounded-lg border p-5 shadow-sm ${
        featureEnabled ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/60"
      }`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-blue-700">
            {featureEnabled ? t("intentsPage.artifactVault") : t("intentsPage.nextPhasePreview")}
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-2xl font-black text-slate-950">
            <FileArchive size={21} className="text-blue-700" aria-hidden="true" />
            {t("intentsPage.artifactVault")}
          </h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
            {t("intentsPage.artifactVaultDescription")}
          </p>
        </div>
        <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">
          {featureEnabled
            ? vault
              ? `${vault.summary.active}/${vault.summary.total} ${t("intentsPage.artifactActive")}`
              : t("intentsPage.artifactVaultLoading")
            : lockedMessage}
        </span>
      </div>

      {!featureEnabled ? (
        <LockedFeatureState message={lockedMessage} title={t("intentsPage.artifactVault")} />
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            {([
              ["total", vault?.summary.total ?? 0],
              ["active", vault?.summary.active ?? 0],
              ["expired", vault?.summary.expired ?? 0],
              ["pendingReview", vault?.summary.pendingReview ?? 0],
            ] as const).map(([key, value]) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-xs font-black uppercase text-slate-400">
                  {t(`intentsPage.artifactSummary.${key}`)}
                </p>
                <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <label className="grid flex-1 gap-1.5 text-sm font-bold text-slate-700">
                {t("intentsPage.artifactTitle")}
                <Input
                  value={draft.title}
                  onChange={(event) => onDraftChange((current) => ({ ...current, title: event.target.value }))}
                  disabled={isUploading}
                  placeholder={t("intentsPage.artifactTitlePlaceholder")}
                  className="h-10 rounded-lg border-slate-200 bg-white"
                />
              </label>

              <label className="grid min-w-44 gap-1.5 text-sm font-bold text-slate-700">
                {t("intentsPage.artifactType")}
                <Select
                  value={draft.artifactType}
                  onValueChange={(value) =>
                    onDraftChange((current) => ({ ...current, artifactType: value as ArtifactType }))
                  }
                  disabled={isUploading}
                >
                  <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                    {ARTIFACT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`intentsPage.artifactTypes.${type}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="grid min-w-52 gap-1.5 text-sm font-bold text-slate-700">
                {t("intentsPage.artifactPurpose")}
                <Select
                  value={draft.purpose}
                  onValueChange={(value) =>
                    onDraftChange((current) => ({ ...current, purpose: value as ArtifactPurpose }))
                  }
                  disabled={isUploading}
                >
                  <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                    {ARTIFACT_PURPOSES.map((purpose) => (
                      <SelectItem key={purpose} value={purpose}>
                        {t(`intentsPage.artifactPurposes.${purpose}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(180px,0.35fr)]">
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                {t("intentsPage.artifactFile")}
                <input
                  type="file"
                  onChange={(event) =>
                    onDraftChange((current) => ({ ...current, file: event.target.files?.[0] ?? null }))
                  }
                  disabled={isUploading}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-black file:text-white"
                />
              </label>

              <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                {t("intentsPage.artifactExpiresAt")}
                <Input
                  type="date"
                  value={draft.expiresAt}
                  onChange={(event) => onDraftChange((current) => ({ ...current, expiresAt: event.target.value }))}
                  disabled={isUploading}
                  className="h-10 rounded-lg border-slate-200 bg-white"
                />
              </label>
            </div>

            <label className="mt-3 grid gap-1.5 text-sm font-bold text-slate-700">
              {t("intentsPage.artifactNotes")}
              <textarea
                value={draft.notes}
                onChange={(event) => onDraftChange((current) => ({ ...current, notes: event.target.value }))}
                disabled={isUploading}
                placeholder={t("intentsPage.artifactNotesPlaceholder")}
                className="min-h-20 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
              />
            </label>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                onClick={onUpload}
                disabled={isUploading || !draft.title.trim() || !draft.file}
                className="w-fit rounded-lg bg-slate-950 text-white hover:bg-slate-800"
              >
                <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                {isUploading ? t("intentsPage.submissionSaving") : t("intentsPage.uploadArtifact")}
              </Button>
              <p className="min-h-5 text-sm font-semibold text-slate-500">
                {notice || (draft.file ? draft.file.name : t("intentsPage.artifactNoFile"))}
              </p>
            </div>
          </div>

          {error ? (
            <UniversalState
              className="border-rose-200 bg-rose-50/70 p-4 shadow-none"
              code="upload_failed"
              message={t("intentsPage.artifactUploadFailedDescription")}
              title={t("intentsPage.artifactUploadFailed")}
            />
          ) : null}

          {isLoading ? (
            <p className="text-sm font-semibold text-slate-500">{t("intentsPage.artifactVaultLoading")}</p>
          ) : vault && vault.artifacts.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {vault.artifacts.map((artifact) => (
                <article key={artifact.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  {(() => {
                    const versionCount = artifact.versions.length || 1;
                    const selectedReplacementFile = replacementFiles[artifact.id] ?? null;
                    const replacementReason = replacementReasons[artifact.id] ?? "";
                    const isReplacingThisArtifact = replacingArtifactId === artifact.id;
                    const showReplacementForm = replacementArtifactId === artifact.id;

                    return (
                      <>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-black leading-6 text-slate-950">{artifact.title}</p>
                      <p className="mt-1 break-words text-xs font-bold text-slate-500">
                        {artifact.fileName} {"\u00b7"} {formatFileSize(artifact.byteSize)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        artifact.computedStatus === "active"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }
                    >
                      {t(`intentsPage.artifactStatuses.${artifact.computedStatus}`)}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-blue-100 bg-blue-50 text-blue-700">
                      {t(`intentsPage.artifactTypes.${artifact.artifactType}`)}
                    </Badge>
                    <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                      {t(`intentsPage.artifactPurposes.${artifact.purpose}`)}
                    </Badge>
                    <Badge variant="outline" className="border-slate-200 bg-white text-slate-700">
                      {t(`intentsPage.artifactReviewStatuses.${artifact.reviewStatus}`)}
                    </Badge>
                    <Badge variant="outline" className="border-fuchsia-100 bg-fuchsia-50 text-fuchsia-700">
                      {t("intentsPage.artifactVersions")}: v{latestVersionNumber(artifact)} / {versionCount}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs font-bold text-slate-400">
                    {t("intentsPage.artifactLatestVersion")}: v{latestVersionNumber(artifact)}
                  </p>
                  {artifact.expiresAt ? (
                    <p className="mt-3 text-xs font-bold text-slate-400">
                      {t("intentsPage.artifactExpiresAt")}: {artifact.expiresAt.slice(0, 10)}
                    </p>
                  ) : null}
                  {artifact.notes ? (
                    <p className="mt-2 break-words text-sm leading-6 text-slate-600">{artifact.notes}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Link
                      href={artifact.downloadUrl}
                      className="inline-flex items-center text-sm font-black text-blue-700 hover:text-blue-900"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                      {t("intentsPage.artifactDownload")}
                    </Link>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onDelete(artifact.id)}
                      disabled={Boolean(deletingArtifactId)}
                      className="h-8 rounded-lg border-rose-200 bg-white px-3 text-xs font-black text-rose-700 hover:bg-rose-50"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                      {deletingArtifactId === artifact.id
                        ? t("intentsPage.artifactDeleting")
                        : t("intentsPage.artifactDelete")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setReplacementArtifactId((current) => (current === artifact.id ? null : artifact.id))
                      }
                      disabled={Boolean(replacingArtifactId)}
                      className="h-8 rounded-lg border-blue-200 bg-white px-3 text-xs font-black text-blue-700 hover:bg-blue-50"
                    >
                      <RefreshCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                      {t("intentsPage.artifactReplace")}
                    </Button>
                  </div>
                  {showReplacementForm ? (
                    <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                        <label className="grid gap-1.5 text-xs font-black uppercase text-slate-500">
                          {t("intentsPage.artifactReplaceFile")}
                          <input
                            type="file"
                            onChange={(event) =>
                              setReplacementFiles((current) => ({
                                ...current,
                                [artifact.id]: event.target.files?.[0] ?? null,
                              }))
                            }
                            disabled={isReplacingThisArtifact}
                            className="h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-700 file:px-3 file:py-1.5 file:text-xs file:font-black file:text-white"
                          />
                        </label>
                        <label className="grid gap-1.5 text-xs font-black uppercase text-slate-500">
                          {t("intentsPage.artifactReplacementReason")}
                          <Input
                            value={replacementReason}
                            onChange={(event) =>
                              setReplacementReasons((current) => ({
                                ...current,
                                [artifact.id]: event.target.value,
                              }))
                            }
                            disabled={isReplacingThisArtifact}
                            placeholder={t("intentsPage.artifactReplacementReasonPlaceholder")}
                            className="h-10 rounded-lg border-slate-200 bg-white"
                          />
                        </label>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          onClick={() => {
                            if (!selectedReplacementFile) return;
                            void Promise.resolve(onReplace(artifact.id, selectedReplacementFile, replacementReason))
                              .then(() => resetReplacementDraft(artifact.id));
                          }}
                          disabled={isReplacingThisArtifact || !selectedReplacementFile}
                          className="h-9 rounded-lg bg-blue-700 text-xs font-black text-white hover:bg-blue-800"
                        >
                          <RefreshCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                          {isReplacingThisArtifact
                            ? t("intentsPage.artifactReplacing")
                            : t("intentsPage.artifactReplaceSave")}
                        </Button>
                        <p className="text-xs font-bold text-slate-500">
                          {selectedReplacementFile
                            ? selectedReplacementFile.name
                            : t("intentsPage.artifactNoFile")}
                        </p>
                      </div>
                    </div>
                  ) : null}
                      </>
                    );
                  })()}
                </article>
              ))}
            </div>
          ) : (
            <UniversalState
              className="border-slate-200 bg-slate-50/70 p-4 shadow-none"
              code="empty"
              message={t("intentsPage.artifactVaultEmptyDescription")}
              title={t("intentsPage.artifactVaultEmpty")}
            />
          )}
        </div>
      )}
    </section>
  );
}
