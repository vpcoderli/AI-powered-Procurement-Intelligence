/**
 * Reads the deadline text a portal prints and says when the bid stops being open.
 *
 * Portals print a bare date or a wall clock with no zone ("10/13/2026 2:00 PM CST"), and the zone
 * abbreviation they append cannot be trusted. Everything without an explicit offset is therefore read
 * on one clock, UTC-10 (Hawaii, the last end of day among the US states): a bid is never closed before
 * its own deadline in any US zone, and a date-only deadline is good through the end of that day.
 * A deadline with an explicit `Z` or offset is exact. Text that is not a plausible date reads as
 * `null`, and a deadline we cannot read never expires a bid. That includes every instant outside the
 * years 2000 to 2100: the dates portals print for "no date" (0001-01-01, 1970-01-01, .NET's
 * /Date(-62135596800000)/) are placeholders, and closing a bid on one would hide a bid that may be open.
 *
 * Where the text can be read more than one way, the bid stays open until the latest reading: closing a bid
 * late is acceptable, closing it early is not. `parseBidDeadline` gives the literal reading;
 * `bidDeadlineExpiresAtMs` and `bidDeadlinePassed` give the latest one:
 *
 * - A date-only deadline is good through the end of its day, the next midnight in UTC-10.
 * - A time of exactly midnight (00:00 with seconds 0, written 0:00, 00:00, 00:00:00, 12:00 AM or 12:00:00 AM)
 *   is how many portals write a date-only deadline, so it expires like one, at the end of its stated day, in
 *   every form but the epoch ones. For an ISO time with a `Z` or an offset the stated day is the date as
 *   written, not the date in UTC. Read as the start of that day, the bid would close up to a day early
 *   (34 hours early for `2026-10-13T00:00:00Z`).
 * - In the US numeric and month-name forms a time with no AM/PM ("10/13/2026 2:00", "Oct 13, 2026 at 12:00")
 *   may come from a 12-hour portal that dropped it. An hour from 1 to 11 is held open to its PM reading,
 *   twelve hours later. A bare 12:00 (seconds 0) may be 12:00 AM, a midnight, so it is good through its stated
 *   day like one rather than only to noon. Hour 12 with minutes or seconds is latest as written (as an AM hour
 *   it would be twelve hours earlier), and hour 0 and hours 13 to 23 are not hours of a 12-hour clock. A lone
 *   "A" or "P" after the time is read as a zone word and ignored, which covers it: every reading of it as an
 *   AM or PM is one of those already allowed for.
 * - A time with an AM/PM is taken as it says (12:00 PM is noon); ISO times are 24-hour, and epoch numbers exact.
 * - The literal reading of an ISO time leaves out a fraction of a second; the expiry keeps it, rounded up to the
 *   millisecond, so the bid is never closed before the instant the text states.
 *
 * Pure: no clock, no string-to-Date parsing, no dependence on the server's time zone.
 */

/** Minutes the deadline zone is ahead of UTC (UTC-10). An offsetless wall clock W is the instant W - offset. */
export const DEADLINE_ZONE_OFFSET_MINUTES = -600;

export interface ParsedBidDeadline {
  /** The deadline instant as the text reads literally; for a date-only deadline, the start of that day in the deadline zone. */
  instantMs: number;
  dateOnly: boolean;
}

/** A deadline as read from its text, with how long past its instant the bid stays open. Not exported: callers see `ParsedBidDeadline`. */
interface BidDeadlineReading extends ParsedBidDeadline {
  /**
   * Milliseconds after `instantMs` before the bid counts as expired, so that the expiry is the latest reading of the text:
   * up to the end of the stated day for a date-only deadline, a time of exactly midnight, or a bare 12:00 written without
   * an AM/PM (it may be 12:00 AM); twelve hours for an hour from 1 to 11 written without an AM/PM (it may be a PM hour);
   * the fraction of a second the literal reading of an ISO time leaves out; none otherwise.
   */
  graceMs: number;
}

/** What a written time may mean besides its literal reading, as far as it moves the expiry later. */
interface Leeway {
  /** A bare 12:00 with no AM/PM, which may be 12:00 AM: a midnight, good through the stated day. */
  mayBeMidnight?: boolean;
  /** An hour from 1 to 11 with no AM/PM, which may be a PM hour, twelve hours later. */
  mayBePm?: boolean;
  /** Milliseconds of the stated instant that the literal reading leaves out (an ISO fraction of a second, rounded up). */
  droppedMs?: number;
}

