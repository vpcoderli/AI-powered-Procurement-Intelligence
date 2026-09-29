import { describe, expect, it } from "vitest";
import {
  compactErrorMessage,
  endOfDayIsoFromDateInput,
  fallbackMessage,
  formatBidDate,
  formatDate,
  formatDateInputValue,
  statusTone,
} from "./admin-format";

/** A calendar day as the console prints one: month, day and year of that day, whatever the viewer's zone. */
const calendarDay = (year: number, month: number, day: number) =>
  new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));

describe("bid dates", () => {
  it("prints a calendar day as that day, a timestamp like formatDate, and anything else as stored", () => {
    expect(formatBidDate("2026-09-01")).toBe(calendarDay(2026, 9, 1));
    // BidNet and most state portals store M/D/YYYY.
    expect(formatBidDate("09/01/2026")).toBe(calendarDay(2026, 9, 1));
    expect(formatBidDate("9/1/2026")).toBe(calendarDay(2026, 9, 1));
    expect(formatBidDate(" 2026-09-01 ")).toBe(calendarDay(2026, 9, 1));
    expect(formatBidDate("2026-09-28T12:52:06.313Z")).toBe(formatDate("2026-09-28T12:52:06.313Z"));
    expect(formatBidDate("2026-07-08T20:12:00.000+00:00")).toBe(formatDate("2026-07-08T20:12:00.000+00:00"));
    expect(formatBidDate("2026-09-30 20:00:00")).toBe(formatDate("2026-09-30T20:00:00"));
    // The portals' own text, an epoch, a two-digit year and impossible days are not guessed at.
    for (const raw of ["Aug 31, 2026 @ 02:00 PM", "1788984000000", "10/02/26", "10/12/2026 3:30:00PM EST", "2026-02-31", "13/01/2026", "TBD"]) {
      expect(formatBidDate(raw), raw).toBe(raw);
    }
    expect(formatBidDate(null)).toBe("-");
    expect(formatBidDate("  ")).toBe("-");
  });

  it("never moves a calendar day into the day before or after, whatever the viewer's time zone", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Honolulu";
      // What reading the day as a UTC instant would print west of UTC: the day before.
      expect(new Date("2026-09-01").getDate()).toBe(31);
      for (const zone of ["Pacific/Honolulu", "America/Los_Angeles", "UTC", "Asia/Shanghai", "Pacific/Kiritimati"]) {
        process.env.TZ = zone;
        expect(formatBidDate("2026-09-01"), zone).toBe(calendarDay(2026, 9, 1));
        expect(formatBidDate("09/01/2026"), zone).toBe(calendarDay(2026, 9, 1));
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});

describe("admin formatters", () => {
  it("formats dates and date inputs", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDateInputValue(null)).toBe("");
    expect(formatDateInputValue("not a date")).toBe("");
    expect(formatDateInputValue("2026-09-29T10:00:00.000Z")).toBe("2026-09-29");
    expect(endOfDayIsoFromDateInput("2026-09-29")).toBe("2026-09-29T23:59:59.000Z");
    expect(endOfDayIsoFromDateInput("")).toBeNull();
    expect(endOfDayIsoFromDateInput("2026-13-45")).toBeNull();
  });

  it("maps a run status to a tone", () => {
    expect(statusTone("success")).toContain("emerald");
    expect(statusTone("running")).toContain("sky");
    expect(statusTone("locked")).toContain("sky");
    expect(statusTone("failure")).toContain("rose");
    expect(statusTone(null)).toContain("slate");
  });

  it("shortens long messages and reads a log's fallback reason", () => {
    expect(compactErrorMessage("x".repeat(96))).toBe("x".repeat(96));
    expect(compactErrorMessage("x".repeat(97))).toBe(`${"x".repeat(93)}...`);
    expect(fallbackMessage(null)).toBeNull();
    expect(fallbackMessage({ fallbackSource: "fixture", fallbackReason: "portal down" } as never)).toBe("portal down");
    expect(fallbackMessage({ fallbackSource: null, fallbackReason: "ignored" } as never)).toBeNull();
  });
});
