import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEADLINE_ZONE_OFFSET_MINUTES,
  bidDeadlineExpiresAtMs,
  bidDeadlinePassed,
  parseBidDeadline,
} from "./bid-deadline";

/** 2026-10-13T12:00:00Z, which is 02:00 on 13 October in the deadline zone (UTC-10). */
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const HOUR_MS = 3_600_000;

describe("deadline zone", () => {
  it("reads portal wall clocks as UTC-10", () => {
    expect(DEADLINE_ZONE_OFFSET_MINUTES).toBe(-600);
  });
});

describe("bidDeadlinePassed", () => {
  it.each([
    ["US date, the day before", "10/12/2026"],
    ["ISO date, the day before", "2026-10-12"],
    ["US date and time exactly at now (02:00 AM in UTC-10)", "10/13/2026 2:00 AM"],
    ["US date with a two-digit year", "05/31/26"],
    ["US date without zero padding", "4/16/2026"],
    ["month name with @ and a 12-hour clock", "Aug 21, 2026 @ 02:00 PM"],
    ["epoch milliseconds", "1761757200000"],
    ["ISO instant a second before now", "2026-10-13T11:59:59Z"],
  ])("has passed: %s (%s)", (_label, text) => {
    expect(bidDeadlinePassed(text, NOW)).toBe(true);
  });

  it.each([
    ["US date of today (expires at the end of the day in UTC-10)", "10/13/2026"],
    ["ISO date of today", "2026-10-13"],
    ["US time that is still ahead in UTC-10, zone abbreviation ignored", "10/13/2026 2:00 PM CST"],
    ["month name in the future", "Dec 1, 2026 @ 10:00 AM"],
    [".NET date in the future", "/Date(1893456000000)/"],
    ["ISO instant a second after now", "2026-10-13T12:00:01Z"],
    ["ISO instant with an explicit offset that is still ahead", "2026-10-13T08:00:00-05:00"],
    ["a far future date", "01/01/2028"],
  ])("has not passed: %s (%s)", (_label, text) => {
    expect(bidDeadlinePassed(text, NOW)).toBe(false);
  });

  it.each([
    "Not Available",
    "TBD",
    "",
    "   ",
    null,
    undefined,
    "02/30/2026",
    "13/01/2026",
    "2026-02-29",
    "10/12/2026 25:00",
    "10/12/2026 13:00 PM",
  ])("never passes an unparseable deadline: %j", (text) => {
    expect(parseBidDeadline(text)).toBeNull();
    expect(bidDeadlineExpiresAtMs(text)).toBeNull();
    expect(bidDeadlinePassed(text, NOW)).toBe(false);
    expect(bidDeadlinePassed(text, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it("accepts a leap day", () => {
    expect(parseBidDeadline("2028-02-29")).toEqual({ instantMs: Date.UTC(2028, 1, 29, 10), dateOnly: true });
  });

  it("passes exactly at the expiry instant and not a millisecond before", () => {
    const expiresAt = bidDeadlineExpiresAtMs("10/13/2026 2:00 AM")!;
    expect(expiresAt).toBe(NOW);
    expect(bidDeadlinePassed("10/13/2026 2:00 AM", expiresAt - 1)).toBe(false);
    expect(bidDeadlinePassed("10/13/2026 2:00 AM", expiresAt)).toBe(true);
  });

  it("treats a NaN clock as not passed", () => {
    expect(bidDeadlinePassed("10/12/2026", Number.NaN)).toBe(false);
  });
});

describe("parseBidDeadline", () => {
  it("returns the start of the day in UTC-10 for a date-only deadline", () => {
    expect(parseBidDeadline("10/12/2026")).toEqual({ instantMs: Date.UTC(2026, 9, 12, 10), dateOnly: true });
    expect(parseBidDeadline("2026-10-12")).toEqual({ instantMs: Date.UTC(2026, 9, 12, 10), dateOnly: true });
    expect(parseBidDeadline("October 12, 2026")).toEqual({ instantMs: Date.UTC(2026, 9, 12, 10), dateOnly: true });
  });

  it("trims the text and ignores a null, undefined or non-text input", () => {
    expect(parseBidDeadline("  10/12/2026\n")).toEqual({ instantMs: Date.UTC(2026, 9, 12, 10), dateOnly: true });
    expect(parseBidDeadline(null)).toBeNull();
    expect(parseBidDeadline(undefined)).toBeNull();
    expect(parseBidDeadline(1761757200000 as unknown as string)).toBeNull();
  });

  describe("epoch forms", () => {
    it("reads /Date(ms)/ as an exact instant", () => {
      expect(parseBidDeadline("/Date(1893456000000)/")).toEqual({ instantMs: 1_893_456_000_000, dateOnly: false });
      expect(parseBidDeadline("/Date(946684800000)/")).toEqual({ instantMs: Date.UTC(2000, 0, 1), dateOnly: false });
    });

    it("reads a 13-digit number as epoch milliseconds and a 10-digit one as epoch seconds", () => {
      expect(parseBidDeadline("1761757200000")).toEqual({ instantMs: 1_761_757_200_000, dateOnly: false });
      expect(parseBidDeadline("1761757200")).toEqual({ instantMs: 1_761_757_200_000, dateOnly: false });
    });

    it("accepts a bare epoch number only when it lands between 2000 and 2100", () => {
      // Zero padding reaches the 2000 boundary: a 10- or 13-digit number without it starts in September 2001.
      expect(parseBidDeadline("0946684800")?.instantMs).toBe(Date.UTC(2000, 0, 1));
      expect(parseBidDeadline("0946684799")).toBeNull();
      expect(parseBidDeadline("0946684800000")?.instantMs).toBe(Date.UTC(2000, 0, 1));
      expect(parseBidDeadline("0946684799999")).toBeNull();
      expect(parseBidDeadline("1000000000")?.instantMs).toBe(Date.UTC(2001, 8, 9, 1, 46, 40));
      expect(parseBidDeadline("4102444799")?.instantMs).toBe(Date.UTC(2099, 11, 31, 23, 59, 59));
      expect(parseBidDeadline("4102444800")?.instantMs).toBe(Date.UTC(2100, 0, 1));
      expect(parseBidDeadline("4133980800")).toBeNull();
      expect(parseBidDeadline("4102444800000")?.instantMs).toBe(Date.UTC(2100, 0, 1));
      expect(parseBidDeadline("4133980800000")).toBeNull();
      expect(parseBidDeadline("946684800000")).toBeNull(); // 12 digits: neither shape
      expect(parseBidDeadline("0000000000")).toBeNull(); // 1970
      expect(parseBidDeadline("0000000000000")).toBeNull(); // 1970
      expect(parseBidDeadline("9999999999")).toBeNull(); // 2286
      expect(parseBidDeadline("9999999999999")).toBeNull(); // 2286
    });

    it("does not read other digit runs as a date", () => {
      for (const text of ["20261013", "17617572000", "12345", "176175720000000"]) expect(parseBidDeadline(text)).toBeNull();
    });

    it("rejects a /Date()/ instant that no Date can hold", () => {
      expect(parseBidDeadline("/Date(99999999999999999999)/")).toBeNull();
      expect(parseBidDeadline("/Date(-99999999999999999999)/")).toBeNull();
    });
  });

  describe("ISO forms", () => {
    it("reads an offsetless time as a UTC-10 wall clock", () => {
      expect(parseBidDeadline("2026-10-13T14:30:15")).toEqual({ instantMs: Date.UTC(2026, 9, 14, 0, 30, 15), dateOnly: false });
      expect(parseBidDeadline("2026-10-13 08:00")).toEqual({ instantMs: Date.UTC(2026, 9, 13, 18), dateOnly: false });
      expect(parseBidDeadline("2026-10-13T8:05:00.250")).toEqual({ instantMs: Date.UTC(2026, 9, 13, 18, 5), dateOnly: false });
    });

    it("keeps an explicit Z or offset exact", () => {
      expect(parseBidDeadline("2026-10-13T12:00:00Z")?.instantMs).toBe(NOW);
      expect(parseBidDeadline("2026-10-13T12:00:00.000Z")?.instantMs).toBe(NOW);
      expect(parseBidDeadline("2026-10-13T08:00:00-05:00")?.instantMs).toBe(Date.UTC(2026, 9, 13, 13));
      expect(parseBidDeadline("2026-10-13T08:00:00-0500")?.instantMs).toBe(Date.UTC(2026, 9, 13, 13));
      expect(parseBidDeadline("2026-10-13T17:30:00+05:30")?.instantMs).toBe(NOW);
      expect(parseBidDeadline("2026-10-13 12:00:00 Z")?.instantMs).toBe(NOW);
      expect(parseBidDeadline("2026-10-13T12:00:00Z")?.dateOnly).toBe(false);
    });

    it("rejects an impossible time, offset or calendar day", () => {
      for (const text of [
        "2026-10-13T24:00:00", "2026-10-13T12:60", "2026-10-13T12:00:60", "2026-13-01", "2026-00-10", "2026-04-31",
        "2026-10-13T12:00:00+25:00", "2026-10-13T12:00:00+05:61", "2026-10-13T", "2026-10-13T12", "26-10-13",
      ]) expect(parseBidDeadline(text)).toBeNull();
    });
  });

  describe("US numeric forms", () => {
    it("reads a two-digit year as 2000 + yy", () => {
      expect(parseBidDeadline("05/31/26")?.instantMs).toBe(Date.UTC(2026, 4, 31, 10));
      expect(parseBidDeadline("1/2/99")?.instantMs).toBe(Date.UTC(2099, 0, 2, 10));
    });

    it("reads the time as a UTC-10 wall clock, with or without seconds and AM/PM", () => {
      expect(parseBidDeadline("10/13/2026 2:00 PM")).toEqual({ instantMs: Date.UTC(2026, 9, 14, 0), dateOnly: false });
      expect(parseBidDeadline("10/13/2026 14:00")?.instantMs).toBe(Date.UTC(2026, 9, 14, 0));
      expect(parseBidDeadline("10/13/2026 2:00:30pm")?.instantMs).toBe(Date.UTC(2026, 9, 14, 0, 0, 30));
      expect(parseBidDeadline("10/13/2026 02:00 AM")?.instantMs).toBe(NOW);
    });

    it("maps 12 AM to hour 0, 12 PM to hour 12 and any other PM hour to h + 12", () => {
      const at = (text: string) => parseBidDeadline(text)!.instantMs - Date.UTC(2026, 9, 13, 10);
      expect(at("10/13/2026 12:00 AM")).toBe(0);
      expect(at("10/13/2026 12:30 AM")).toBe(30 * 60_000);
      expect(at("10/13/2026 12:00 PM")).toBe(12 * HOUR_MS);
      expect(at("10/13/2026 1:00 PM")).toBe(13 * HOUR_MS);
      expect(at("10/13/2026 11:59 PM")).toBe(23 * HOUR_MS + 59 * 60_000);
      expect(at("10/13/2026 1:00 AM")).toBe(HOUR_MS);
    });

    it("accepts and ignores a trailing zone abbreviation", () => {
      const plain = parseBidDeadline("10/13/2026 2:00 PM");
      for (const zone of ["CST", "PDT", "ET", "MT", "EST"]) expect(parseBidDeadline(`10/13/2026 2:00 PM ${zone}`)).toEqual(plain);
      expect(parseBidDeadline("10/13/2026 14:00 CST")).toEqual(plain);
    });

    it("rejects an impossible calendar day or clock", () => {
      for (const text of [
        "02/30/2026", "13/01/2026", "00/10/2026", "10/00/2026", "04/31/2026", "02/29/2026", "02/29/2100", "10/32/2026",
        "10/12/2026 25:00", "10/12/2026 24:00", "10/12/2026 13:00 PM", "10/12/2026 0:30 AM", "10/12/2026 12:60 PM",
        "10/12/2026 12:00:60", "10/12/202", "10/12/20266", "10/12", "10-12-2026",
      ]) expect(parseBidDeadline(text)).toBeNull();
    });

    it("knows which years are leap years", () => {
      expect(parseBidDeadline("02/29/2028")).not.toBeNull();
      expect(parseBidDeadline("02/29/2000")).not.toBeNull();
      expect(parseBidDeadline("02/29/2024")).not.toBeNull();
      expect(parseBidDeadline("02/29/2025")).toBeNull();
      expect(parseBidDeadline("02/29/2100")).toBeNull();
    });
  });

  describe("month-name forms", () => {
    it("reads full, abbreviated, dotted and any-case month names", () => {
      for (const text of ["October 12, 2026", "Oct 12, 2026", "Oct. 12, 2026", "OCT 12 2026", "oct 12, 2026"]) {
        expect(parseBidDeadline(text)).toEqual({ instantMs: Date.UTC(2026, 9, 12, 10), dateOnly: true });
      }
      const month = (name: string) => parseBidDeadline(`${name} 5, 2026`)!.instantMs;
      const expected = [
        ["Jan", "January"], ["Feb", "February"], ["Mar", "March"], ["Apr", "April"], ["May", "May"], ["Jun", "June"],
        ["Jul", "July"], ["Aug", "August"], ["Sep", "September"], ["Oct", "October"], ["Nov", "November"], ["Dec", "December"],
      ];
      expected.forEach(([short, long], index) => {
        expect(month(short)).toBe(Date.UTC(2026, index, 5, 10));
        expect(month(long)).toBe(Date.UTC(2026, index, 5, 10));
      });
      expect(month("Sept")).toBe(Date.UTC(2026, 8, 5, 10));
      expect(month("Sept.")).toBe(Date.UTC(2026, 8, 5, 10));
    });

    it("reads an optional time with @, seconds, AM/PM and a zone abbreviation as a UTC-10 wall clock", () => {
      expect(parseBidDeadline("Aug 21, 2026 @ 02:00 PM")).toEqual({ instantMs: Date.UTC(2026, 7, 22, 0), dateOnly: false });
      expect(parseBidDeadline("August 21, 2026 2:00 PM PDT")?.instantMs).toBe(Date.UTC(2026, 7, 22, 0));
      expect(parseBidDeadline("Aug 21, 2026 14:00:05")?.instantMs).toBe(Date.UTC(2026, 7, 22, 0, 0, 5));
      expect(parseBidDeadline("Aug 21, 2026 @14:00")?.instantMs).toBe(Date.UTC(2026, 7, 22, 0));
      expect(parseBidDeadline("Aug 21, 2026 12:00 am")?.instantMs).toBe(Date.UTC(2026, 7, 21, 10));
    });

    it("rejects an impossible day or clock and an unknown month", () => {
      for (const text of [
        "Feb 30, 2026", "Feb 29, 2026", "Apr 31, 2026", "Oct 0, 2026", "Oct 32, 2026", "Aug 21, 2026 13:00 PM", "Aug 21, 2026 25:00",
        "Octember 5, 2026", "Oct 5", "5 Oct 2026", "Tuesday, October 13, 2026",
      ]) expect(parseBidDeadline(text)).toBeNull();
    });
  });
});

describe("a zone abbreviation next to the AM/PM", () => {
  const twoPm = Date.UTC(2026, 9, 14, 0); // 2:00 PM on 13 October in UTC-10

  it("keeps the PM when a zone abbreviation is written right after it", () => {
    for (const text of ["10/13/2026 2:00 PMCST", "10/13/2026 2:00 PM CST", "10/13/2026 2:00PMCST", "10/13/2026 2:00 pmcst", "10/13/2026 2:00 PM"]) {
      expect(parseBidDeadline(text), text).toEqual({ instantMs: twoPm, dateOnly: false });
      // 2:00 PM is still ahead of NOW; read as 02:00 AM it would already have passed.
      expect(bidDeadlinePassed(text, NOW), text).toBe(false);
    }
  });

  it("keeps the AM the same way, in the numeric and the month-name forms", () => {
    expect(parseBidDeadline("10/13/2026 2:00 AMEST")?.instantMs).toBe(NOW);
    expect(parseBidDeadline("Dec 1, 2026 @ 10:00 AMEST")).toEqual({ instantMs: Date.UTC(2026, 11, 1, 20), dateOnly: false });
    expect(parseBidDeadline("Dec 1, 2026 @ 10:00 AM EST")).toEqual({ instantMs: Date.UTC(2026, 11, 1, 20), dateOnly: false });
    expect(parseBidDeadline("Aug 21, 2026 2:00 PMPDT")?.instantMs).toBe(Date.UTC(2026, 7, 22, 0));
  });

  it("never reads the AM/PM itself as the zone abbreviation", () => {
    for (const text of ["10/13/2026 2:00 PMPM", "10/13/2026 2:00 PM PM", "10/13/2026 2:00 AM PM", "Aug 21, 2026 2:00 PM AM", "10/13/2026 PMT"]) {
      expect(parseBidDeadline(text), text).toBeNull();
    }
  });

  it("still ignores a zone abbreviation after a 24-hour time, but needs a space there", () => {
    expect(parseBidDeadline("10/13/2026 14:00 CST")).toEqual({ instantMs: twoPm, dateOnly: false });
    expect(parseBidDeadline("10/13/2026 14:00CST")).toBeNull();
  });
});

describe("an 'at' or '@' between the date and the time", () => {
  it("reads the real portal values 7/7/2026 at 1:30PM and 8/26/2026 at 1:30PM", () => {
    // 1:30 PM in UTC-10 is 23:30Z the same day.
    expect(parseBidDeadline("7/7/2026 at 1:30PM")).toEqual({ instantMs: Date.UTC(2026, 6, 7, 23, 30), dateOnly: false });
    expect(parseBidDeadline("8/26/2026 at 1:30PM")).toEqual({ instantMs: Date.UTC(2026, 7, 26, 23, 30), dateOnly: false });
    expect(bidDeadlinePassed("7/7/2026 at 1:30PM", NOW)).toBe(true);
    expect(bidDeadlinePassed("8/26/2026 at 1:30PM", NOW)).toBe(true);
  });

  it("reads it with a space before the AM/PM, in any case, with seconds, with @, and with a zone", () => {
    const expected = { instantMs: Date.UTC(2026, 6, 7, 23, 30), dateOnly: false };
    for (const text of ["7/7/2026 at 1:30 PM", "7/7/2026 AT 1:30PM", "7/7/2026 At 13:30", "7/7/2026 @ 1:30 PM", "7/7/2026 @1:30PM", "7/7/2026 at  1:30PM CST", "7/7/2026 at 1:30PMCST"]) {
      expect(parseBidDeadline(text), text).toEqual(expected);
    }
    expect(parseBidDeadline("7/7/2026 at 1:30:15PM")?.instantMs).toBe(Date.UTC(2026, 6, 7, 23, 30, 15));
  });

  it("does not take a longer word, or an impossible time, for it", () => {
    for (const text of ["7/7/2026 att 1:30PM", "7/7/2026 atl 1:30PM", "7/7/2026 at 25:30", "7/7/2026 at 13:30 PM", "7/7/2026 at at 1:30PM"]) {
      expect(parseBidDeadline(text), text).toBeNull();
    }
  });
});

describe("a time with no AM/PM", () => {
  /** 2:00 PM on 13 October in UTC-10, twelve hours after the literal 02:00 (which is NOW). */
  const PM_READING = Date.UTC(2026, 9, 14, 0);

  it("expires an hour from 1 to 11 at its PM reading, so a dropped PM never closes a bid early", () => {
    for (const text of ["10/13/2026 2:00", "10/13/2026 02:00:00", "10/13/2026 2:00 CST", "Oct 13, 2026 @ 2:00", "Oct 13, 2026 at 2:00"]) {
      expect(bidDeadlineExpiresAtMs(text), text).toBe(PM_READING);
      expect(bidDeadlinePassed(text, NOW), text).toBe(false);
    }
    expect(bidDeadlineExpiresAtMs("7/7/2026 at 1:30")).toBe(Date.UTC(2026, 6, 7, 23, 30));
    expect(bidDeadlineExpiresAtMs("7/7/2026 @ 1:30 EST")).toBe(Date.UTC(2026, 6, 7, 23, 30));
  });

  it("is passed only once its PM reading has", () => {
    expect(bidDeadlinePassed("10/13/2026 2:00", PM_READING - 1)).toBe(false);
    expect(bidDeadlinePassed("10/13/2026 2:00", PM_READING)).toBe(true);
  });

  it("leaves what is not ambiguous alone: AM/PM given, hour 0, hour 12 (noon), hours 13 to 23", () => {
    expect(bidDeadlineExpiresAtMs("10/13/2026 2:00 AM")).toBe(Date.UTC(2026, 9, 13, 12));
    expect(bidDeadlinePassed("10/13/2026 2:00 AM", NOW)).toBe(true);
    expect(bidDeadlineExpiresAtMs("10/13/2026 2:00 PM")).toBe(PM_READING);
    expect(bidDeadlineExpiresAtMs("10/13/2026 0:30")).toBe(Date.UTC(2026, 9, 13, 10, 30));
    expect(bidDeadlineExpiresAtMs("10/13/2026 12:00")).toBe(Date.UTC(2026, 9, 13, 22));
    expect(bidDeadlineExpiresAtMs("10/13/2026 14:00")).toBe(Date.UTC(2026, 9, 14, 0));
    expect(bidDeadlineExpiresAtMs("Oct 13, 2026 @ 14:00")).toBe(Date.UTC(2026, 9, 14, 0));
  });

  it("widens every hour from 1 to 11 and no other hour of the day", () => {
    for (let hour = 0; hour <= 23; hour += 1) {
      for (const text of [`10/13/2026 ${hour}:15`, `Oct 13, 2026 ${hour}:15`]) {
        const literal = Date.UTC(2026, 9, 13, hour + 10, 15);
        expect(bidDeadlineExpiresAtMs(text), text).toBe(hour >= 1 && hour <= 11 ? literal + 12 * HOUR_MS : literal);
      }
    }
  });

  it("does not touch ISO times or epoch numbers, which are 24-hour by construction", () => {
    expect(bidDeadlineExpiresAtMs("2026-10-13 02:00")).toBe(Date.UTC(2026, 9, 13, 12));
    expect(bidDeadlineExpiresAtMs("2026-10-13T02:00:00")).toBe(Date.UTC(2026, 9, 13, 12));
    expect(bidDeadlineExpiresAtMs("2026-10-13T02:00:00Z")).toBe(Date.UTC(2026, 9, 13, 2));
    expect(bidDeadlineExpiresAtMs("2026-10-13T02:00:00-05:00")).toBe(Date.UTC(2026, 9, 13, 7));
    expect(bidDeadlineExpiresAtMs("1761757200000")).toBe(1_761_757_200_000);
    expect(bidDeadlineExpiresAtMs("/Date(1893456000000)/")).toBe(1_893_456_000_000);
  });

  it("keeps parseBidDeadline on the literal reading, in the public shape, with the year window on that instant", () => {
    expect(parseBidDeadline("10/13/2026 2:00")).toEqual({ instantMs: NOW, dateOnly: false });
    expect(parseBidDeadline("Oct 13, 2026 at 2:00")).toEqual({ instantMs: NOW, dateOnly: false });
    expect(Object.keys(parseBidDeadline("10/13/2026 2:00")!).sort()).toEqual(["dateOnly", "instantMs"]);
    expect(Object.keys(parseBidDeadline("10/13/2026")!).sort()).toEqual(["dateOnly", "instantMs"]);
    // The window is judged on the literal instant: 1999-12-31T12:00Z is outside it even though the PM reading is 2000-01-01T00:00Z.
    expect(parseBidDeadline("12/31/1999 2:00")).toBeNull();
    expect(bidDeadlineExpiresAtMs("12/31/1999 2:00")).toBeNull();
    expect(parseBidDeadline("12/31/2100 2:00")?.instantMs).toBe(Date.UTC(2100, 11, 31, 12));
    expect(parseBidDeadline("01/01/2101 2:00")).toBeNull();
  });

  it("holds a lone P (not an AM/PM) to the same rule, so it cannot close a bid early either", () => {
    for (const text of ["10/13/2026 2:00 P", "10/13/2026 2:00 A"]) {
      const expiresAt = bidDeadlineExpiresAtMs(text);
      expect(expiresAt === null || expiresAt === PM_READING, text).toBe(true);
      expect(bidDeadlinePassed(text, NOW), text).toBe(false);
    }
  });

  it("agrees across the numeric and month-name forms for the same moment", () => {
    for (const text of ["10/13/2026 2:00", "10/13/2026 at 2:00", "10/13/2026 @ 2:00", "Oct 13, 2026 2:00", "Oct 13, 2026 @ 2:00", "October 13 2026 at 2:00 EST"]) {
      expect(bidDeadlineExpiresAtMs(text), text).toBe(PM_READING);
    }
  });
});

describe("a time of exactly midnight", () => {
  /** 00:00 on 14 October in UTC-10: the end of 13 October, where a date-only deadline for the 13th expires. */
  const END_OF_THE_13TH = Date.UTC(2026, 9, 14, 10);

  it("expires like a date-only deadline, at the end of its stated day, in every form", () => {
    for (const text of [
      // US numeric: 12-hour and 24-hour spellings, with and without a zone word, with at/@.
      "10/13/2026 12:00 AM", "10/13/2026 00:00", "10/13/2026 0:00:00", "10/13/2026 0:00", "10/13/2026 12:00:00 AM", "10/13/2026 12:00 am",
      "10/13/2026 12:00AM", "10/13/2026 0:00 CST", "10/13/2026 12:00 AM CST", "10/13/2026 12:00 AMCST", "10/13/2026 at 12:00 AM", "10/13/2026 @ 00:00",
      // Month name.
      "Oct 13, 2026 @ 12:00 AM", "Oct 13, 2026 at 12:00 AM", "Oct 13, 2026 00:00", "October 13 2026 0:00:00 EST",
      // ISO, zoneless and zoned; the date is the one written, whatever the offset does to the instant.
      "2026-10-13T00:00:00Z", "2026-10-13T00:00:00", "2026-10-13 00:00:00", "2026-10-13T00:00", "2026-10-13T00:00:00.000Z",
      "2026-10-13T00:00:00-05:00", "2026-10-13T00:00:00+05:30", "2026-10-13T00:00:00+14:00", "2026-10-13T00:00:00-12:00", "2026-10-13T00:00:00+0000",
    ]) {
      expect(bidDeadlineExpiresAtMs(text), text).toBe(END_OF_THE_13TH);
      expect(bidDeadlinePassed(text, NOW), text).toBe(false);
    }
  });

  it("is passed once the stated day has ended, and not before", () => {
    expect(bidDeadlineExpiresAtMs("10/12/2026 12:00 AM")).toBe(Date.UTC(2026, 9, 13, 10));
    expect(bidDeadlinePassed("10/12/2026 12:00 AM", NOW)).toBe(true);
    for (const text of ["10/13/2026 12:00 AM", "2026-10-13T00:00:00Z"]) {
      expect(bidDeadlinePassed(text, END_OF_THE_13TH - 1), text).toBe(false);
      expect(bidDeadlinePassed(text, END_OF_THE_13TH), text).toBe(true);
    }
  });

  it("agrees with the date-only deadline for the same day", () => {
    expect(bidDeadlineExpiresAtMs("10/13/2026")).toBe(END_OF_THE_13TH);
    expect(bidDeadlineExpiresAtMs("2026-10-13")).toBe(END_OF_THE_13TH);
    expect(bidDeadlineExpiresAtMs("02/28/2028 12:00 AM")).toBe(bidDeadlineExpiresAtMs("02/28/2028"));
    expect(bidDeadlineExpiresAtMs("02/29/2028 12:00 AM")).toBe(Date.UTC(2028, 2, 1, 10));
    expect(bidDeadlineExpiresAtMs("12/31/2026 12:00 AM")).toBe(Date.UTC(2027, 0, 1, 10));
    expect(bidDeadlineExpiresAtMs("2026-12-31T00:00:00Z")).toBe(Date.UTC(2027, 0, 1, 10));
  });

  it("keeps parseBidDeadline literal and in its public shape, with the year window on that instant", () => {
    expect(parseBidDeadline("10/13/2026 12:00 AM")).toEqual({ instantMs: Date.UTC(2026, 9, 13, 10), dateOnly: false });
    expect(parseBidDeadline("2026-10-13T00:00:00Z")).toEqual({ instantMs: Date.UTC(2026, 9, 13, 0), dateOnly: false });
    expect(parseBidDeadline("2026-10-13T00:00:00-05:00")).toEqual({ instantMs: Date.UTC(2026, 9, 13, 5), dateOnly: false });
    expect(parseBidDeadline("2026-10-13T00:00:00")).toEqual({ instantMs: Date.UTC(2026, 9, 13, 10), dateOnly: false });
    expect(Object.keys(parseBidDeadline("10/13/2026 00:00")!).sort()).toEqual(["dateOnly", "instantMs"]);
    // Both literal instants are 1999-12-31T10:00Z, outside the window, whatever the midnight rule would make of the expiry.
    expect(parseBidDeadline("12/31/1999 12:00 AM")).toBeNull();
    expect(bidDeadlineExpiresAtMs("12/31/1999 12:00 AM")).toBeNull();
    expect(parseBidDeadline("2000-01-01T00:00:00+14:00")).toBeNull();
    expect(bidDeadlineExpiresAtMs("2000-01-01T00:00:00+14:00")).toBeNull();
    expect(parseBidDeadline("12/31/2100 12:00 AM")?.instantMs).toBe(Date.UTC(2100, 11, 31, 10));
    expect(parseBidDeadline("01/01/2101 12:00 AM")).toBeNull();
  });

  it("leaves every other time as it was", () => {
    expect(bidDeadlineExpiresAtMs("10/13/2026 12:01 AM")).toBe(Date.UTC(2026, 9, 13, 10, 1));
    expect(bidDeadlineExpiresAtMs("10/13/2026 12:00:01 AM")).toBe(Date.UTC(2026, 9, 13, 10, 0, 1));
    expect(bidDeadlineExpiresAtMs("10/13/2026 0:01")).toBe(Date.UTC(2026, 9, 13, 10, 1));
    expect(bidDeadlineExpiresAtMs("10/13/2026 00:00:01")).toBe(Date.UTC(2026, 9, 13, 10, 0, 1));
    expect(bidDeadlineExpiresAtMs("Oct 13, 2026 @ 12:01 AM")).toBe(Date.UTC(2026, 9, 13, 10, 1));
    expect(bidDeadlineExpiresAtMs("10/13/2026 12:00 PM")).toBe(Date.UTC(2026, 9, 13, 22));
    expect(bidDeadlineExpiresAtMs("10/13/2026 12:00")).toBe(Date.UTC(2026, 9, 13, 22));
    expect(bidDeadlineExpiresAtMs("2026-10-13T00:00:01Z")).toBe(Date.UTC(2026, 9, 13, 0, 0, 1));
    expect(bidDeadlineExpiresAtMs("2026-10-13T00:01:00Z")).toBe(Date.UTC(2026, 9, 13, 0, 1));
    expect(bidDeadlineExpiresAtMs("2026-10-13T12:00:00Z")).toBe(Date.UTC(2026, 9, 13, 12));
    expect(bidDeadlineExpiresAtMs("2026-10-13T23:59:59-05:00")).toBe(Date.UTC(2026, 9, 14, 4, 59, 59));
    expect(bidDeadlineExpiresAtMs("2026-10-13T01:00:00Z")).toBe(Date.UTC(2026, 9, 13, 1));
  });

  it("does not touch the epoch forms, even at a UTC midnight", () => {
    const midnight = Date.UTC(2026, 9, 13);
    for (const text of [String(midnight), String(midnight / 1000), `/Date(${midnight})/`]) {
      expect(bidDeadlineExpiresAtMs(text), text).toBe(midnight);
    }
  });

  it("is not a 12-hour reading: a bare 0:00 is midnight, not a time that might be PM", () => {
    expect(bidDeadlineExpiresAtMs("10/13/2026 0:00")).toBe(END_OF_THE_13TH);
    expect(bidDeadlineExpiresAtMs("10/13/2026 0:00")).not.toBe(Date.UTC(2026, 9, 13, 22));
  });
});

describe("an 'at' between the date and the time in the month-name form", () => {
  it("reads Aug 21, 2026 at 2:00 PM like the @ form, in any case", () => {
    const expected = { instantMs: Date.UTC(2026, 7, 22, 0), dateOnly: false };
    for (const text of ["Aug 21, 2026 at 2:00 PM", "Aug 21, 2026 AT 2:00 PM", "Aug 21, 2026 At 2:00PM", "August 21 2026 at  2:00 pm", "Aug 21, 2026 @ 2:00 PM", "Aug 21, 2026 at 2:00 PMPDT", "Aug 21, 2026 at 14:00"]) {
      expect(parseBidDeadline(text), text).toEqual(expected);
    }
    expect(parseBidDeadline("Aug 21, 2026 at 2:00:30 PM")?.instantMs).toBe(Date.UTC(2026, 7, 22, 0, 0, 30));
  });

  it("does not take a longer word, or an impossible time, for it", () => {
    for (const text of ["Aug 21, 2026 att 2:00 PM", "Aug 21, 2026 atl 2:00 PM", "Aug 21, 2026 at 25:00", "Aug 21, 2026 at 13:00 PM", "Aug 21, 2026 at at 2:00 PM", "Aug 21, 2026at 2:00 PM"]) {
      expect(parseBidDeadline(text), text).toBeNull();
    }
  });
});

describe("the plausible years, 2000 to 2100, for every form", () => {
  it("reads no placeholder or typo date: /Date()/, ISO, US and month-name forms outside the window are null", () => {
    for (const text of [
      "0001-01-01", "1970-01-01", "/Date(-62135596800000)/", "12/31/1899", "2101-01-01",
      "/Date(0)/", "/Date(-86400000)/", "/Date(4133980800000)/", "1999-12-31", "01/01/1970", "12/31/1999", "01/01/0001", "1/1/2101",
      "1999-12-31T23:59:59Z", "2101-01-01T00:00:00Z", "1970-01-01 00:00", "Dec 31, 1999", "Jan 1, 2101", "Jan 1, 1970 @ 12:00 AM",
      "12/31/2100 8:00 PM", // 2101-01-01T06:00Z
    ]) {
      expect(parseBidDeadline(text), text).toBeNull();
      expect(bidDeadlineExpiresAtMs(text), text).toBeNull();
      expect(bidDeadlinePassed(text, NOW), text).toBe(false);
    }
  });

  it("reads the years at the edges of the window, by the UTC year of the instant", () => {
    expect(parseBidDeadline("2000-01-01")?.instantMs).toBe(Date.UTC(2000, 0, 1, 10));
    expect(parseBidDeadline("01/01/2000")?.instantMs).toBe(Date.UTC(2000, 0, 1, 10));
    expect(parseBidDeadline("2100-12-31")?.instantMs).toBe(Date.UTC(2100, 11, 31, 10));
    expect(parseBidDeadline("12/31/2100")?.instantMs).toBe(Date.UTC(2100, 11, 31, 10));
    expect(parseBidDeadline("Jan 1, 2000")?.instantMs).toBe(Date.UTC(2000, 0, 1, 10));
    expect(parseBidDeadline("Dec 31, 2100")?.instantMs).toBe(Date.UTC(2100, 11, 31, 10));
    expect(parseBidDeadline("2000-01-01T00:00:00Z")?.instantMs).toBe(Date.UTC(2000, 0, 1));
    expect(parseBidDeadline("2100-12-31T23:59:59Z")?.instantMs).toBe(Date.UTC(2100, 11, 31, 23, 59, 59));
    expect(parseBidDeadline("12/31/2099 8:00 PM")?.instantMs).toBe(Date.UTC(2100, 0, 1, 6)); // still 2100 in UTC
    expect(parseBidDeadline("/Date(946684800000)/")?.instantMs).toBe(Date.UTC(2000, 0, 1));
    expect(parseBidDeadline("/Date(4133980799999)/")?.instantMs).toBe(Date.UTC(2100, 11, 31, 23, 59, 59, 999));
  });

  it("still reads a deadline of this year as passed or not, as before", () => {
    expect(bidDeadlinePassed("10/12/2026", NOW)).toBe(true);
    expect(bidDeadlinePassed("10/14/2026", NOW)).toBe(false);
  });
});

describe("bidDeadlineExpiresAtMs", () => {
  it("expires a date-only deadline at the start of the next day in UTC-10", () => {
    expect(bidDeadlineExpiresAtMs("10/12/2026")).toBe(Date.UTC(2026, 9, 13, 10));
    expect(bidDeadlineExpiresAtMs("2026-12-31")).toBe(Date.UTC(2027, 0, 1, 10));
    expect(bidDeadlineExpiresAtMs("02/28/2028")).toBe(Date.UTC(2028, 1, 29, 10));
    expect(bidDeadlineExpiresAtMs("02/29/2028")).toBe(Date.UTC(2028, 2, 1, 10));
  });

  it("expires a deadline that carries a time at its own instant", () => {
    expect(bidDeadlineExpiresAtMs("10/13/2026 2:00 PM")).toBe(Date.UTC(2026, 9, 14, 0));
    expect(bidDeadlineExpiresAtMs("2026-10-13T12:00:00Z")).toBe(NOW);
    expect(bidDeadlineExpiresAtMs("1761757200000")).toBe(1_761_757_200_000);
  });

  it("is null when the text cannot be read", () => {
    expect(bidDeadlineExpiresAtMs("Not Available")).toBeNull();
  });
});

describe("purity", () => {
  const originalZone = process.env.TZ;
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
  });

  const battery = [
    "10/12/2026", "10/13/2026 2:00 AM", "10/13/2026 2:00 PM CST", "10/13/2026 2:00", "Oct 13, 2026 at 2:00", "10/13/2026 12:00 AM", "2026-10-13T00:00:00-05:00", "Aug 21, 2026 @ 02:00 PM", "2026-10-13T08:00:00", "2026-10-13",
    "2026-10-13T08:00:00-05:00", "/Date(1893456000000)/", "1761757200", "02/29/2028", "not a date",
  ];

  it("gives the same answers whatever the server time zone is", () => {
    const answers = (zone: string) => {
      process.env.TZ = zone;
      return {
        offset: new Date(2026, 0, 1).getTimezoneOffset(),
        parsed: battery.map((text) => [parseBidDeadline(text), bidDeadlineExpiresAtMs(text), bidDeadlinePassed(text, NOW)]),
      };
    };
    const auckland = answers("Pacific/Auckland");
    const losAngeles = answers("America/Los_Angeles");
    const utc = answers("UTC");
    // The zone switch must really take effect, or the comparison below proves nothing.
    expect(new Set([auckland.offset, losAngeles.offset, utc.offset]).size).toBe(3);
    expect(losAngeles.parsed).toEqual(auckland.parsed);
    expect(utc.parsed).toEqual(auckland.parsed);
  });

  it("never reads the clock", () => {
    const now = vi.spyOn(Date, "now");
    for (const text of battery) {
      parseBidDeadline(text);
      bidDeadlineExpiresAtMs(text);
      bidDeadlinePassed(text, NOW);
    }
    expect(now).not.toHaveBeenCalled();
  });
});
