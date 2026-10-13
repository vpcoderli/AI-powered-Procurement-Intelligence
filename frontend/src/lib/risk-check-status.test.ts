import { describe, expect, it } from "vitest";
import { riskCheckStatus, riskChecklistOutcome, RISK_CHECK_STATUSES } from "./risk-check-status";

describe("riskCheckStatus", () => {
  it("is the status a check carries", () => {
    expect(riskCheckStatus({ ok: true, status: "pass" })).toBe("pass");
    expect(riskCheckStatus({ ok: false, status: "fail" })).toBe("fail");
    expect(riskCheckStatus({ ok: false, status: "not_run" })).toBe("not_run");
  });

  it("reads ok for a check without a status: one stored before the status existed", () => {
    expect(riskCheckStatus({ ok: true })).toBe("pass");
    expect(riskCheckStatus({ ok: false })).toBe("fail");
  });

  it("reads ok for a status this build does not know, a newer build's", () => {
    expect(riskCheckStatus({ ok: true, status: "skipped" })).toBe("pass");
    expect(riskCheckStatus({ ok: false, status: "skipped" })).toBe("fail");
  });

  it("never turns a check that did not run, or one that failed, into a pass, whatever ok says", () => {
    expect(riskCheckStatus({ ok: true, status: "not_run" })).toBe("not_run");
    expect(riskCheckStatus({ ok: true, status: "fail" })).toBe("fail");
    // A pass needs ok as well: a status alone does not make one.
    expect(riskCheckStatus({ ok: false, status: "pass" })).toBe("fail");
  });

  it("names the three statuses", () => {
    expect([...RISK_CHECK_STATUSES]).toEqual(["pass", "fail", "not_run"]);
  });
});

describe("riskChecklistOutcome", () => {
  const pass = { ok: true, status: "pass" } as const;
  const fail = { ok: false, status: "fail" } as const;
  const notRun = { ok: false, status: "not_run" } as const;

  it("is pass when every check passed", () => {
    expect(riskChecklistOutcome({ ok: true, checks: [pass, pass] })).toBe("pass");
    expect(riskChecklistOutcome({ ok: true, checks: [{ ok: true }, { ok: true }] })).toBe("pass");
  });

  it("is fail when any check failed, whether or not another did not run", () => {
    expect(riskChecklistOutcome({ ok: false, checks: [pass, fail] })).toBe("fail");
    expect(riskChecklistOutcome({ ok: false, checks: [notRun, fail, pass] })).toBe("fail");
    expect(riskChecklistOutcome({ ok: false, checks: [{ ok: true }, { ok: false }] })).toBe("fail");
  });

  it("is incomplete when nothing failed but a check did not run: not a pass, and not a failure either", () => {
    expect(riskChecklistOutcome({ ok: false, checks: [pass, notRun] })).toBe("incomplete");
    expect(riskChecklistOutcome({ ok: false, checks: [notRun, notRun] })).toBe("incomplete");
  });

  it("is never a pass while a check did not run, even for a report that calls itself ok", () => {
    expect(riskChecklistOutcome({ ok: true, checks: [pass, notRun] })).toBe("incomplete");
  });

  it("is a failure for a report that is not ok although no check says why", () => {
    expect(riskChecklistOutcome({ ok: false, checks: [] })).toBe("fail");
    expect(riskChecklistOutcome({ ok: false, checks: [pass] })).toBe("fail");
  });

  it("is a pass for a report with no checks that is ok", () => {
    expect(riskChecklistOutcome({ ok: true, checks: [] })).toBe("pass");
  });
});
