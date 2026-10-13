/**
 * What became of one risk check, read the same way by the server that builds the checklist and the admin console that
 * shows it. It imports nothing from the server, because the console bundles it.
 *
 * `pass` and `fail` are verdicts. `not_run` is the lack of one: the check was not evaluated, so it passed nothing and
 * failed nothing, and no reader may count it as a pass. A check's `ok` is true only for `pass`, so a reader that knows
 * nothing of the status still never sees a check that did not run as ok.
 */
export const RISK_CHECK_STATUSES = ["pass", "fail", "not_run"] as const;

export type RiskCheckStatus = (typeof RISK_CHECK_STATUSES)[number];

/**
 * How a whole checklist came out: `pass` when every check passed, `fail` when any failed, `incomplete` when none failed
 * but some did not run.
 */
export type RiskChecklistOutcome = "pass" | "fail" | "incomplete";

interface StatusCheck {
  ok: boolean;
  /** Absent in a report stored before the status existed, and any string a newer build writes. */
  status?: string;
}

/** A check's status. Without one this build knows, `ok` decides; nothing that did not pass or did not run reads as a pass. */
export function riskCheckStatus(check: StatusCheck): RiskCheckStatus {
  if (check.status === "not_run") return "not_run";
  if (check.status === "fail") return "fail";
  return check.ok ? "pass" : "fail";
}

/**
 * A checklist's outcome. A report that is not ok although no check says why (an older server, a hand-built report) is a
 * failure; a report that calls itself ok while a check did not run is incomplete.
 */
export function riskChecklistOutcome(report: { ok: boolean; checks: StatusCheck[] }): RiskChecklistOutcome {
  const statuses = report.checks.map(riskCheckStatus);
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("not_run")) return "incomplete";
  return report.ok ? "pass" : "fail";
}
