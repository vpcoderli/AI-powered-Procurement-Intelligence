import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bidQaCorrectionDraftFor,
  bidQaCorrectionsFor,
  bidQaDraftsWithDeadlineInput,
  bidQaRequestFor,
  DEFAULT_BID_QA_FILTERS,
  type BidQaCorrectionDraft,
} from "./BidQaSection";

describe("bid QA section", () => {
  it("builds the QA list request from the filters", () => {
    expect(bidQaRequestFor(DEFAULT_BID_QA_FILTERS)).toEqual({
      limit: 10,
      q: undefined,
      stateCode: undefined,
      reviewStatus: undefined,
      displayStatus: undefined,
      sourceConfidence: undefined,
      minQualityScore: undefined,
      maxQualityScore: undefined,
      reviewerId: undefined,
      reviewedFrom: undefined,
      reviewedTo: undefined,
    });
    const request = bidQaRequestFor({
      ...DEFAULT_BID_QA_FILTERS,
      stateCode: " co ",
      minQualityScore: "40",
      reviewedFrom: "2026-09-01",
      reviewedTo: "2026-09-29",
    });
    expect(request.stateCode).toBe("CO");
    expect(request.minQualityScore).toBe(40);
    expect(request.reviewedFrom).toBe("2026-09-01T00:00:00.000Z");
    expect(request.reviewedTo).toBe("2026-09-29T23:59:59.999Z");
  });

  it("owns its list and reloads it for a filter change or after a review action", () => {
    const source = readFileSync(new URL("BidQaSection.tsx", import.meta.url), "utf8");
    expect(source.startsWith('"use client"')).toBe(true);
    expect(source).toContain("listAdminBidQaItems(bidQaRequestFor(bidQaFilters))");
    expect(source).toContain("useAdminResource(loadBidQa)");
    expect(source).toContain("qa.reload()");
    expect(source).not.toContain("refreshBidQa");
  });

  it("follows the resource render rule and keeps review actions behind the operations role", () => {
    const source = readFileSync(new URL("BidQaSection.tsx", import.meta.url), "utf8");
    expect(source).toContain('code="error"');
    expect(source).toContain('code="loading"');
    expect(source).toContain('t("admin.sectionRefreshFailed")');
    expect(source).toContain("useAdminSession()");
    expect(source).toContain("{canRunOperations && (");
    expect(source).toContain("<AdminNotice message={notice} />");
    expect(source).not.toContain("setRunMessage");
  });

  // A bid's deadline is stored as the portal gave it: "2026-07-10" for most rows. formatDate printed that as "Jul 10, 08:00 AM"
  // (no year, a midnight UTC shown as 08:00 in UTC+8, and the day before west of UTC); formatBidDate keeps a calendar day a day.
  it("prints the deadline column with formatBidDate and keeps formatDate for the correction's own time", () => {
    const source = readFileSync(new URL("BidQaSection.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/import \{[^}]*\bformatBidDate\b[^}]*\} from "\.\.\/admin-format";/);
    expect(source).toContain("<TableCell>{formatBidDate(item.deadlineDate)}</TableCell>");
    expect(source).not.toContain("formatDate(item.deadlineDate)");
    // A correction's correctedAt is a real timestamp.
    expect(source).toContain("formatDate(correction.correctedAt)");
  });

  // The route answers 400 to an empty `corrections`, and the server logs a correction for every value that differs from the
  // stored string, so the save sends the fields the admin changed and nothing else.
  it("saves only the changed fields and keeps Save corrections disabled while nothing has changed", () => {
    const source = readFileSync(new URL("BidQaSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("const corrections = bidQaCorrectionsFor(item, bidQaCorrectionDraftFor(item, correctionDrafts));");
    expect(source).toContain("if (!corrections) return;");
    expect(source).toMatch(/updateAdminBidQaReview\(item\.id, \{\s*corrections,\s*note: "Admin QA correction",?\s*\}\)/);
    // The request used to be built inline, always with both fields.
    expect(source).not.toMatch(/corrections: \{\s*title: draft\.title\.trim\(\)/);
    expect(source).toContain("const corrections = bidQaCorrectionsFor(item, correctionDraft);");
    expect(source).toContain("disabled={isPending || correctionDraft.title.trim().length === 0 || corrections === null}");
  });

  // A date the input holds but the correction cannot carry keeps Save corrections on that same disabled path (the helper
  // answers null for it), and the field says why with the input's own invalid styling: no new string to translate.
  it("marks an unreadable date invalid on the input and leaves Save corrections on the disabled path it already has", () => {
    const source = readFileSync(new URL("BidQaSection.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/import \{[^}]*\bisUnreadableDateInput\b[^}]*\} from "\.\.\/admin-format";/);
    expect(source).toContain("if (isUnreadableDateInput(draft.deadlineDate, draft.deadlineDateBadInput)) return null;");
    expect(source).toContain(
      "aria-invalid={isUnreadableDateInput(correctionDraft.deadlineDate, correctionDraft.deadlineDateBadInput) || undefined}",
    );
    expect(source).toContain("disabled={isPending || correctionDraft.title.trim().length === 0 || corrections === null}");
  });

  // A date typed only in part reads "" (like an emptied input), and Chrome fires no input event for most edits of one, so the
  // input is read on change, on key up and on blur (readDateInput). What is kept in the draft is the value as the browser
  // reports it plus a flag of its own; nothing is written into the controlled value.
  it("reads the date input on change, key up and blur into a flag apart from the controlled value", () => {
    const source = readFileSync(new URL("BidQaSection.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/import \{[^}]*\breadDateInput\b[^}]*\} from "\.\.\/admin-format";/);
    expect(source).toContain("onChange={(event) => recordDeadlineInput(item, event.currentTarget)}");
    expect(source).toContain("onKeyUp={(event) => recordDeadlineInput(item, event.currentTarget)}");
    expect(source).toContain("onBlur={(event) => recordDeadlineInput(item, event.currentTarget)}");
    // The field is read before the updater runs: a React event's currentTarget is gone by then.
    expect(source).toContain("const reading = readDateInput(input);");
    expect(source).toContain("setCorrectionDrafts((current) => bidQaDraftsWithDeadlineInput(item, current, reading));");
    expect(source).toContain("value={correctionDraft.deadlineDate}");
    // The change handler used to write just the value, and read an emptied and a half-typed input alike.
    expect(source).not.toContain("deadlineDate: event.target.value,");
  });

  // Moved from src/app/admin/page.test.ts ("renders user access controls alongside crawler operations").
  it("keeps the bid QA review controls it took over from the dashboard page", () => {
    const source = readFileSync(new URL("BidQaSection.tsx", import.meta.url), "utf8");

    expect(source).toContain("listAdminBidQaItems");
    expect(source).toContain("getAdminBidQaCorrections");
    expect(source).toContain("batchUpdateAdminBidQaItems");
    expect(source).toContain("updateAdminBidQaReview");
    expect(source).toContain('t("admin.bidQa")');
    expect(source).toContain('t("admin.qualityScore")');
    expect(source).toContain('t("admin.archiveIssues")');
    expect(source).toContain('t("admin.markReviewed")');
    expect(source).toContain('t("admin.displayStatus")');
    expect(source).toContain('t("admin.publishBid")');
    expect(source).toContain('t("admin.suppressBid")');
    expect(source).toContain('t("admin.saveCorrections")');
    expect(source).toContain('t("admin.batchReview")');
    expect(source).toContain('t("admin.qaFilters")');
    expect(source).toContain('t("admin.reviewedTo")');
    expect(source).toContain('t("admin.correctionHistory")');
    expect(source).toContain("bidQaFilters");
    expect(source).toContain("selectedBidQaIds");
    expect(source).toContain("visibleSelectedBidQaIds");
    expect(source).toContain("setSelectedBidQaIds([])");
    expect(source).toContain("correctionHistoryBidId");
    expect(source).toContain("correctionDrafts");
    expect(source).toContain("displayStatus");
    expect(source).toContain("correctionCount");
  });
});

// The route answers 400 to an empty `corrections`, and the server records a correction for every value that differs from the
// stored string. The save used to send both fields whatever the admin touched, so fixing a title replaced the deadline
// "07/10/2026" (which the input showed as the day before in UTC+8) with "2026-07-09T23:59:59.000Z" and logged a
// deadline correction.
describe("bid QA corrections", () => {
  type Bid = Parameters<typeof bidQaCorrectionDraftFor>[0];
  const bid = (deadlineDate: string | null, title = "Roof replacement"): Bid => ({ id: "bid-1", title, deadlineDate });
  /** The draft an admin has after editing the given inputs of a bid's row. */
  const edited = (item: Bid, changes: Partial<BidQaCorrectionDraft>): BidQaCorrectionDraft => ({
    ...bidQaCorrectionDraftFor(item, {}),
    ...changes,
  });
  /** Runs `check` under each time zone in turn, and puts the process's own zone back afterwards. */
  const inEachZone = (check: (zone: string) => void) => {
    const previous = process.env.TZ;
    try {
      for (const zone of ["Asia/Shanghai", "America/Bogota", "UTC", "Pacific/Honolulu"]) {
        process.env.TZ = zone;
        check(zone);
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  };

  it("sends nothing for a draft nobody edited, whatever shape the stored deadline has", () => {
    inEachZone((zone) => {
      const deadlines = [
        "2026-07-10", "07/10/2026", "7/10/2026", "2026-07-10T23:59:59.000Z", "2026-07-10T20:12:00.000+00:00",
        "Aug 31, 2026 @ 02:00 PM", "TBD", "1788984000000", null,
      ];
      for (const deadlineDate of deadlines) {
        for (const title of ["Roof replacement", " Roof replacement  "]) {
          const item = bid(deadlineDate, title);
          expect(bidQaCorrectionsFor(item, bidQaCorrectionDraftFor(item, {})), `${zone} ${deadlineDate} ${JSON.stringify(title)}`).toBeNull();
        }
      }
    });
  });

  it("sends only the title when only the title changed", () => {
    inEachZone((zone) => {
      for (const deadlineDate of ["2026-07-10", "07/10/2026", "2026-07-10T23:59:59.000Z", "TBD", null]) {
        const item = bid(deadlineDate);
        const corrections = bidQaCorrectionsFor(item, edited(item, { title: "  Roof replacement, phase 2 " }));

        expect(corrections, `${zone} ${deadlineDate}`).toStrictEqual({ title: "Roof replacement, phase 2" });
      }
    });
  });

  it("sends only the deadline when only the deadline changed, as the end of that day in UTC", () => {
    for (const deadlineDate of ["2026-07-10", "07/10/2026", "TBD", null]) {
      const item = bid(deadlineDate);

      expect(bidQaCorrectionsFor(item, edited(item, { deadlineDate: "2026-07-11" })), String(deadlineDate)).toStrictEqual({
        deadlineDate: "2026-07-11T23:59:59.000Z",
      });
    }
  });

  it("sends both when both changed", () => {
    const item = bid("07/10/2026");

    expect(bidQaCorrectionsFor(item, edited(item, { title: "Roof replacement, phase 2", deadlineDate: "2026-08-01" }))).toStrictEqual({
      title: "Roof replacement, phase 2",
      deadlineDate: "2026-08-01T23:59:59.000Z",
    });
  });

  it("does not move an M/D/YYYY deadline the admin left alone: the input shows its own day and picking it again is no change", () => {
    inEachZone((zone) => {
      const item = bid("07/10/2026");
      // In UTC+8 the input used to read "2026-07-09".
      expect(bidQaCorrectionDraftFor(item, {}).deadlineDate, zone).toBe("2026-07-10");

      const titleOnly = bidQaCorrectionsFor(item, edited(item, { title: "Roof replacement, phase 2" }));
      expect(titleOnly, zone).toStrictEqual({ title: "Roof replacement, phase 2" });
      expect(titleOnly, zone).not.toHaveProperty("deadlineDate");
      expect(bidQaCorrectionsFor(item, edited(item, { deadlineDate: "2026-07-10" })), zone).toBeNull();
    });
  });

  it("keeps a stored end of day as the day it names, in the input and in the request", () => {
    inEachZone((zone) => {
      const item = bid("2026-07-10T23:59:59.000Z");

      expect(bidQaCorrectionDraftFor(item, {}).deadlineDate, zone).toBe("2026-07-10");
      expect(bidQaCorrectionsFor(item, edited(item, { title: "Roof replacement, phase 2" })), zone).not.toHaveProperty("deadlineDate");
    });
  });

  it("sends an emptied date as null, as before, and only for a deadline the input showed", () => {
    expect(bidQaCorrectionsFor(bid("2026-07-10"), edited(bid("2026-07-10"), { deadlineDate: "" }))).toStrictEqual({ deadlineDate: null });
    expect(bidQaCorrectionsFor(bid("07/10/2026"), edited(bid("07/10/2026"), { deadlineDate: "" }))).toStrictEqual({ deadlineDate: null });
    // The input of a deadline that is not a date is empty from the start: leaving it empty is not clearing anything.
    expect(bidQaCorrectionsFor(bid("TBD"), edited(bid("TBD"), { deadlineDate: "" }))).toBeNull();
    expect(bidQaCorrectionsFor(bid(null), edited(bid(null), { deadlineDate: "" }))).toBeNull();
  });

  // A date <input> in desktop Chrome takes a year of up to six digits and reports "20261-07-10" as its value. Date reads
  // neither that nor "275760-09-13", so endOfDayIsoFromDateInput answered null for it just as for an emptied input, and the
  // save sent { deadlineDate: null }: one slip in the year cleared the bid's deadline.
  it("sends nothing for a date the input holds but the request cannot carry, so a mistyped year never clears the deadline", () => {
    for (const deadlineDate of ["2026-07-10", "07/10/2026", "TBD", null]) {
      const item = bid(deadlineDate);

      for (const typed of ["20261-07-10", "275760-09-13", "10000-01-01", "2026-13-45"]) {
        expect(bidQaCorrectionsFor(item, edited(item, { deadlineDate: typed })), `${deadlineDate} -> ${typed}`).toBeNull();
      }
    }
  });

  it("holds back the whole draft while its date is unreadable, the title change included, rather than saving half of what was typed", () => {
    const item = bid("2026-07-10");
    const title = "Roof replacement, phase 2";

    expect(bidQaCorrectionsFor(item, edited(item, { title, deadlineDate: "20261-07-10" }))).toBeNull();
    // Once the date is a day again the title goes through with it, or alone when it is the day the input showed.
    expect(bidQaCorrectionsFor(item, edited(item, { title, deadlineDate: "2026-07-11" }))).toStrictEqual({ title, deadlineDate: "2026-07-11T23:59:59.000Z" });
    expect(bidQaCorrectionsFor(item, edited(item, { title, deadlineDate: "2026-07-10" }))).toStrictEqual({ title });
  });

  it("keeps the two things an input can be told apart: an emptied one clears the deadline, a readable day is sent, four-digit extremes included", () => {
    const item = bid("2026-07-10");

    expect(bidQaCorrectionsFor(item, edited(item, { deadlineDate: "" }))).toStrictEqual({ deadlineDate: null });
    expect(bidQaCorrectionsFor(item, edited(item, { deadlineDate: "9999-12-31" }))).toStrictEqual({ deadlineDate: "9999-12-31T23:59:59.000Z" });
    expect(bidQaCorrectionsFor(item, edited(item, { deadlineDate: "2026-07-11" }))).toStrictEqual({ deadlineDate: "2026-07-11T23:59:59.000Z" });
  });

  // In desktop Chrome, clearing one segment of a date <input>, or typing only some of one, gives value "" with
  // validity.badInput: the same "" as an emptied input. The save read it as one, and sent { deadlineDate: null }, which clears
  // the bid's deadline.
  describe("a date the input holds only in part (badInput)", () => {
    it("gives an untouched draft no flag", () => {
      const item = bid("2026-07-10");

      expect(bidQaCorrectionDraftFor(item, {})).toEqual({ title: "Roof replacement", deadlineDate: "2026-07-10", deadlineDateBadInput: false });
    });

    it("sends nothing while the input is half typed, so a cleared segment never clears the deadline", () => {
      for (const deadlineDate of ["2026-07-10", "07/10/2026", "2026-07-10T23:59:59.000Z", "TBD", null]) {
        const item = bid(deadlineDate);

        expect(bidQaCorrectionsFor(item, edited(item, { deadlineDate: "", deadlineDateBadInput: true })), String(deadlineDate)).toBeNull();
      }
    });

    it("holds back the whole draft, the title change included, and lets it through once the field is a day or truly empty", () => {
      const item = bid("2026-07-10");
      const title = "Roof replacement, phase 2";

      expect(bidQaCorrectionsFor(item, edited(item, { title, deadlineDate: "", deadlineDateBadInput: true }))).toBeNull();
      expect(bidQaCorrectionsFor(item, edited(item, { title, deadlineDate: "2026-07-11", deadlineDateBadInput: false }))).toStrictEqual({
        title,
        deadlineDate: "2026-07-11T23:59:59.000Z",
      });
      expect(bidQaCorrectionsFor(item, edited(item, { title, deadlineDate: "", deadlineDateBadInput: false }))).toStrictEqual({
        title,
        deadlineDate: null,
      });
    });

    it("takes the flag as the word of the input, whatever value it reads", () => {
      const item = bid("2026-07-10");

      expect(bidQaCorrectionsFor(item, edited(item, { deadlineDate: "2026-07-11", deadlineDateBadInput: true }))).toBeNull();
    });

    it("still clears the deadline for an input that was emptied, and sends a day: only badInput holds a draft back", () => {
      const item = bid("2026-07-10");

      expect(bidQaCorrectionsFor(item, edited(item, { deadlineDate: "", deadlineDateBadInput: false }))).toStrictEqual({ deadlineDate: null });
      expect(bidQaCorrectionsFor(item, edited(item, { deadlineDate: "2026-07-11", deadlineDateBadInput: false }))).toStrictEqual({
        deadlineDate: "2026-07-11T23:59:59.000Z",
      });
    });
  });

  // The input is read on change, on key up and on blur. Chrome fires input/change for the edit that empties a complete date
  // (value "", badInput true), but not for clearing the segments that are left (badInput back to false) or for typing into an
  // empty field (badInput true, value still ""): those show on key up, and on the blur that precedes a click on Save corrections.
  describe("recording what the date input reports", () => {
    it("keeps a half-typed date in a flag of its own, with the value as the browser reports it", () => {
      const item = bid("2026-07-10");
      const drafts = bidQaDraftsWithDeadlineInput(item, {}, { value: "", badInput: true });

      expect(drafts[item.id]).toEqual({ title: "Roof replacement", deadlineDate: "", deadlineDateBadInput: true });
      expect(bidQaCorrectionsFor(item, bidQaCorrectionDraftFor(item, drafts))).toBeNull();
    });

    it("clears the flag when the input is a day again, and the day is sent", () => {
      const item = bid("2026-07-10");
      const half = bidQaDraftsWithDeadlineInput(item, {}, { value: "", badInput: true });
      const fixed = bidQaDraftsWithDeadlineInput(item, half, { value: "2026-07-11", badInput: false });

      expect(fixed[item.id].deadlineDateBadInput).toBe(false);
      expect(bidQaCorrectionsFor(item, bidQaCorrectionDraftFor(item, fixed))).toStrictEqual({ deadlineDate: "2026-07-11T23:59:59.000Z" });
    });

    it("clears the flag when the last segment is cleared, and the emptied date then clears the deadline as it always did", () => {
      const item = bid("2026-07-10");
      const half = bidQaDraftsWithDeadlineInput(item, {}, { value: "", badInput: true });
      const emptied = bidQaDraftsWithDeadlineInput(item, half, { value: "", badInput: false });

      expect(emptied[item.id].deadlineDateBadInput).toBe(false);
      expect(bidQaCorrectionsFor(item, bidQaCorrectionDraftFor(item, emptied))).toStrictEqual({ deadlineDate: null });
    });

    it("holds back a title change while a date typed into an empty field is unfinished", () => {
      // The bid has no date, so the input starts empty and typing a month leaves value "" (the prefill): nothing but badInput tells.
      const item = bid(null);
      const half = bidQaDraftsWithDeadlineInput(item, {}, { value: "", badInput: true });
      const titled = { ...half, [item.id]: { ...half[item.id], title: "Roof replacement, phase 2" } };

      expect(bidQaCorrectionsFor(item, bidQaCorrectionDraftFor(item, titled))).toBeNull();
    });

    it("creates no draft for a reading that changes nothing, so passing through a field marks no row as edited", () => {
      const item = bid("07/10/2026");
      const none = {};

      // The input shows 2026-07-10 for a stored 07/10/2026, and focusing then leaving it reports exactly that.
      expect(bidQaDraftsWithDeadlineInput(item, none, { value: "2026-07-10", badInput: false })).toBe(none);
      const half = bidQaDraftsWithDeadlineInput(item, none, { value: "", badInput: true });
      expect(bidQaDraftsWithDeadlineInput(item, half, { value: "", badInput: true })).toBe(half);
    });

    it("keeps the title the admin typed, and the other rows' drafts, when a deadline reading comes in", () => {
      const item = bid("2026-07-10");
      const other: Bid = { id: "bid-2", title: "Fence repair", deadlineDate: null };
      const before = {
        [item.id]: edited(item, { title: "Roof replacement, phase 2" }),
        [other.id]: edited(other, { title: "Fence repair, phase 2" }),
      };

      const after = bidQaDraftsWithDeadlineInput(item, before, { value: "", badInput: true });

      expect(after[item.id]).toEqual({ title: "Roof replacement, phase 2", deadlineDate: "", deadlineDateBadInput: true });
      expect(after[other.id]).toBe(before[other.id]);
    });
  });

  it("counts the trimmed title: spaces alone are no change, and an untouched padded title is not trimmed behind the admin's back", () => {
    const item = bid("2026-07-10");

    expect(bidQaCorrectionsFor(item, edited(item, { title: "Roof replacement  " }))).toBeNull();
    expect(bidQaCorrectionsFor(item, edited(item, { title: "  Roof replacement" }))).toBeNull();

    const padded = bid("2026-07-10", " Roof replacement ");
    expect(bidQaCorrectionsFor(padded, bidQaCorrectionDraftFor(padded, {}))).toBeNull();
    // Trimming it is a change the admin made.
    expect(bidQaCorrectionsFor(padded, edited(padded, { title: "Roof replacement" }))).toStrictEqual({ title: "Roof replacement" });
  });
});
