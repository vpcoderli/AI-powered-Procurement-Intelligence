import { describe, expect, it } from "vitest";
import {
  compactErrorMessage,
  endOfDayIsoFromDateInput,
  fallbackMessage,
  formatBidDate,
  formatDate,
  formatDateInputValue,
  statusTone,
  textPreview,
} from "./admin-format";

/** True when the text has a UTF-16 surrogate without its partner: half of an emoji or other astral character. */
const hasHalfCharacter = (text: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

describe("textPreview", () => {
  it("leaves a text of at most the limit alone", () => {
    expect(textPreview("", 300)).toBeNull();
    expect(textPreview("Portal answered 403", 300)).toBeNull();
    expect(textPreview("a".repeat(300), 300)).toBeNull();
  });

  it("cuts a longer text after the limit and marks the cut", () => {
    expect(textPreview("a".repeat(301), 300)).toBe(`${"a".repeat(300)}…`);
    expect(textPreview("abcdef", 3)).toBe("abc…");
  });

  it("cuts a 45,000-character HTML error down to its opening", () => {
    const page = `HTML request failed with status 404: <!DOCTYPE html>\n<html lang="en">\n\t<head>\n${"\t\t<meta content=\"text/html\" />\n".repeat(1600)}`;
    const preview = textPreview(page, 300);

    expect(page.length).toBeGreaterThan(45_000);
    expect(preview).not.toBeNull();
    expect(preview!.startsWith("HTML request failed with status 404: <!DOCTYPE html>")).toBe(true);
    expect(preview!.endsWith("…")).toBe(true);
    expect(preview!.length).toBeLessThanOrEqual(301);
  });

  it("drops the whitespace the cut leaves before the mark", () => {
    expect(textPreview(`${"x".repeat(9)}  \n\tmore text`, 11)).toBe(`${"x".repeat(9)}…`);
  });

  it("never splits an emoji, a joined emoji sequence, an accented letter or a CJK character", () => {
    const emoji = textPreview("😀".repeat(301), 300);
    expect(emoji).toBe(`${"😀".repeat(300)}…`);
    expect(hasHalfCharacter(emoji!)).toBe(false);

    // A family emoji is five code points joined into one character; the cut keeps it whole or leaves it out.
    const family = "👨‍👩‍👧";
    expect(textPreview(`${"a".repeat(299)}${family}b`, 300)).toBe(`${"a".repeat(299)}${family}…`);
    expect(textPreview(`${"a".repeat(300)}${family}`, 300)).toBe(`${"a".repeat(300)}…`);

    // "é" written as e + a combining accent is one character.
    expect(textPreview(`${"é".repeat(4)}`, 3)).toBe(`${"é".repeat(3)}…`);
    expect(textPreview("错误信息".repeat(100), 300)).toBe(`${"错误信息".repeat(75)}…`);
  });

  it("counts characters, not UTF-16 units: 200 emoji are under a 300-character limit", () => {
    expect("😀".repeat(200).length).toBe(400);
    expect(textPreview("😀".repeat(200), 300)).toBeNull();
  });
});

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

/** A timestamp as formatDate prints it: month, day and time in the viewer's zone and locale, and no year. */
const timestampLabel = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

describe("formatDate", () => {
  it("formats a valid timestamp as month, day and time, as it always has", () => {
    for (const iso of ["2026-09-28T12:52:06.313Z", "2026-07-08T20:12:00.000+00:00", "2027-01-15T00:00:00.000Z", "2026-09-30T20:00:00"]) {
      expect(formatDate(iso), iso).toBe(timestampLabel(iso));
    }
  });

  // Intl's format() throws "RangeError: Invalid time value" on an Invalid Date, and one such value took the whole page down.
  // A bid's published or deadline value is the portal's own text, so it can be anything.
  it("returns a value that is not a date as stored, trimmed, instead of throwing", () => {
    for (const raw of ["TBD", "next spring", "13/01/2026", "10/12/2026 3:30:00PM EST", "20260831"]) {
      expect(new Date(raw).getTime(), `${raw} is not a date`).toBeNaN();
      expect(() => formatDate(raw), raw).not.toThrow();
      expect(formatDate(raw), raw).toBe(raw);
    }
    expect(formatDate("  next spring \n")).toBe("next spring");
  });

  it("does not throw on an epoch written as a string, and shows it as stored", () => {
    // Only new Date(1788984000000), the number, reads an epoch; the same digits as a string are an Invalid Date.
    expect(new Date("1788984000000").getTime()).toBeNaN();
    expect(() => formatDate("1788984000000")).not.toThrow();
    expect(formatDate("1788984000000")).toBe("1788984000000");
    expect(formatDate("1788984000")).toBe("1788984000");
  });

  it("never throws, whatever a portal wrote", () => {
    const hostile = [
      "Aug 31, 2026 @ 02:00 PM", "2026-02-31", "2026-13-45", "Invalid Date", "NaN", "undefined", "null", "0", "-1", "\u0000",
      "9".repeat(400), "x".repeat(10_000), "<script>alert(1)</script>", "😀", "２０２６-０９-０１", "+275760-09-13T00:00:01.000Z",
    ];
    for (const raw of hostile) {
      expect(() => formatDate(raw), raw).not.toThrow();
      expect(formatDate(raw), raw).toEqual(expect.any(String));
      expect(formatDate(raw), raw).not.toBe("");
    }
  });

  it("keeps a dash for a value that is missing or blank", () => {
    for (const empty of [null, "", "   ", "\n\t "]) expect(formatDate(empty), JSON.stringify(empty)).toBe("-");
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
