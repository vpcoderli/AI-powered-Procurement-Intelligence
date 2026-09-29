"use client";

import { useCallback, useState } from "react";
import { Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  batchUpdateAdminBidQaItems,
  getAdminBidQaCorrections,
  listAdminBidQaItems,
  updateAdminBidQaReview,
  type AdminBidQaCorrectionHistoryItem,
  type AdminBidQaDisplayStatus,
  type AdminBidQaItem,
  type AdminBidQaReviewStatus,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { compactErrorMessage, endOfDayIsoFromDateInput, formatBidDate, formatDate, formatDateInputValue, isUnreadableDateInput } from "../admin-format";
import { useAdminSession } from "../admin-session";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";

export type BidQaCorrectionDraft = {
  title: string;
  deadlineDate: string;
};

/** The request's `corrections`: the fields the admin changed, and only those. */
type BidQaCorrections = { title?: string; deadlineDate?: string | null };

export type BidQaFilters = {
  q: string;
  stateCode: string;
  reviewStatus: AdminBidQaReviewStatus | "all";
  displayStatus: AdminBidQaDisplayStatus | "all";
  sourceConfidence: string;
  minQualityScore: string;
  maxQualityScore: string;
  reviewerId: string;
  reviewedFrom: string;
  reviewedTo: string;
};

export const DEFAULT_BID_QA_FILTERS: BidQaFilters = {
  q: "",
  stateCode: "",
  reviewStatus: "all",
  displayStatus: "all",
  sourceConfidence: "all",
  minQualityScore: "",
  maxQualityScore: "",
  reviewerId: "",
  reviewedFrom: "",
  reviewedTo: "",
};

/** The old page's bidQaRequest callback, as a pure function. */
export function bidQaRequestFor(filters: BidQaFilters) {
  return {
    limit: 10,
    q: filters.q.trim() || undefined,
    stateCode: filters.stateCode.trim().toUpperCase() || undefined,
    reviewStatus: filters.reviewStatus === "all" ? undefined : filters.reviewStatus,
    displayStatus: filters.displayStatus === "all" ? undefined : filters.displayStatus,
    sourceConfidence: filters.sourceConfidence === "all" ? undefined : filters.sourceConfidence,
    minQualityScore: filters.minQualityScore ? Number(filters.minQualityScore) : undefined,
    maxQualityScore: filters.maxQualityScore ? Number(filters.maxQualityScore) : undefined,
    reviewerId: filters.reviewerId.trim() || undefined,
    reviewedFrom: filters.reviewedFrom ? `${filters.reviewedFrom}T00:00:00.000Z` : undefined,
    reviewedTo: filters.reviewedTo ? `${filters.reviewedTo}T23:59:59.999Z` : undefined,
  };
}

function reviewStatusLabel(t: (key: string) => string, status: AdminBidQaReviewStatus) {
  return t(`admin.reviewStatus_${status}`);
}

function displayStatusLabel(t: (key: string) => string, status: AdminBidQaDisplayStatus) {
  return t(`admin.displayStatus_${status}`);
}

function displayStatusTone(status: AdminBidQaDisplayStatus) {
  if (status === "published") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "suppressed") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function bidQaCorrectionDraftFor(item: Pick<AdminBidQaItem, "id" | "title" | "deadlineDate">, drafts: Record<string, BidQaCorrectionDraft>) {
  return drafts[item.id] ?? {
    title: item.title,
    deadlineDate: formatDateInputValue(item.deadlineDate),
  };
}

/**
 * What a correction draft changes on a bid, as the PATCH body's `corrections`, or null when it changes nothing. Only
 * the fields the admin changed are sent: the route answers 400 to an empty `corrections`, and the server logs a
 * correction for every value that differs from the stored string, so sending an untouched deadline used to replace
 * "07/10/2026" with "2026-07-09T23:59:59.000Z" (the day before, in UTC+8) even when only the title was fixed.
 *
 * The title is changed when the draft was edited and its trimmed text differs from the stored title, so an untouched
 * draft never counts. The deadline is changed when the picked day differs from the day the input was prefilled with;
 * it is sent as the end of that day in UTC, and an emptied input as null, which clears the deadline as it always did.
 *
 * A date the input holds but that is no day the request can carry (desktop Chrome lets the year run to six digits,
 * which Date does not read) is not a correction: it would come out as null too and clear the deadline. It holds back
 * the whole draft, the title change included, so nothing is saved that the admin did not mean and no typed date is
 * quietly dropped; the date field is marked invalid and Save corrections stays off until it is a day again.
 */
export function bidQaCorrectionsFor(item: Pick<AdminBidQaItem, "title" | "deadlineDate">, draft: BidQaCorrectionDraft): BidQaCorrections | null {
  if (isUnreadableDateInput(draft.deadlineDate)) return null;

  const corrections: BidQaCorrections = {};
  const title = draft.title.trim();
  if (draft.title !== item.title && title !== item.title) corrections.title = title;
  if (draft.deadlineDate !== formatDateInputValue(item.deadlineDate)) corrections.deadlineDate = endOfDayIsoFromDateInput(draft.deadlineDate);

  return Object.keys(corrections).length > 0 ? corrections : null;
}

function qualityTone(score: number) {
  if (score >= 85) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (score >= 70) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function reviewTone(status: string | null | undefined) {
  if (status === "reviewed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "suppressed") return "border-slate-300 bg-slate-100 text-slate-700";
  if (status === "needs_review") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function BidQaSection() {
  const { t } = useLanguage();
  const { canRunOperations } = useAdminSession();
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingBidQaId, setPendingBidQaId] = useState<string | null>(null);
  const [pendingBidQaBatch, setPendingBidQaBatch] = useState(false);
  const [bidQaFilters, setBidQaFilters] = useState<BidQaFilters>(DEFAULT_BID_QA_FILTERS);
  const [selectedBidQaIds, setSelectedBidQaIds] = useState<string[]>([]);
  const [correctionHistoryBidId, setCorrectionHistoryBidId] = useState<string | null>(null);
  const [correctionHistoryItems, setCorrectionHistoryItems] = useState<AdminBidQaCorrectionHistoryItem[]>([]);
  const [isLoadingCorrectionHistory, setIsLoadingCorrectionHistory] = useState(false);
  const [correctionDrafts, setCorrectionDrafts] = useState<Record<string, BidQaCorrectionDraft>>({});
  const loadBidQa = useCallback(() => listAdminBidQaItems(bidQaRequestFor(bidQaFilters)), [bidQaFilters]);
  const qa = useAdminResource(loadBidQa);
  const bidQa = qa.data;
  const bidQaItems = bidQa?.items ?? [];
  const visibleSelectedBidQaIds = selectedBidQaIds.filter((id) => bidQaItems.some((item) => item.id === id));
  const allVisibleBidQaSelected = bidQaItems.length > 0 && bidQaItems.every((item) => selectedBidQaIds.includes(item.id));

  const updateBidQaFilters = (updater: (current: BidQaFilters) => BidQaFilters) => {
    setSelectedBidQaIds([]);
    setBidQaFilters(updater);
  };

  const updateBidQaStatus = (item: AdminBidQaItem, reviewStatus: AdminBidQaReviewStatus) => {
    setPendingBidQaId(item.id);
    updateAdminBidQaReview(item.id, { reviewStatus })
      .then(() => qa.reload())
      .then(() => {
        setNotice(t("admin.bidQaUpdated"));
      })
      .catch(() => {
        setNotice(t("admin.bidQaUpdateFailed"));
      })
      .finally(() => {
        setPendingBidQaId(null);
      });
  };

  const updateBidQaDisplayStatus = (item: AdminBidQaItem, displayStatus: AdminBidQaDisplayStatus) => {
    setPendingBidQaId(item.id);
    updateAdminBidQaReview(item.id, { displayStatus })
      .then(() => qa.reload())
      .then(() => {
        setNotice(t("admin.bidQaUpdated"));
      })
      .catch(() => {
        setNotice(t("admin.bidQaUpdateFailed"));
      })
      .finally(() => {
        setPendingBidQaId(null);
      });
  };

  const saveBidQaCorrections = (item: AdminBidQaItem) => {
    const corrections = bidQaCorrectionsFor(item, bidQaCorrectionDraftFor(item, correctionDrafts));
    if (!corrections) return;

    setPendingBidQaId(item.id);
    updateAdminBidQaReview(item.id, {
      corrections,
      note: "Admin QA correction",
    })
      .then(() => qa.reload())
      .then(() => {
        setCorrectionDrafts((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
        setNotice(t("admin.bidQaUpdated"));
      })
      .catch(() => {
        setNotice(t("admin.bidQaUpdateFailed"));
      })
      .finally(() => {
        setPendingBidQaId(null);
      });
  };

  const toggleSelectedBidQaId = (id: string) => {
    setSelectedBidQaIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const toggleAllVisibleBidQa = () => {
    setSelectedBidQaIds((current) => {
      const visibleIds = bidQaItems.map((item) => item.id);
      if (visibleIds.length > 0 && visibleIds.every((id) => current.includes(id))) {
        return current.filter((id) => !visibleIds.includes(id));
      }

      return [...new Set([...current, ...visibleIds])];
    });
  };

  const batchReviewBidQa = (reviewStatus: AdminBidQaReviewStatus) => {
    if (visibleSelectedBidQaIds.length === 0) return;

    setPendingBidQaBatch(true);
    batchUpdateAdminBidQaItems({
      bidIds: visibleSelectedBidQaIds,
      reviewStatus,
      note: "Admin QA batch action",
    })
      .then(() => qa.reload())
      .then(() => {
        setNotice(t("admin.bidQaUpdated"));
      })
      .catch(() => {
        setNotice(t("admin.bidQaUpdateFailed"));
      })
      .finally(() => {
        setPendingBidQaBatch(false);
      });
  };

  const batchDisplayBidQa = (displayStatus: AdminBidQaDisplayStatus) => {
    if (visibleSelectedBidQaIds.length === 0) return;

    setPendingBidQaBatch(true);
    batchUpdateAdminBidQaItems({
      bidIds: visibleSelectedBidQaIds,
      displayStatus,
    })
      .then(() => qa.reload())
      .then(() => {
        setNotice(t("admin.bidQaUpdated"));
      })
      .catch(() => {
        setNotice(t("admin.bidQaUpdateFailed"));
      })
      .finally(() => {
        setPendingBidQaBatch(false);
      });
  };

  const loadCorrectionHistory = (item: AdminBidQaItem) => {
    setCorrectionHistoryBidId(item.id);
    setIsLoadingCorrectionHistory(true);
    getAdminBidQaCorrections(item.id)
      .then((response) => {
        setCorrectionHistoryItems(response.corrections);
      })
      .catch(() => {
        setCorrectionHistoryItems([]);
        setNotice(t("admin.bidQaUpdateFailed"));
      })
      .finally(() => {
        setIsLoadingCorrectionHistory(false);
      });
  };

  if (qa.status === "error" && bidQa === null) {
    return (
      <AdminSectionStateCard
        action={() => void qa.reload()}
        actionLabel={t("admin.refresh")}
        code="error"
        message={t("admin.errorDescription")}
        title={t("admin.bidQa")}
      />
    );
  }
  if (qa.status === "loading" && bidQa === null) {
    return <AdminSectionStateCard actionLabel={t("admin.refresh")} code="loading" message={t("admin.loading")} title={t("admin.bidQa")} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminNotice message={notice} />
      {qa.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}
      {bidQa && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 font-semibold text-slate-950">
              <Database size={18} />
              {t("admin.bidQa")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                {t("admin.needsReview")}: {bidQa.summary.needsReview}
              </Badge>
              <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                {t("admin.archiveIssues")}: {bidQa.summary.archiveIssues}
              </Badge>
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                {t("admin.lowQuality")}: {bidQa.summary.lowQuality}
              </Badge>
            </div>
          </div>
          <div className="grid gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3 lg:grid-cols-[minmax(180px,1fr)_90px_150px_150px_130px_100px_100px_140px_140px_auto]">
            <div className="lg:col-span-10 text-xs font-semibold uppercase text-slate-500">{t("admin.qaFilters")}</div>
            <Input
              value={bidQaFilters.q}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, q: event.target.value }))}
              placeholder={t("admin.searchBidQa")}
              className="h-9 rounded-lg border-slate-200 bg-white"
            />
            <Input
              value={bidQaFilters.stateCode}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, stateCode: event.target.value }))}
              placeholder={t("admin.state")}
              className="h-9 rounded-lg border-slate-200 bg-white"
            />
            <select
              value={bidQaFilters.reviewStatus}
              onChange={(event) =>
                updateBidQaFilters((current) => ({ ...current, reviewStatus: event.target.value as BidQaFilters["reviewStatus"] }))
              }
              aria-label={t("admin.status")}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
            >
              <option value="all">{t("admin.allReviewStatuses")}</option>
              {(["unreviewed", "needs_review", "reviewed", "suppressed"] as AdminBidQaReviewStatus[]).map((status) => (
                <option key={status} value={status}>{reviewStatusLabel(t, status)}</option>
              ))}
            </select>
            <select
              value={bidQaFilters.displayStatus}
              onChange={(event) =>
                updateBidQaFilters((current) => ({ ...current, displayStatus: event.target.value as BidQaFilters["displayStatus"] }))
              }
              aria-label={t("admin.displayStatus")}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
            >
              <option value="all">{t("admin.allDisplayStatuses")}</option>
              {(["pending_qa", "published", "suppressed"] as AdminBidQaDisplayStatus[]).map((status) => (
                <option key={status} value={status}>{displayStatusLabel(t, status)}</option>
              ))}
            </select>
            <select
              value={bidQaFilters.sourceConfidence}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, sourceConfidence: event.target.value }))}
              aria-label={t("admin.sourceConfidence")}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
            >
              <option value="all">{t("admin.allConfidence")}</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
            <Input
              type="number"
              min="0"
              max="100"
              value={bidQaFilters.minQualityScore}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, minQualityScore: event.target.value }))}
              placeholder={t("admin.minScore")}
              className="h-9 rounded-lg border-slate-200 bg-white"
            />
            <Input
              type="number"
              min="0"
              max="100"
              value={bidQaFilters.maxQualityScore}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, maxQualityScore: event.target.value }))}
              placeholder={t("admin.maxScore")}
              className="h-9 rounded-lg border-slate-200 bg-white"
            />
            <Input
              value={bidQaFilters.reviewerId}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, reviewerId: event.target.value }))}
              placeholder={t("admin.reviewer")}
              className="h-9 rounded-lg border-slate-200 bg-white"
            />
            <Input
              type="date"
              value={bidQaFilters.reviewedFrom}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, reviewedFrom: event.target.value }))}
              aria-label={t("admin.reviewedFrom")}
              className="h-9 rounded-lg border-slate-200 bg-white"
            />
            <Input
              type="date"
              value={bidQaFilters.reviewedTo}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, reviewedTo: event.target.value }))}
              aria-label={t("admin.reviewedTo")}
              className="h-9 rounded-lg border-slate-200 bg-white"
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => updateBidQaFilters(() => DEFAULT_BID_QA_FILTERS)}
              className="h-9 rounded-lg px-3 text-slate-600"
            >
              {t("admin.clearAuditFilters")}
            </Button>
          </div>
          {canRunOperations && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="text-sm font-medium text-slate-600">
                {t("admin.selectedQaItems").replace("{count}", String(visibleSelectedBidQaIds.length))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={pendingBidQaBatch || visibleSelectedBidQaIds.length === 0} onClick={() => batchReviewBidQa("reviewed")} className="h-8 rounded-lg border-slate-200 px-2">
                  {t("admin.batchReview")}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={pendingBidQaBatch || visibleSelectedBidQaIds.length === 0} onClick={() => batchReviewBidQa("needs_review")} className="h-8 rounded-lg border-slate-200 px-2">
                  {t("admin.batchNeedsReview")}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={pendingBidQaBatch || visibleSelectedBidQaIds.length === 0} onClick={() => batchDisplayBidQa("published")} className="h-8 rounded-lg border-slate-200 px-2">
                  {t("admin.batchPublish")}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={pendingBidQaBatch || visibleSelectedBidQaIds.length === 0} onClick={() => batchDisplayBidQa("suppressed")} className="h-8 rounded-lg px-2 text-slate-600">
                  {t("admin.batchSuppress")}
                </Button>
              </div>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                {canRunOperations && (
                  <TableHead>
                    <input
                      type="checkbox"
                      checked={allVisibleBidQaSelected}
                      onChange={toggleAllVisibleBidQa}
                      aria-label={t("admin.selectAllQaItems")}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </TableHead>
                )}
                <TableHead>{t("admin.bid")}</TableHead>
                <TableHead>{t("admin.source")}</TableHead>
                <TableHead>{t("admin.qualityScore")}</TableHead>
                <TableHead>{t("admin.archiveIssues")}</TableHead>
                <TableHead>{t("admin.correctionCount")}</TableHead>
                <TableHead>{t("admin.status")}</TableHead>
                <TableHead>{t("admin.displayStatus")}</TableHead>
                <TableHead>{t("bid.deadline")}</TableHead>
                {canRunOperations && <TableHead className="text-right">{t("admin.review")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {bidQaItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canRunOperations ? 10 : 8} className="py-6 text-center text-sm text-slate-500">
                    {t("admin.noBidQaItems")}
                  </TableCell>
                </TableRow>
              )}
              {bidQaItems.map((item) => {
                const correctionDraft = bidQaCorrectionDraftFor(item, correctionDrafts);
                const corrections = bidQaCorrectionsFor(item, correctionDraft);
                const isPending = pendingBidQaId === item.id;

                return (
                  <TableRow key={item.id}>
                    {canRunOperations && (
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedBidQaIds.includes(item.id)}
                          onChange={() => toggleSelectedBidQaId(item.id)}
                          aria-label={t("admin.selectQaItem").replace("{title}", item.title)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="max-w-80 truncate font-medium text-slate-900" title={item.title}>
                        {item.title}
                      </div>
                      {canRunOperations && (
                        <div className="mt-2 grid max-w-80 gap-2">
                          <Input
                            value={correctionDraft.title}
                            onChange={(event) =>
                              setCorrectionDrafts((current) => ({
                                ...current,
                                [item.id]: {
                                  ...bidQaCorrectionDraftFor(item, current),
                                  title: event.target.value,
                                },
                              }))
                            }
                            aria-label={`${t("admin.bid")} ${t("admin.saveCorrections")}`}
                            className="h-8 rounded-lg border-slate-200 bg-white text-xs"
                          />
                          <Input
                            type="date"
                            value={correctionDraft.deadlineDate}
                            onChange={(event) =>
                              setCorrectionDrafts((current) => ({
                                ...current,
                                [item.id]: {
                                  ...bidQaCorrectionDraftFor(item, current),
                                  deadlineDate: event.target.value,
                                },
                              }))
                            }
                            aria-invalid={isUnreadableDateInput(correctionDraft.deadlineDate) || undefined}
                            aria-label={`${t("bid.deadline")} ${t("admin.saveCorrections")}`}
                            className="h-8 rounded-lg border-slate-200 bg-white text-xs"
                          />
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {item.qualityFlags.slice(0, 3).map((flag) => (
                          <Badge key={flag} variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                            {flag}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-slate-700">{item.source}</div>
                      <div className="text-xs text-slate-500">{item.stateCode}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={qualityTone(item.qualityScore)}>
                        {item.qualityScore}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className={item.archiveIssueCount > 0 ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>
                          {item.archiveIssueCount}
                        </Badge>
                        {item.detailArchiveError && (
                          <span className="max-w-44 truncate text-xs text-rose-700" title={item.detailArchiveError}>
                            {compactErrorMessage(item.detailArchiveError)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={item.correctionCount > 0 ? "border-sky-200 bg-sky-50 text-sky-700" : "border-slate-200 bg-slate-50 text-slate-600"}>
                        {item.correctionCount}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={reviewTone(item.adminReviewStatus)}>
                        {reviewStatusLabel(t, item.adminReviewStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={displayStatusTone(item.displayStatus)}>
                        {displayStatusLabel(t, item.displayStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatBidDate(item.deadlineDate)}</TableCell>
                    {canRunOperations && (
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => loadCorrectionHistory(item)}
                            disabled={isLoadingCorrectionHistory && correctionHistoryBidId === item.id}
                            className="h-8 rounded-lg border-slate-200 px-2"
                          >
                            {t("admin.correctionHistory")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => saveBidQaCorrections(item)}
                            disabled={isPending || correctionDraft.title.trim().length === 0 || corrections === null}
                            className="h-8 rounded-lg border-slate-200 px-2"
                          >
                            {t("admin.saveCorrections")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => updateBidQaDisplayStatus(item, "published")}
                            disabled={isPending || item.displayStatus === "published"}
                            className="h-8 rounded-lg border-slate-200 px-2"
                          >
                            {t("admin.publishBid")}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => updateBidQaDisplayStatus(item, "suppressed")}
                            disabled={isPending || item.displayStatus === "suppressed"}
                            className="h-8 rounded-lg px-2 text-slate-600"
                          >
                            {t("admin.suppressBid")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => updateBidQaStatus(item, "reviewed")}
                            disabled={isPending}
                            className="h-8 rounded-lg border-slate-200 px-2"
                          >
                            {t("admin.markReviewed")}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => updateBidQaStatus(item, "needs_review")}
                            disabled={isPending}
                            className="h-8 rounded-lg px-2 text-slate-600"
                          >
                            {t("admin.markNeedsReview")}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {correctionHistoryBidId && (
            <div className="border-t border-slate-100 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-950">{t("admin.correctionHistory")}</div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setCorrectionHistoryBidId(null)} className="h-8 rounded-lg px-2 text-slate-600">
                  {t("admin.close")}
                </Button>
              </div>
              {isLoadingCorrectionHistory ? (
                <div className="mt-3 text-sm text-slate-500">{t("admin.loading")}</div>
              ) : correctionHistoryItems.length === 0 ? (
                <div className="mt-3 text-sm text-slate-500">{t("admin.noCorrectionHistory")}</div>
              ) : (
                <div className="mt-3 grid gap-2">
                  {correctionHistoryItems.map((correction) => (
                    <div key={correction.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">{correction.fieldName}</span>
                        <span className="text-xs text-slate-500">{formatDate(correction.correctedAt)}</span>
                        <span className="text-xs text-slate-500">{correction.correctedBy}</span>
                      </div>
                      <div className="mt-1 grid gap-1 text-xs text-slate-600 md:grid-cols-2">
                        <div>{t("admin.originalValue")}: {correction.originalValue ?? "-"}</div>
                        <div>{t("admin.correctedValue")}: {correction.correctedValue ?? "-"}</div>
                      </div>
                      {correction.note && <div className="mt-1 text-xs text-slate-500">{correction.note}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