const MINUTE_MS = 60_000;
const HALF_DAY_MS = 43_200_000;
/** Longest text a deadline can be; it bounds the work the patterns below can be made to do. */
const MAX_DEADLINE_TEXT_LENGTH = 64;
/** A deadline lies in these years (the UTC year of its instant, inclusive); a date outside them is a placeholder or a typo. */
const MIN_DEADLINE_YEAR = 2000;
const MAX_DEADLINE_YEAR = 2100;
const MONTH_PREFIXES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const DOT_NET_DATE = /^\/Date\((-?\d+)\)\/$/;
const EPOCH_MILLISECONDS = /^\d{13}$/;
const EPOCH_SECONDS = /^\d{10}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// The brief's pattern, with the fraction of a second captured (group 7) so that the expiry can keep it.
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;
// In both patterns below the AM/PM is matched first, and a zone abbreviation may follow it directly ("2:00 PMCST");
// a zone set off by a space must not itself start with AM or PM, or "2:00 PMCST" could be read as 02:00 plus a zone "PMCST".
// In both, the time may be introduced by "at" or "@" ("7/7/2026 at 1:30PM", "Aug 21, 2026 at 2:00 PM").
const US_NUMERIC = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:\s+(?:[Aa][Tt]\s+|@\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([AaPp][Mm])(?:(?![AaPp][Mm])[A-Za-z]{1,5})?)?)?(?:\s+(?![AaPp][Mm])[A-Za-z]{1,5})?$/;
const MONTH_NAME = /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(\d{4})(?:(?:\s*@?\s*|\s+at\s+)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([ap]m)(?:(?![ap]m)[a-z]{1,5})?)?)?(?:\s+(?![ap]m)[a-z]{1,5})?$/i;

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

/**
 * What a time written with no AM/PM (US numeric and month-name forms) may also mean, on a 12-hour clock whose AM/PM a
 * portal dropped. An hour from 1 to 11 may be a PM hour ("2:00" for 2:00 PM), twelve hours later. A bare 12:00 with
 * seconds 0 may be 12:00 AM, a midnight, which stands for the whole stated day. Hour 12 with minutes or seconds is latest
 * as written (12:30 as 12:30 AM would be twelve hours earlier), hour 0 and hours 13 to 23 are not hours of a 12-hour
 * clock, and a time that came with an AM/PM says which half of the day it is in.
 */
function missingMeridiemLeeway(clock: Clock | null, meridiem: string | undefined): Leeway {
  if (clock === null || meridiem !== undefined) return {};
  if (clock.hour >= 1 && clock.hour <= 11) return { mayBePm: true };
  return { mayBeMidnight: clock.hour === 12 && clock.minute === 0 && clock.second === 0 };
}

/** A fraction of a second, as its digits ("5", "250", "9999999"), in milliseconds rounded up: the first whole millisecond at or after it. */
function fractionCeilMs(digits: string | undefined): number {
  if (digits === undefined) return 0;
  const milliseconds = Number(digits.slice(0, 3).padEnd(3, "0"));
  return /[1-9]/.test(digits.slice(3)) ? milliseconds + 1 : milliseconds;
}

/** The end of a calendar day in the deadline zone, which is the start of the next one. */
function endOfDayMs(year: number, month: number, day: number): number {
  return utcMs(year, month, day + 1, null) - DEADLINE_ZONE_OFFSET_MINUTES * MINUTE_MS;
}

/**
 * The deadline for a calendar day (and time of day, when there is one) read on a clock `zoneOffsetMinutes` ahead of UTC.
 * A date-only deadline, a time of exactly 00:00 and a time that may be 12:00 AM are good through their stated day (for a
 * zoned ISO time, the day as written); a time that may be a PM hour, for twelve hours past the literal reading; and an ISO
 * time keeps the fraction of a second its literal reading leaves out.
 */
function fromCalendar(year: number, month: number, day: number, clock: Clock | null, zoneOffsetMinutes: number, leeway: Leeway = {}): BidDeadlineReading | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  const instantMs = utcMs(year, month, day, clock) - zoneOffsetMinutes * MINUTE_MS;
  const midnight = clock !== null && clock.hour === 0 && clock.minute === 0 && clock.second === 0;
  const wholeDay = clock === null || midnight || leeway.mayBeMidnight === true;
  return {
    instantMs,
    dateOnly: clock === null,
    graceMs: wholeDay ? endOfDayMs(year, month, day) - instantMs : leeway.mayBePm === true ? HALF_DAY_MS : leeway.droppedMs ?? 0,
  };
}

