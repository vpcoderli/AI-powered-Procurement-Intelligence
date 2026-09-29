import type { AdminCrawlerLog } from "@/lib/api/admin";

/**
 * A timestamp as month, day and time in the viewer's zone. It never throws: Intl's format() raises a RangeError on
 * an Invalid Date, and one such value takes the whole page down, so a value that is not a date (a portal's own
 * text, an epoch written as a string) is printed as stored, trimmed, and a missing or blank one as "-".
 *
 * This is for moments (created, started, checked). A calendar day has no time and no zone: print a bid's
 * published or deadline value with formatBidDate and a review date with platformReviewDateLabel instead.
 */
export function formatDate(value: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value).trim() || "-";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DAY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
/** The last second of a UTC day, as endOfDayIsoFromDateInput writes it (`.000`; `.999` is a JavaScript end of day). */
const END_OF_DAY_UTC = /^(\d{4}-\d{2}-\d{2})T23:59:59(?:\.(?:000|999))?(?:Z|[+-]00:?00)$/;

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

/** The moment an ISO timestamp names (a space may stand for the "T"); null for any other text, even one Date could read. */
function isoTimestamp(text: string): Date | null {
  if (!ISO_TIMESTAMP.test(text)) return null;
  const moment = new Date(text.replace(" ", "T"));
  return Number.isFinite(moment.getTime()) ? moment : null;
}

/**
 * The calendar day of a timestamp stored as the last second of that day in UTC, which is how a corrected deadline or
 * an override expiry is saved for a picked day (endOfDayIsoFromDateInput); null for any other text.
 */
function endOfDayUtcDay(text: string): Date | null {
  const end = END_OF_DAY_UTC.exec(text);
  return end ? calendarDay(end[1]) : null;
}

/**
 * A bid's published or deadline value, as the crawlers or an admin's correction stored it: a calendar day
 * (`YYYY-MM-DD`, or the US portals' `M/D/YYYY`), a timestamp, or the portal's own text. A calendar day is printed
 * as that day, never shifted into the viewer's time zone and never given a midnight time. So is a timestamp at
 * 23:59:59 UTC, which is how a corrected deadline is saved for the picked day. Any other ISO timestamp goes
 * through formatDate; anything else is printed as stored rather than guessed at.
 */
export function formatBidDate(value: string | null) {
  const text = value?.trim();
  if (!text) return "-";

  const day = calendarDay(text) ?? endOfDayUtcDay(text);
  if (day) return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(day);

  return isoTimestamp(text) ? formatDate(text.replace(" ", "T")) : text;
}

/**
 * What a date `<input>` takes for a stored date (a bid's deadline, an override's expiry). A calendar day (`YYYY-MM-DD`,
 * or the US portals' `M/D/YYYY`) is exactly that day, never moved by the viewer's time zone. An ISO timestamp is its
 * UTC date, which for a corrected deadline or an expiry (saved as 23:59:59 UTC) is the day that was picked. Anything
 * else, the portals' own text included, gives "" rather than a guess.
 */
export function formatDateInputValue(value: string | null) {
  const text = value?.trim();
  if (!text) return "";

  const day = calendarDay(text);
  if (day) return day.toISOString().slice(0, 10);

  return isoTimestamp(text)?.toISOString().slice(0, 10) ?? "";
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

/** Splits a text into what a reader sees as characters (grapheme clusters), or into code points where the runtime cannot. */
const graphemes = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

function* characters(text: string): Generator<string> {
  if (!graphemes) {
    yield* text;
    return;
  }
  for (const { segment } of graphemes.segment(text)) yield segment;
}

/**
 * A long text's first `limit` characters followed by "…", or null when the text is not longer than that and is to
 * be shown whole. A character is what a reader sees, so the cut never splits an emoji, a surrogate pair or a letter
 * from its accent; whitespace the cut leaves at the end is dropped before the "…". Only the first `limit` + 1
 * characters are read, however long the text.
 */
export function textPreview(text: string, limit: number): string | null {
  // Every character is at least one UTF-16 unit, so a text this short has no more than `limit` characters.
  if (text.length <= limit) return null;
  let end = 0;
  let count = 0;
  for (const character of characters(text)) {
    if (count === limit) return `${text.slice(0, end).trimEnd()}…`;
    end += character.length;
    count += 1;
  }
  return null;
}

export function fallbackMessage(log: AdminCrawlerLog | null | undefined) {
  if (!log?.fallbackSource) return null;

  return log.fallbackReason ? compactErrorMessage(log.fallbackReason) : null;
}
