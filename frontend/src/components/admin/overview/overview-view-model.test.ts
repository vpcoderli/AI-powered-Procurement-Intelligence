import { describe, expect, it } from "vitest";
import { barPercent, sortStates, stateLevelColumns, toggleStateSort, visibleStates } from "./overview-view-model";

const STATES = [
  { stateCode: "CO", total: 40, byLevel: { county: 10, city: 30 } },
  { stateCode: "MI", total: 90, byLevel: { county: 20, township: 70 } },
  { stateCode: "CA", total: 1, byLevel: { state: 1 } },
];

describe("overview view model", () => {
  it("scales bars and guards zero", () => {
    expect(barPercent(0, 10)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
    expect(barPercent(554, 554)).toBe(100);
    expect(barPercent(144, 554)).toBe(26);
  });

  it("sorts states by any column and limits to the top 10 unless expanded", () => {
    expect(sortStates(STATES, { key: "total", descending: true }).map((row) => row.stateCode)).toEqual(["MI", "CO", "CA"]);
    expect(sortStates(STATES, { key: "city", descending: true }).map((row) => row.stateCode)).toEqual(["CO", "CA", "MI"]);
    expect(sortStates(STATES, { key: "stateCode", descending: false }).map((row) => row.stateCode)).toEqual(["CA", "CO", "MI"]);
    const many = Array.from({ length: 12 }, (_, index) => ({ stateCode: `S${String(index).padStart(2, "0")}`, total: index, byLevel: {} }));
    expect(visibleStates(many, { key: "total", descending: true }, false)).toHaveLength(10);
    expect(visibleStates(many, { key: "total", descending: true }, true)).toHaveLength(12);
  });

  it("shows a level column only when some source has that level", () => {
    expect(
      stateLevelColumns([
        { level: "state", total: 55, enabled: 55, approved: 55, awaitingApproval: 0, blocked: 0, neverRun: 5 },
        { level: "county", total: 266, enabled: 266, approved: 7, awaitingApproval: 257, blocked: 2, neverRun: 258 },
        // A level row with no sources at all must not get a column.
        { level: "city", total: 0, enabled: 0, approved: 0, awaitingApproval: 0, blocked: 0, neverRun: 0 },
      ]),
    ).toEqual(["state", "county"]);
  });

  it("toggles direction on the same column and defaults numbers to descending", () => {
    expect(toggleStateSort({ key: "total", descending: true }, "total")).toEqual({ key: "total", descending: false });
    expect(toggleStateSort({ key: "total", descending: true }, "county")).toEqual({ key: "county", descending: true });
    expect(toggleStateSort({ key: "total", descending: true }, "stateCode")).toEqual({ key: "stateCode", descending: false });
  });
});