function parseEpoch(value: string): BidDeadlineReading | null {
  const dotNet = DOT_NET_DATE.exec(value);
  if (dotNet) return { instantMs: Number(dotNet[1]), dateOnly: false, graceMs: 0 };
  if (EPOCH_MILLISECONDS.test(value)) return { instantMs: Number(value), dateOnly: false, graceMs: 0 };
  if (EPOCH_SECONDS.test(value)) return { instantMs: Number(value) * 1000, dateOnly: false, graceMs: 0 };
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

function parseIso(value: string): BidDeadlineReading | null {
  const dateOnly = ISO_DATE.exec(value);
  if (dateOnly) return fromCalendar(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), null, DEADLINE_ZONE_OFFSET_MINUTES);
  const dateTime = ISO_DATE_TIME.exec(value);
  if (!dateTime) return null;
  const clock = readClock(dateTime[4], dateTime[5], dateTime[6], undefined);
  const offset = dateTime[8] === undefined ? DEADLINE_ZONE_OFFSET_MINUTES : zoneOffsetMinutes(dateTime[8]);
  if (!clock || offset === null) return null;
  // ISO is a 24-hour clock, so its hours have no AM/PM leeway; the literal reading leaves out the fraction of a second.
  return fromCalendar(Number(dateTime[1]), Number(dateTime[2]), Number(dateTime[3]), clock, offset, { droppedMs: fractionCeilMs(dateTime[7]) });
}

function parseUsNumeric(value: string): BidDeadlineReading | null {
  const match = US_NUMERIC.exec(value);
  if (!match) return null;
  const clock = match[4] === undefined ? null : readClock(match[4], match[5], match[6], match[7]);
  if (match[4] !== undefined && !clock) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  // A trailing zone abbreviation (CST, PDT, ET) is accepted and ignored: the time is a UTC-10 wall clock.
  return fromCalendar(year, Number(match[1]), Number(match[2]), clock, DEADLINE_ZONE_OFFSET_MINUTES, missingMeridiemLeeway(clock, match[7]));
}

function parseMonthName(value: string): BidDeadlineReading | null {
  const match = MONTH_NAME.exec(value);
  if (!match) return null;
  const clock = match[4] === undefined ? null : readClock(match[4], match[5], match[6], match[7]);
  if (match[4] !== undefined && !clock) return null;
  const month = MONTH_PREFIXES.indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
  return fromCalendar(Number(match[3]), month, Number(match[2]), clock, DEADLINE_ZONE_OFFSET_MINUTES, missingMeridiemLeeway(clock, match[7]));
}

/** True when the instant's UTC year is one a deadline can be in. An instant no Date can hold has no year, so it is not. */
function inDeadlineYears(instantMs: number): boolean {
  const year = new Date(instantMs).getUTCFullYear();
  return year >= MIN_DEADLINE_YEAR && year <= MAX_DEADLINE_YEAR;
}

/** The deadline a text names, with its grace; null when it is blank, not a date this module can read, or outside the years 2000 to 2100. */
function readBidDeadline(text: string | null | undefined): BidDeadlineReading | null {
  if (typeof text !== "string") return null;
  const value = text.trim();
  if (!value || value.length > MAX_DEADLINE_TEXT_LENGTH) return null;
  const reading = parseEpoch(value) ?? parseIso(value) ?? parseUsNumeric(value) ?? parseMonthName(value);
  // The window is judged on the literal instant, whatever grace the text gets.
  return reading !== null && inDeadlineYears(reading.instantMs) ? reading : null;
}

/**
 * The instant a deadline text names, read literally (an hour with no AM/PM is taken as written, a fraction of a second is
 * left out), or null when it is blank, not a date this module can read, or a date outside the years 2000 to 2100
 * (whatever form it is written in). To ask when a bid expires, use `bidDeadlineExpiresAtMs` or `bidDeadlinePassed`,
 * which take the latest reading of the text.
 */
export function parseBidDeadline(text: string | null | undefined): ParsedBidDeadline | null {
  const reading = readBidDeadline(text);
  return reading === null ? null : { instantMs: reading.instantMs, dateOnly: reading.dateOnly };
}

/**
 * Instant (ms) from which the bid counts as expired, the latest reading of the text; null when unparseable. A date-only
 * deadline, a time of exactly midnight and a bare 12:00 with no AM/PM are good through their whole stated day; an hour
 * from 1 to 11 with no AM/PM is good until its PM reading, twelve hours after the literal one; an ISO time is good until
 * the instant it states, fraction of a second included.
 */
export function bidDeadlineExpiresAtMs(text: string | null | undefined): number | null {
  const reading = readBidDeadline(text);
  return reading === null ? null : reading.instantMs + reading.graceMs;
}

/** True once `nowMs` has reached the deadline's expiry; a deadline that cannot be read has not passed. */
export function bidDeadlinePassed(text: string | null | undefined, nowMs: number): boolean {
  const expiresAt = bidDeadlineExpiresAtMs(text);
  return expiresAt !== null && nowMs >= expiresAt;
}
