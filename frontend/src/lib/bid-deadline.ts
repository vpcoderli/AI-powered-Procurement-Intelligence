/**
 * Reads the deadline text a portal prints and says when the bid stops being open.
 *
 * Portals print a bare date or a wall clock with no zone ("10/13/2026 2:00 PM CST"), and the zone
 * abbreviation they append cannot be trusted. Everything without an explicit offset is therefore read
 * on one clock, UTC-10 (Hawaii, the last end of day among the US states): a bid is never closed before
 * its own deadline in any US zone, and a date-only deadline is good through the end of that day.
 * A deadline with an explicit `Z` or offset is exact. Text that is not a plausible date reads as
 * `null`, and a deadline we cannot read never expires a bid.
 *
 * Pure: no clock, no string-to-Date parsing, no dependence on the server's time zone.
 */

/** Minutes the deadline zone is ahead of UTC (UTC-10). An offsetless wall clock W is the instant W - offset. */
export const DEADLINE_ZONE_OFFSET_MINUTES = -600;

export interface ParsedBidDeadline {
  /** The deadline instant; for a date-only deadline, the start of that day in the deadline zone. */
  instantMs: number;
  dateOnly: boolean;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Longest text a deadline can be; it bounds the work the patterns below can be made to do. */
const MAX_DEADLINE_TEXT_LENGTH = 64;
/** The range of instants a Date can hold. */
const MAX_DATE_MS = 8.64e15;
/** A bare epoch number is a deadline only when it lands in these years (inclusive). */
const MIN_EPOCH_YEAR = 2000;
const MAX_EPOCH_YEAR = 2100;
const MONTH_PREFIXES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const DOT_NET_DATE = /^\/Date\((-?\d+)\)\/$/;
const EPOCH_MILLISECONDS = /^\d{13}$/;
const EPOCH_SECONDS = /^\d{10}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;
const US_NUMERIC = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?(?:\s+[A-Za-z]{1,5})?$/;
const MONTH_NAME = /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s*@?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?(?:\s+[a-z]{1,5})?$/i;

interface Clock {
  hour: number;
  minute: number;
  second: number;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** `Date.UTC`, except that years 0-99 stay years 0-99 instead of becoming 1900-1999. */
function utcMs(year: number, month: number, day: number, clock: Clock | null): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(clock?.hour ?? 0, clock?.minute ?? 0, clock?.second ?? 0, 0);
  return date.getTime();
}

/** A valid time of day, or null. With a meridiem the hour is 1-12 (12 AM is hour 0, 12 PM hour 12), else 0-23. */
function readClock(hourText: string, minuteText: string, secondText: string | undefined, meridiem: string | undefined): Clock | null {
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = secondText === undefined ? 0 : Number(secondText);
  if (minute > 59 || second > 59) return null;
  if (meridiem === undefined) return hour <= 23 ? { hour, minute, second } : null;
  if (hour < 1 || hour > 12) return null;
  return { hour: (hour % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0), minute, second };
}

/** The deadline for a calendar day (and time of day, when there is one) read on a clock `zoneOffsetMinutes` ahead of UTC. */
function fromCalendar(year: number, month: number, day: number, clock: Clock | null, zoneOffsetMinutes: number): ParsedBidDeadline | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { instantMs: utcMs(year, month, day, clock) - zoneOffsetMinutes * MINUTE_MS, dateOnly: clock === null };
}

function fromEpoch(instantMs: number, plausibleYearsOnly: boolean): ParsedBidDeadline | null {
  if (!Number.isFinite(instantMs) || Math.abs(instantMs) > MAX_DATE_MS) return null;
  if (plausibleYearsOnly) {
    const year = new Date(instantMs).getUTCFullYear();
    if (year < MIN_EPOCH_YEAR || year > MAX_EPOCH_YEAR) return null;
  }
  return { instantMs, dateOnly: false };
}

function parseEpoch(value: string): ParsedBidDeadline | null {
  const dotNet = DOT_NET_DATE.exec(value);
  if (dotNet) return fromEpoch(Number(dotNet[1]), false);
  if (EPOCH_MILLISECONDS.test(value)) return fromEpoch(Number(value), true);
  if (EPOCH_SECONDS.test(value)) return fromEpoch(Number(value) * 1000, true);
  return null;
}

/** Minutes ahead of UTC for `Z`, `+HH:MM`, `-HHMM` and the like; null for an offset no clock has. */
function zoneOffsetMinutes(zone: string): number | null {
  if (zone === "Z") return 0;
  const hours = Number(zone.slice(1, 3));
  const minutes = Number(zone.slice(-2));
  if (hours > 23 || minutes > 59) return null;
  return (zone.startsWith("-") ? -1 : 1) * (hours * 60 + minutes);
}

function parseIso(value: string): ParsedBidDeadline | null {
  const dateOnly = ISO_DATE.exec(value);
  if (dateOnly) return fromCalendar(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), null, DEADLINE_ZONE_OFFSET_MINUTES);
  const dateTime = ISO_DATE_TIME.exec(value);
  if (!dateTime) return null;
  const clock = readClock(dateTime[4], dateTime[5], dateTime[6], undefined);
  const offset = dateTime[7] === undefined ? DEADLINE_ZONE_OFFSET_MINUTES : zoneOffsetMinutes(dateTime[7]);
  if (!clock || offset === null) return null;
  return fromCalendar(Number(dateTime[1]), Number(dateTime[2]), Number(dateTime[3]), clock, offset);
}

function parseUsNumeric(value: string): ParsedBidDeadline | null {
  const match = US_NUMERIC.exec(value);
  if (!match) return null;
  const clock = match[4] === undefined ? null : readClock(match[4], match[5], match[6], match[7]);
  if (match[4] !== undefined && !clock) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  // A trailing zone abbreviation (CST, PDT, ET) is accepted and ignored: the time is a UTC-10 wall clock.
  return fromCalendar(year, Number(match[1]), Number(match[2]), clock, DEADLINE_ZONE_OFFSET_MINUTES);
}

function parseMonthName(value: string): ParsedBidDeadline | null {
  const match = MONTH_NAME.exec(value);
  if (!match) return null;
  const clock = match[4] === undefined ? null : readClock(match[4], match[5], match[6], match[7]);
  if (match[4] !== undefined && !clock) return null;
  const month = MONTH_PREFIXES.indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
  return fromCalendar(Number(match[3]), month, Number(match[2]), clock, DEADLINE_ZONE_OFFSET_MINUTES);
}

/** The instant a deadline text names, or null when it is blank or not a date this module can read. */
export function parseBidDeadline(text: string | null | undefined): ParsedBidDeadline | null {
  if (typeof text !== "string") return null;
  const value = text.trim();
  if (!value || value.length > MAX_DEADLINE_TEXT_LENGTH) return null;
  return parseEpoch(value) ?? parseIso(value) ?? parseUsNumeric(value) ?? parseMonthName(value);
}

/** Instant (ms) from which the bid counts as expired; null when unparseable. A date-only deadline is good through its whole day. */
export function bidDeadlineExpiresAtMs(text: string | null | undefined): number | null {
  const parsed = parseBidDeadline(text);
  if (!parsed) return null;
  return parsed.dateOnly ? parsed.instantMs + DAY_MS : parsed.instantMs;
}

/** True once `nowMs` has reached the deadline's expiry; a deadline that cannot be read has not passed. */
export function bidDeadlinePassed(text: string | null | undefined, nowMs: number): boolean {
  const expiresAt = bidDeadlineExpiresAtMs(text);
  return expiresAt !== null && nowMs >= expiresAt;
}
