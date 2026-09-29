import { describe, expect, it } from "vitest";
import {
  compactErrorMessage,
  endOfDayIsoFromDateInput,
  fallbackMessage,
  formatDate,
  formatDateInputValue,
  statusTone,
} from "./admin-format";

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
