"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { UniversalState } from "@/components/universal-state";
import type {
  ResponseWorkspace,
  ResponseWorkspaceComment,
  ResponseWorkspaceItem,
  ResponseWorkspaceItemKind,
  ResponseWorkspaceItemStatus,
  ResponsePackageExportFormat,
  ResponsePackageExportReviewStatus,
  ResponsePackageWorkspace,
} from "@/server/response-workspace/types";
import { RESPONSE_PACKAGE_EXPORT_FORMATS, RESPONSE_WORKSPACE_ITEM_STATUSES } from "@/server/response-workspace/types";
import type { SupplierArtifact } from "@/server/artifacts/types";
import { PackageCheck, Send } from "lucide-react";

const responseWorkspaceStatusOptions: ResponseWorkspaceItemStatus[] = [...RESPONSE_WORKSPACE_ITEM_STATUSES];
const responsePackageExportFormatOptions: ResponsePackageExportFormat[] = [...RESPONSE_PACKAGE_EXPORT_FORMATS];
const responseWorkspaceKinds: ResponseWorkspaceItemKind[] = [
  "task",
  "checkpoint",
  "artifact",
  "outline_section",
];
const RESPONSE_WORKSPACE_UNASSIGNED = "__unassigned";

type Translator = (key: string) => string;

interface AssigneeOption {
  label: string;
  userId: string;
}

