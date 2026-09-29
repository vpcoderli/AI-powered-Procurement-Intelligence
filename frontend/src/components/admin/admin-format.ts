import type { AdminCrawlerLog } from "@/lib/api/admin";

export function formatDate(value: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DAY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** The calendar day a `YYYY-MM-DD` or `M/D/YYYY` value names, as midnight UTC; null for anything else or an impossible day. */
function calendarDay(text: string): Date | null {
  const iso = ISO_DAY.exec(text);
  const us = US_DAY.exec(text);
  const parts = iso ? [iso[1], iso[2], iso[3]] : us ? [us[3], us[1], us[2]] : null;
  if (!parts) return null;
  const [year, month, day] = parts.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rolls an impossible day over (2026-02-31 would be March 3), so such a value is not a day.
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

/**
 * A bid's published or deadline value, as the crawlers stored it: a calendar day (`YYYY-MM-DD`, or the US
 * portals' `M/D/YYYY`), a timestamp, or the portal's own text. A calendar day is printed as that day, never
 * shifted into the viewer's time zone and never given a midnight time; an ISO timestamp goes through
 * formatDate; anything else is printed as stored rather than guessed at.
 */
export function formatBidDate(value: string | null) {
  const text = value?.trim();
  if (!text) return "-";

  const day = calendarDay(text);
  if (day) return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(day);

  if (ISO_TIMESTAMP.test(text)) {
    const normalized = text.replace(" ", "T");
    if (Number.isFinite(new Date(normalized).getTime())) return formatDate(normalized);
  }
  return text;
}

export function formatDateInputValue(value: string | null) {
  if (!value) return "";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";

  return date.toISOString().slice(0, 10);
}

/** A yyyy-mm-dd input value as the last second of that day in UTC (override expiry, QA deadline). */
export function endOfDayIsoFromDateInput(value: string) {
  if (!value) return null;

  const date = new Date(`${value}T23:59:59.000Z`);
  if (!Number.isFinite(date.getTime())) return null;

  return date.toISOString();
}

export function statusTone(status: string | null | undefined) {
  if (status === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "running" || status === "locked") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status) return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function compactErrorMessage(message: string) {
  return message.length > 96 ? `${message.slice(0, 93)}...` : message;
}

export function fallbackMessage(log: AdminCrawlerLog | null | undefined) {
  if (!log?.fallbackSource) return null;

  return log.fallbackReason ? compactErrorMessage(log.fallbackReason) : null;
}
