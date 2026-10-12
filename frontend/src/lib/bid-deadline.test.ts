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
    it("reads /Date(ms)/ as an exact instant, negative values included", () => {
      expect(parseBidDeadline("/Date(1893456000000)/")).toEqual({ instantMs: 1_893_456_000_000, dateOnly: false });
      expect(parseBidDeadline("/Date(-86400000)/")).toEqual({ instantMs: -86_400_000, dateOnly: false });
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
    "10/12/2026", "10/13/2026 2:00 AM", "10/13/2026 2:00 PM CST", "Aug 21, 2026 @ 02:00 PM", "2026-10-13T08:00:00", "2026-10-13",
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