interface ResponseWorkspacePanelProps {
  assigneeOptions: AssigneeOption[];
  availableArtifacts: SupplierArtifact[];
  commentDrafts: Record<string, string>;
  commentsByItemId: Record<string, ResponseWorkspaceComment[]>;
  error: Error | null;
  exportingSnapshotId: string | null;
  featureEnabled: boolean;
  isLoading: boolean;
  isPackageSaving: boolean;
  lockedMessage: string;
  notice: string;
  onCommentDraftsChange: Dispatch<SetStateAction<Record<string, string>>>;
  onCreateComment: (item: ResponseWorkspaceItem) => void;
  onCreatePackageExport: (snapshotId: string, format: ResponsePackageExportFormat) => void;
  onCreatePackageSnapshot: () => void;
  onReviewPackageExport: (
    exportId: string,
    reviewStatus: ResponsePackageExportReviewStatus,
    reviewNotes: string,
  ) => void;
  onLocalItemUpdate: (
    itemId: string,
    patch: Partial<Pick<ResponseWorkspaceItem, "notes">>,
  ) => void;
  onSaveItem: (
    item: ResponseWorkspaceItem,
    patch: Partial<Pick<ResponseWorkspaceItem, "assignedUserId" | "notes" | "status">>,
  ) => void;
  onSaveLinkedArtifacts: (item: ResponseWorkspaceItem, linkedArtifactIds: string[]) => void;
  savingCommentItemId: string | null;
  savingItemId: string | null;
  reviewingExportId: string | null;
  t: Translator;
  packageWorkspace: ResponsePackageWorkspace | null;
  workspace: ResponseWorkspace | null;
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

export function ResponseWorkspacePanel({
  assigneeOptions,
  availableArtifacts,
  commentDrafts,
  commentsByItemId,
  error,
  exportingSnapshotId,
  featureEnabled,
  isLoading,
  isPackageSaving,
  lockedMessage,
  notice,
  onCommentDraftsChange,
  onCreateComment,
  onCreatePackageExport,
  onCreatePackageSnapshot,
  onReviewPackageExport,
  onLocalItemUpdate,
  onSaveItem,
  onSaveLinkedArtifacts,
  savingCommentItemId,
  savingItemId,
  reviewingExportId,
  t,
  packageWorkspace,
  workspace,
}: ResponseWorkspacePanelProps) {
  const [artifactLinkDrafts, setArtifactLinkDrafts] = useState<Record<string, string[]>>({});
  const [reviewNotesByExportId, setReviewNotesByExportId] = useState<Record<string, string>>({});
  const [showAllPackageSnapshots, setShowAllPackageSnapshots] = useState(false);
  const [selectedPackageComparisonKey, setSelectedPackageComparisonKey] = useState("");
  const packageSnapshots = packageWorkspace?.snapshots ?? [];
  const packageVersionHistory = packageWorkspace?.versionHistory;
  const governanceSummary = packageWorkspace?.governanceSummary;
  const versionComparisons = packageWorkspace?.versionComparisons ?? [];
  const selectedPackageComparison = versionComparisons.find((comparison) =>
    comparison.comparisonKey === selectedPackageComparisonKey
  ) ?? packageWorkspace?.defaultVersionComparison ?? null;
  const visiblePackageSnapshots = showAllPackageSnapshots ? packageSnapshots : packageSnapshots.slice(0, 3);
  const hiddenPackageSnapshotCount = Math.max(packageSnapshots.length - visiblePackageSnapshots.length, 0);

  return (
    <section
      className={`winbids-panel responseWorkspace rounded-lg border p-5 shadow-sm ${
        featureEnabled ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/60"
      }`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-blue-700">
            {featureEnabled ? t("intentsPage.responseWorkspace") : t("intentsPage.nextPhasePreview")}
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-2xl font-black text-slate-950">
            <PackageCheck size={21} className="text-blue-700" aria-hidden="true" />
            {t("intentsPage.responseWorkspace")}
          </h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
            {t("intentsPage.responseWorkspaceDescription")}
          </p>
        </div>
        <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">
          {featureEnabled
            ? workspace
              ? `${workspace.summary.done}/${workspace.summary.total} ${t("intentsPage.responseWorkspaceDone")}`
              : t("intentsPage.responseWorkspaceLoading")
            : lockedMessage}
        </span>
      </div>

      {!featureEnabled ? (
        <LockedFeatureState message={lockedMessage} title={t("intentsPage.responseWorkspace")} />
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["total", workspace?.summary.total ?? 0],
              ["done", workspace?.summary.done ?? 0],
              ["blocked", workspace?.summary.blocked ?? 0],
              ["outlineSections", workspace?.summary.outlineSections ?? 0],
            ].map(([key, value]) => (
              <div key={key as string} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-xs font-black uppercase text-slate-400">
                  {t(`intentsPage.responseWorkspaceSummary.${key as string}`)}
                </p>
                <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase text-violet-700">
                  {t("intentsPage.responsePackageSnapshot")}
                </p>
                <h3 className="mt-1 text-lg font-black text-slate-950">
                  {t("intentsPage.responsePackageReadiness")}
                </h3>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">
                  {packageWorkspace?.readiness.ready
                    ? t("intentsPage.responsePackageReady")
                    : t("intentsPage.responsePackageNeedsWork")}
                </p>
              </div>
              <Button
                type="button"
                onClick={onCreatePackageSnapshot}
                disabled={isPackageSaving || !workspace}
                className="h-9 w-fit rounded-lg bg-violet-700 text-white hover:bg-violet-800"
              >
                {isPackageSaving
                  ? t("intentsPage.submissionSaving")
                  : t("intentsPage.createResponsePackageSnapshot")}
              </Button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              {[
                ["outline", `${packageWorkspace?.readiness.completedOutlineSections ?? 0}/${packageWorkspace?.readiness.totalOutlineSections ?? 0}`],
                ["missingArtifacts", packageWorkspace?.readiness.missingArtifactLinks ?? 0],
                ["blocked", packageWorkspace?.readiness.blockedItems ?? 0],
                ["open", packageWorkspace?.readiness.openItems ?? 0],
              ].map(([key, value]) => (
                <div key={key as string} className="rounded-lg border border-violet-100 bg-white p-3">
                  <p className="text-xs font-black uppercase text-slate-400">
                    {t(`intentsPage.responsePackageSummary.${key as string}`)}
                  </p>
                  <p className="mt-1 text-xl font-black text-slate-950">{value}</p>
                </div>
              ))}
            </div>
            {governanceSummary ? (
              <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase text-emerald-700">
                      {t("intentsPage.responsePackageGovernance")}
                    </p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                      {governanceSummary.canSubmitWithReviewedExport
                        ? t("intentsPage.responsePackageGovernanceReviewedExportReady")
                        : t("intentsPage.responsePackageGovernanceReviewedExportMissing")}
                    </p>
                  </div>
                  <Badge className="w-fit border border-emerald-100 bg-white text-[10px] font-black uppercase text-emerald-700">
                    {governanceSummary.latestReviewerUserId
                      ? governanceSummary.latestReviewerUserId
                      : t("intentsPage.responsePackageGovernanceNoReviewer")}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  {[
                    ["pendingReview", governanceSummary.pendingReviewCount],
                    ["approved", governanceSummary.approvedCount],
                    ["needsChanges", governanceSummary.needsChangesCount],
                    ["longestPending", governanceSummary.longestPendingAgeHours ?? 0],
                  ].map(([key, value]) => (
                    <div key={key as string} className="rounded-md border border-emerald-100 bg-white px-3 py-2">
                      <p className="text-[10px] font-black uppercase text-emerald-500">
                        {t(`intentsPage.responsePackageGovernanceSummary.${key as string}`)}
                      </p>
                      <p className="mt-1 text-lg font-black text-slate-950">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-3 rounded-lg border border-violet-100 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-black uppercase text-slate-500">
                  {t("intentsPage.responsePackageSnapshots")}
                </p>
                <Badge variant="outline" className="border-violet-100 bg-violet-50 text-violet-700">
                  {packageSnapshots.length} {t("intentsPage.items")}
                </Badge>
              </div>
              {packageVersionHistory ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-md border border-violet-100 bg-violet-50/50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase text-violet-500">
                      {t("intentsPage.responsePackageTotalVersions")}
                    </p>
                    <p className="mt-1 text-lg font-black text-slate-950">
                      {packageVersionHistory.totalVersions}
                    </p>
                  </div>
                  <div className="rounded-md border border-violet-100 bg-violet-50/50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase text-violet-500">
                      {t("intentsPage.responsePackageVersionHistory")}
                    </p>
                    <p className="mt-1 text-lg font-black text-slate-950">
                      {packageVersionHistory.latestVersionNumber}
                    </p>
                  </div>
                  <div className="rounded-md border border-violet-100 bg-violet-50/50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase text-violet-500">
                      {t("intentsPage.responsePackageTotalChanges")}
                    </p>
                    <p className="mt-1 text-lg font-black text-slate-950">
                      {packageVersionHistory.totalChanges}
                    </p>
                  </div>
                </div>
              ) : null}
              {versionComparisons.length > 0 && selectedPackageComparison ? (
                <div className="mt-3 rounded-md border border-violet-100 bg-slate-50/80 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase text-violet-700">
                        {t("intentsPage.responsePackageSideBySideComparison")}
                      </p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                        {t("intentsPage.responsePackageCompareVersions")}
                      </p>
                    </div>
                    <Select
                      value={selectedPackageComparison.comparisonKey}
                      onValueChange={(value) => setSelectedPackageComparisonKey(value ?? "")}
                    >
                      <SelectTrigger className="h-9 min-w-[220px] rounded-lg border-violet-100 bg-white text-xs font-black shadow-sm focus:ring-violet-700">
                        <span className="truncate">
                          v{selectedPackageComparison.fromVersionNumber} -&gt; v{selectedPackageComparison.toVersionNumber}
                        </span>
                      </SelectTrigger>
                      <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                        {versionComparisons.map((comparison) => (
                          <SelectItem key={comparison.comparisonKey} value={comparison.comparisonKey}>
                            v{comparison.fromVersionNumber} -&gt; v{comparison.toVersionNumber}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {[selectedPackageComparison].map((comparison) => (
                    <div key={comparison.comparisonKey} className="mt-3 grid gap-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-md border border-slate-100 bg-white px-3 py-2">
                          <p className="text-[10px] font-black uppercase text-slate-400">
                            {t("intentsPage.responsePackageFromVersion")}
                          </p>
                          <p className="mt-1 break-words text-xs font-black text-slate-800">
                            v{comparison.fromVersionNumber} {comparison.fromTitle}
                          </p>
                        </div>
                        <div className="rounded-md border border-slate-100 bg-white px-3 py-2">
                          <p className="text-[10px] font-black uppercase text-slate-400">
                            {t("intentsPage.responsePackageToVersion")}
                          </p>
                          <p className="mt-1 break-words text-xs font-black text-slate-800">
                            v{comparison.toVersionNumber} {comparison.toTitle}
                          </p>
                        </div>
                      </div>
                      {comparison.items.length > 0 ? (
                        <div className="grid gap-2">
                          {comparison.items.slice(0, 6).map((item) => (
                            <div
                              key={`${item.kind}-${item.label}-${item.toValue ?? "none"}`}
                              className="grid gap-2 rounded-md border border-slate-100 bg-white p-2 sm:grid-cols-[1fr_1fr_1fr]"
                            >
                              <p className="break-words text-[11px] font-black text-slate-700">{item.label}</p>
                              <p className="break-words text-[11px] font-semibold leading-5 text-slate-500">
                                {item.fromValue || "-"}
                              </p>
                              <p className="break-words text-[11px] font-semibold leading-5 text-slate-800">
                                {item.toValue || "-"}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs font-semibold text-slate-400">
                          {t("intentsPage.responsePackageComparisonNoChanges")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 grid gap-2">
                {visiblePackageSnapshots.map((snapshot) => (
                  <div key={snapshot.id} className="rounded-md border border-slate-100 bg-slate-50/70 p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="break-words text-xs font-black text-slate-800">{snapshot.title}</p>
                      <p className="text-[11px] font-bold text-slate-400">
                        {snapshot.createdAt.slice(0, 16).replace("T", " ")}
                      </p>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {snapshot.readiness.completedOutlineSections}/{snapshot.readiness.totalOutlineSections}{" "}
                      {t("intentsPage.responsePackageSummary.outline")}
                    </p>
                    <div className="mt-2 rounded-md border border-violet-100 bg-white px-2 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge className="border border-violet-100 bg-violet-50 text-[10px] font-black uppercase text-violet-700">
                          {t("intentsPage.responsePackageVersion")} {snapshot.version.versionNumber}
                        </Badge>
                        <p className="text-[11px] font-bold text-slate-400">
                          {snapshot.version.changeCount} {t("intentsPage.responsePackageChangesSincePrevious")}
                        </p>
                      </div>
                      {snapshot.version.changes.length > 0 ? (
                        <div className="mt-2 grid gap-1">
                          {snapshot.version.changes.slice(0, 3).map((change) => (
                            <p
                              key={`${change.kind}-${change.label}-${change.toValue ?? "none"}`}
                              className="break-words text-[11px] font-semibold leading-5 text-slate-500"
                            >
                              <span className="font-black text-slate-700">{change.label}</span>
                              {change.fromValue !== null || change.toValue !== null
                                ? `: ${change.fromValue ?? "-"} -> ${change.toValue ?? "-"}`
                                : ""}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-[11px] font-semibold leading-5 text-slate-400">
                          {t("intentsPage.responsePackageNoVersionChanges")}
                        </p>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {responsePackageExportFormatOptions.map((formatOption) => (
                        <Button
                          key={formatOption}
                          type="button"
                          onClick={() => onCreatePackageExport(snapshot.id, formatOption)}
                          disabled={Boolean(exportingSnapshotId)}
                          className="h-8 rounded-md bg-slate-950 px-3 text-xs font-black text-white hover:bg-slate-800"
                        >
                          {exportingSnapshotId === snapshot.id
                            ? t("intentsPage.submissionSaving")
                            : `${t("intentsPage.exportResponsePackage")} ${t(`intentsPage.responsePackageExportFormats.${formatOption}`)}`}
                        </Button>
                      ))}
                      {snapshot.exports.slice(0, 2).map((exportRecord) => (
                        <div key={exportRecord.id} className="min-w-[260px] rounded-md border border-slate-100 bg-white p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <a
                              href={exportRecord.downloadUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex min-h-8 items-center rounded-md border border-violet-100 bg-white px-3 text-xs font-black text-violet-700 hover:border-violet-200"
                            >
                              {t("intentsPage.downloadResponsePackage")}
                            </a>
                            <Badge className="border border-slate-200 bg-slate-50 text-[10px] font-black uppercase text-slate-500">
                              {t(`intentsPage.responsePackageExportReviewStatuses.${exportRecord.reviewStatus}`)}
                            </Badge>
                            <Badge className="border border-slate-200 bg-white text-[10px] font-black uppercase text-slate-500">
                              {t(`intentsPage.responsePackageExportFormats.${exportRecord.format}`)}
                            </Badge>
                            <Input
                              value={reviewNotesByExportId[exportRecord.id] ?? exportRecord.reviewNotes}
                              onChange={(event) =>
                                setReviewNotesByExportId((current) => ({
                                  ...current,
                                  [exportRecord.id]: event.target.value,
                                }))
                              }
                              placeholder={t("intentsPage.responsePackageReviewNotePlaceholder")}
                              className="h-8 min-w-[180px] flex-1 rounded-md border-slate-200 bg-slate-50/70 text-xs"
                            />
                            <Button
                              type="button"
                              onClick={() =>
                                onReviewPackageExport(
                                  exportRecord.id,
                                  "approved",
                                  reviewNotesByExportId[exportRecord.id] ?? exportRecord.reviewNotes,
                                )
                              }
                              disabled={reviewingExportId === exportRecord.id}
                              className="h-8 rounded-md bg-emerald-700 px-3 text-xs font-black text-white hover:bg-emerald-800"
                            >
                              {t("intentsPage.approveResponsePackageExport")}
                            </Button>
                            <Button
                              type="button"
                              onClick={() =>
                                onReviewPackageExport(
                                  exportRecord.id,
                                  "needs_changes",
                                  reviewNotesByExportId[exportRecord.id] ?? exportRecord.reviewNotes,
                                )
                              }
                              disabled={reviewingExportId === exportRecord.id || !(reviewNotesByExportId[exportRecord.id] ?? exportRecord.reviewNotes).trim()}
                              className="h-8 rounded-md bg-amber-600 px-3 text-xs font-black text-white hover:bg-amber-700"
                            >
                              {t("intentsPage.requestResponsePackageChanges")}
                            </Button>
                          </div>
                          {exportRecord.reviewHistory.length > 0 ? (
                            <div className="mt-2 space-y-1 rounded-md border border-slate-100 bg-slate-50/80 p-2">
                              <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                                {t("intentsPage.responsePackageReviewHistory")}
                              </p>
                              {exportRecord.reviewHistory.slice(-3).map((event) => (
                                <div key={event.id} className="rounded border border-white bg-white/80 px-2 py-1 text-[11px] leading-5 text-slate-600">
                                  <p className="font-black text-slate-700">
                                    {t(`intentsPage.responsePackageExportReviewStatuses.${event.fromReviewStatus}`)}
                                    {" -> "}
                                    {t(`intentsPage.responsePackageExportReviewStatuses.${event.toReviewStatus}`)}
                                    <span className="ml-2 font-semibold text-slate-400">
                                      {event.createdAt.slice(0, 16).replace("T", " ")}
                                    </span>
                                  </p>
                                  {event.reviewNotes ? (
                                    <p className="break-words text-slate-500">{event.reviewNotes}</p>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {packageSnapshots.length > 3 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAllPackageSnapshots((current) => !current)}
                    className="h-8 w-fit rounded-md border-violet-100 bg-white px-3 text-xs font-black text-violet-700 hover:border-violet-200"
                  >
                    {showAllPackageSnapshots
                      ? t("intentsPage.showRecentResponsePackageVersions")
                      : `${t("intentsPage.showAllResponsePackageVersions")} (${hiddenPackageSnapshotCount})`}
                  </Button>
                ) : null}
                {packageSnapshots.length === 0 ? (
                  <p className="text-xs font-semibold text-slate-400">
                    {t("intentsPage.responsePackageNoSnapshots")}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {isLoading ? (
            <p className="text-sm font-semibold text-slate-500">{t("intentsPage.responseWorkspaceLoading")}</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {responseWorkspaceKinds.map((kind) => {
                const items = workspace?.items.filter((item) => item.kind === kind) ?? [];

                return (
                  <article key={kind} className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-black text-slate-950">
                        {t(`intentsPage.responseWorkspaceKinds.${kind}`)}
                      </h3>
                      <Badge variant="outline" className="border-slate-200 bg-white text-slate-700">
                        {items.length} {t("intentsPage.items")}
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-3">
                      {items.map((item) => {
                        const itemComments = commentsByItemId[item.id] ?? [];
                        const assigneeValue = item.assignedUserId ?? RESPONSE_WORKSPACE_UNASSIGNED;

                        return (
                          <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <p className="break-words text-sm font-black leading-6 text-slate-950">
                                  {item.title}
                                </p>
                                <p className="mt-1 text-xs font-bold text-slate-400">
                                  {t("intentsPage.responseWorkspaceAssignee")}:{" "}
                                  {item.assignedUser?.displayName ||
                                    item.assignedUser?.email ||
                                    t("intentsPage.responseWorkspaceUnassigned")}
                                </p>
                                {item.dueAt ? (
                                  <p className="mt-1 text-xs font-bold text-slate-400">
                                    {t("intentsPage.responseWorkspaceDue")}: {item.dueAt.slice(0, 10)}
                                  </p>
                                ) : null}
                              </div>
                              <div className="grid gap-2 sm:w-48">
                                <Select
                                  value={assigneeValue}
                                  onValueChange={(value) =>
                                    onSaveItem(item, {
                                      assignedUserId: value === RESPONSE_WORKSPACE_UNASSIGNED ? null : value,
                                    })
                                  }
                                  disabled={Boolean(savingItemId)}
                                >
                                  <SelectTrigger className="h-9 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                                    <span className="truncate">
                                      {item.assignedUser?.displayName ||
                                        item.assignedUser?.email ||
                                        t("intentsPage.responseWorkspaceUnassigned")}
                                    </span>
                                  </SelectTrigger>
                                  <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                                    <SelectItem value={RESPONSE_WORKSPACE_UNASSIGNED}>
                                      {t("intentsPage.responseWorkspaceUnassigned")}
                                    </SelectItem>
                                    {assigneeOptions.map((option) => (
                                      <SelectItem key={option.userId} value={option.userId}>
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Select
                                  value={item.status}
                                  onValueChange={(value) =>
                                    onSaveItem(item, { status: value as ResponseWorkspaceItemStatus })
                                  }
                                  disabled={Boolean(savingItemId)}
                                >
                                  <SelectTrigger className="h-9 rounded-lg border-slate-200 bg-white shadow-sm focus:ring-slate-900">
                                    <span className="truncate">
                                      {t(`intentsPage.responseWorkspaceStatuses.${item.status}`)}
                                    </span>
                                  </SelectTrigger>
                                  <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                                    {responseWorkspaceStatusOptions.map((status) => (
                                      <SelectItem key={status} value={status}>
                                        {t(`intentsPage.responseWorkspaceStatuses.${status}`)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <textarea
                              value={item.notes}
                              onChange={(event) => onLocalItemUpdate(item.id, { notes: event.target.value })}
                              onBlur={(event) => onSaveItem(item, { notes: event.currentTarget.value })}
                              disabled={Boolean(savingItemId)}
                              placeholder={t("intentsPage.responseWorkspaceNotesPlaceholder")}
                              className="mt-3 min-h-16 w-full resize-y rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                            />
                            <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-black uppercase text-slate-500">
                                  {t("intentsPage.responseWorkspaceLinkedArtifacts")}
                                </p>
                                <Badge variant="outline" className="border-blue-100 bg-white text-blue-700">
                                  {item.linkedArtifacts.length} {t("intentsPage.items")}
                                </Badge>
                              </div>
                              {item.linkedArtifacts.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {item.linkedArtifacts.map((artifact) => (
                                    <a
                                      key={artifact.id}
                                      href={artifact.downloadUrl}
                                      className="inline-flex min-h-7 items-center rounded-md border border-blue-100 bg-white px-2 py-1 text-xs font-black text-blue-700 hover:border-blue-200"
                                    >
                                      <span className="break-words">{artifact.title}</span>
                                    </a>
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-2 text-xs font-semibold text-slate-400">
                                  {t("intentsPage.responseWorkspaceNoLinkedArtifacts")}
                                </p>
                              )}
                              <div className="mt-3 border-t border-blue-100 pt-3">
                                <p className="text-xs font-black text-slate-500">
                                  {t("intentsPage.responseWorkspaceAvailableArtifacts")}
                                </p>
                                {availableArtifacts.length > 0 ? (
                                  <div className="mt-2 grid gap-2">
                                    {availableArtifacts.map((artifact) => {
                                      const linkedIds = artifactLinkDrafts[item.id] ?? item.linkedArtifacts.map((linked) => linked.id);

                                      return (
                                        <label
                                          key={artifact.id}
                                          className="flex items-start gap-2 rounded-md border border-blue-100 bg-white px-2 py-2 text-xs font-bold text-slate-700"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={linkedIds.includes(artifact.id)}
                                            onChange={(event) =>
                                              setArtifactLinkDrafts((current) => {
                                                const currentIds = current[item.id] ?? item.linkedArtifacts.map((linked) => linked.id);

                                                return {
                                                  ...current,
                                                  [item.id]: event.target.checked
                                                    ? [...currentIds, artifact.id]
                                                    : currentIds.filter((id) => id !== artifact.id),
                                                };
                                              })
                                            }
                                            disabled={Boolean(savingItemId)}
                                            className="mt-0.5 size-4 rounded border-slate-300 text-blue-700"
                                          />
                                          <span className="min-w-0">
                                            <span className="block break-words font-black text-slate-800">{artifact.title}</span>
                                            <span className="block break-words text-slate-400">
                                              {artifact.fileName} {"\u00b7"} {t(`intentsPage.artifactTypes.${artifact.artifactType}`)}
                                            </span>
                                          </span>
                                        </label>
                                      );
                                    })}
                                    <Button
                                      type="button"
                                      onClick={() =>
                                        onSaveLinkedArtifacts(
                                          item,
                                          artifactLinkDrafts[item.id] ?? item.linkedArtifacts.map((artifact) => artifact.id),
                                        )
                                      }
                                      disabled={Boolean(savingItemId)}
                                      className="h-9 w-fit rounded-lg bg-blue-700 text-white hover:bg-blue-800"
                                    >
                                      {savingItemId === item.id
                                        ? t("intentsPage.submissionSaving")
                                        : t("intentsPage.saveResponseWorkspaceArtifacts")}
                                    </Button>
                                  </div>
                                ) : (
                                  <p className="mt-2 text-xs font-semibold text-slate-400">
                                    {t("intentsPage.responseWorkspaceNoAvailableArtifacts")}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-black uppercase text-slate-500">
                                  {t("intentsPage.responseWorkspaceComments")}
                                </p>
                                <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
                                  {itemComments.length} {t("intentsPage.items")}
                                </Badge>
                              </div>
                              <div className="mt-2 grid gap-2">
                                {itemComments.map((comment) => (
                                  <div key={comment.id} className="rounded-md border border-slate-100 bg-white p-2">
                                    <p className="text-xs font-black text-slate-700">
                                      {comment.author?.displayName ||
                                        comment.author?.email ||
                                        comment.authorUserId}
                                    </p>
                                    <p className="mt-1 whitespace-pre-wrap break-words text-xs font-semibold leading-5 text-slate-600">
                                      {comment.body}
                                    </p>
                                  </div>
                                ))}
                                {itemComments.length === 0 ? (
                                  <p className="text-xs font-semibold text-slate-400">
                                    {t("intentsPage.responseWorkspaceNoComments")}
                                  </p>
                                ) : null}
                              </div>
                              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                <Input
                                  value={commentDrafts[item.id] ?? ""}
                                  onChange={(event) =>
                                    onCommentDraftsChange((current) => ({
                                      ...current,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                  disabled={Boolean(savingCommentItemId)}
                                  placeholder={t("intentsPage.responseWorkspaceCommentPlaceholder")}
                                  className="h-9 rounded-lg border-slate-200 bg-white text-sm"
                                />
                                <Button
                                  type="button"
                                  onClick={() => onCreateComment(item)}
                                  disabled={Boolean(savingCommentItemId) || !(commentDrafts[item.id] ?? "").trim()}
                                  className="h-9 w-fit rounded-lg bg-slate-950 text-white hover:bg-slate-800"
                                >
                                  <Send size={14} className="mr-2" aria-hidden="true" />
                                  {savingCommentItemId === item.id
                                    ? t("intentsPage.submissionSaving")
                                    : t("intentsPage.addResponseWorkspaceComment")}
                                </Button>
                              </div>
                            </div>
                            <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-black uppercase text-slate-500">
                                  {t("intentsPage.responseWorkspaceActivity")}
                                </p>
                                <Badge variant="outline" className="border-emerald-100 bg-white text-emerald-700">
                                  {item.activity.length} {t("intentsPage.items")}
                                </Badge>
                              </div>
                              <div className="mt-2 grid gap-2">
                                {item.activity.length > 0 ? (
                                  item.activity.slice(0, 5).map((activity) => (
                                    <div key={activity.id} className="rounded-md border border-emerald-100 bg-white p-2">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="text-xs font-black text-slate-800">
                                          {t(`intentsPage.responseWorkspaceActivityTypes.${activity.eventType}`)}
                                        </p>
                                        <p className="text-[11px] font-bold text-slate-400">
                                          {activity.createdAt.slice(0, 16).replace("T", " ")}
                                        </p>
                                      </div>
                                      <p className="mt-1 break-words text-xs font-semibold leading-5 text-slate-500">
                                        {activity.actor?.displayName ||
                                          activity.actor?.email ||
                                          activity.actorUserId}
                                        {activity.toValue ? `: ${activity.toValue}` : ""}
                                      </p>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-xs font-semibold text-slate-400">
                                    {t("intentsPage.responseWorkspaceNoActivity")}
                                  </p>
                                )}
                              </div>
                            </div>
                            {savingItemId === item.id ? (
                              <p className="mt-2 text-xs font-bold text-slate-400">
                                {t("intentsPage.submissionSaving")}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                      {items.length === 0 ? (
                        <p className="text-sm font-semibold text-slate-500">
                          {t("intentsPage.responseWorkspaceEmpty")}
                        </p>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <p className="min-h-5 text-sm font-semibold text-slate-500">
            {error ? t("intentsPage.responseWorkspaceSaveError") : notice}
          </p>
        </div>
      )}
    </section>
  );
}
