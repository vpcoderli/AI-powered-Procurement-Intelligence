import { describe, expect, it } from "vitest";
import { AdminApiError } from "@/lib/api/admin";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import {
  PRECHECK_REQUEST_CHUNK,
  RUN_NOW_LIMIT,
  addApprovalResponse,
  approvalReport,
  emptyApprovalTally,
  errorText,
  failedReport,
  holdConfirmText,
  holdReport,
  isPrecheckEligible,
  precheckConfirmText,
  precheckReport,
  runTargets,
  sendInChunks,
  splitPrecheckTargets,
  summarizeRunResults,
  type PrecheckCandidate,
} from "./source-bulk-actions";

describe("source bulk actions", () => {
  it("resolves crawler run ids and reports the rows without one", () => {
    expect(
      runTargets([
        { id: "bidnet_co_denver", issuerType: "county", stateCode: "CO", crawlerSourceId: null },
        { id: "sam_gov", issuerType: "federal", stateCode: "US", crawlerSourceId: null },
        { id: "ca_state", issuerType: "state", stateCode: "CA", crawlerSourceId: "ca_caleprocure" },
      ]),
    ).toEqual({ runIds: ["bidnet_co_denver", "ca_caleprocure"], skippedIds: ["sam_gov"] });
    expect(RUN_NOW_LIMIT).toBe(20);
  });

  it("summarises a run response", () => {
    expect(
      summarizeRunResults({
        ok: false,
        status: "completed_with_failures",
        results: [
          { source: "a", ok: true, status: "success" },
          { source: "b", ok: false, status: "failure" },
          { source: "c", ok: false, status: "blocked" },
          { source: "d", ok: false, status: "deferred" },
        ],
        errors: [{ source: "e", code: "UNKNOWN_SOURCE", message: "unknown" }],
      }),
    ).toEqual({ ok: 1, failed: 2, skipped: 2 });
  });
});

describe("source bulk actions, edge cases", () => {
  it("keeps the spec limits: 500 ids per precheck request, 20 sources per run", () => {
    expect(PRECHECK_REQUEST_CHUNK).toBe(500);
    expect(RUN_NOW_LIMIT).toBe(20);
  });

  it("runs a crawler id once when two selected rows resolve to it", () => {
    expect(
      runTargets([
        { id: "a", issuerType: "state", stateCode: "CA", crawlerSourceId: "ca_caleprocure" },
        { id: "b", issuerType: "state", stateCode: "CA", crawlerSourceId: "ca_caleprocure" },
      ]),
    ).toEqual({ runIds: ["ca_caleprocure"], skippedIds: [] });
  });

  it("has nothing to run and nothing to report for an empty selection", () => {
    expect(runTargets([])).toEqual({ runIds: [], skippedIds: [] });
  });

  it("counts every non-success, non-failure status as skipped and a run with no errors field as clean", () => {
    expect(
      summarizeRunResults({
        ok: true,
        status: "completed",
        results: [
          { source: "a", ok: true, status: "success" },
          { source: "b", ok: false, status: "locked" },
          { source: "c", ok: false, status: "disabled" },
          { source: "d", ok: false, status: "something_new" },
        ],
      }),
    ).toEqual({ ok: 1, failed: 0, skipped: 3 });
    expect(summarizeRunResults({ ok: true, status: "completed", results: [] })).toEqual({ ok: 0, failed: 0, skipped: 0 });
  });

  it("counts an unknown-source error as a failure even when no result came back", () => {
    expect(
      summarizeRunResults({
        ok: false,
        status: "failed",
        results: [],
        errors: [{ source: "x", code: "UNKNOWN_SOURCE", message: "unknown" }, { source: "y", code: "UNKNOWN_SOURCE", message: "unknown" }],
      }),
    ).toEqual({ ok: 0, failed: 2, skipped: 0 });
  });
});

const adminEn = en.admin as Record<string, string>;
const adminZh = zh.admin as Record<string, string>;
/** The dictionary lookup the page's `t` performs, for the `admin.` keys the reports use. */
const t = (key: string) => adminEn[key.replace(/^admin\./, "")] ?? key;
const reasonLabel = (reason: string) => ({ held: "held by a person", precheck_missing: "never prechecked" })[reason as "held"] ?? reason;
const requestFailed = new AdminApiError(500, "INTERNAL_ERROR", "Request failed");

const candidate = (overrides: Partial<PrecheckCandidate> = {}): PrecheckCandidate => ({
  id: "bidnet_co_denver", level: "county", approvalState: "awaiting", isEnabled: true, ...overrides,
});

describe("precheck eligibility", () => {
  it("accepts an enabled local source that is awaiting approval, whatever its local level", () => {
    for (const level of ["county", "city", "township", "special_district"] as const) {
      expect(isPrecheckEligible(candidate({ level })), level).toBe(true);
    }
  });

  it("reads an unknown level as local, the way the crawler gate does", () => {
    expect(isPrecheckEligible(candidate({ level: "unknown" }))).toBe(true);
  });

  it("leaves out a federal row", () => {
    expect(isPrecheckEligible(candidate({ id: "sam_gov", level: "federal", approvalState: "approved" }))).toBe(false);
    expect(isPrecheckEligible(candidate({ id: "sam_gov", level: "federal", approvalState: "awaiting" }))).toBe(false);
  });

  it("leaves out a state row, approved or held (a held state row is read as awaiting)", () => {
    expect(isPrecheckEligible(candidate({ id: "ca_caleprocure", level: "state", approvalState: "approved" }))).toBe(false);
    expect(isPrecheckEligible(candidate({ id: "ca_caleprocure", level: "state", approvalState: "awaiting" }))).toBe(false);
  });

  it("leaves out an approved local row", () => {
    expect(isPrecheckEligible(candidate({ approvalState: "approved" }))).toBe(false);
  });

  it("leaves out a blocked local row", () => {
    expect(isPrecheckEligible(candidate({ approvalState: "blocked" }))).toBe(false);
  });

  it("leaves out a disabled local row", () => {
    expect(isPrecheckEligible(candidate({ isEnabled: false }))).toBe(false);
  });

  it("splits a mixed list into the ids to send and how many were left out", () => {
    expect(
      splitPrecheckTargets([
        candidate({ id: "a" }),
        candidate({ id: "sam_gov", level: "federal", approvalState: "approved" }),
        candidate({ id: "b", level: "city" }),
        candidate({ id: "ca", level: "state", approvalState: "approved" }),
        candidate({ id: "c", approvalState: "approved" }),
        candidate({ id: "d", approvalState: "blocked" }),
        candidate({ id: "e", isEnabled: false }),
      ]),
    ).toEqual({ eligibleIds: ["a", "b"], leftOut: 5 });
  });

  it("has nothing to send and nothing left out for an empty list, and everything left out when nothing is eligible", () => {
    expect(splitPrecheckTargets([])).toEqual({ eligibleIds: [], leftOut: 0 });
    expect(splitPrecheckTargets([candidate({ id: "x", isEnabled: false }), candidate({ id: "y", level: "federal" })])).toEqual({ eligibleIds: [], leftOut: 2 });
  });
});

describe("sendInChunks", () => {
  const add = (sum: number, size: number) => sum + size;

  it("sends the chunks one at a time, in order, and adds up every response", async () => {
    const log: string[] = [];
    const outcome = await sendInChunks(
      [["a", "b"], ["c"]],
      async (chunk) => {
        log.push(`start ${chunk.join("+")}`);
        await new Promise((resolve) => setTimeout(resolve, 0));
        log.push(`end ${chunk.join("+")}`);
        return chunk.length;
      },
      add,
      0,
    );

    expect(log).toEqual(["start a+b", "end a+b", "start c", "end c"]);
    expect(outcome).toEqual({ tally: 3, failed: false });
  });

  it("keeps what the earlier chunks added when a later chunk fails, and sends nothing after it", async () => {
    const sent: string[][] = [];
    const notFound = new AdminApiError(404, "DATA_SOURCE_NOT_FOUND", "Data source was not found.");
    const outcome = await sendInChunks(
      [["a"], ["b", "c"], ["d"]],
      async (chunk) => {
        sent.push(chunk);
        if (chunk[0] === "b") throw notFound;
        return chunk.length;
      },
      add,
      0,
    );

    expect(outcome).toEqual({ tally: 1, failed: true, failure: notFound });
    expect(sent).toEqual([["a"], ["b", "c"]]);
  });

  it("reports a failure of the first chunk with the initial tally", async () => {
    const outcome = await sendInChunks([["a"], ["b"]], async () => { throw requestFailed; }, add, 0);

    expect(outcome).toEqual({ tally: 0, failed: true, failure: requestFailed });
  });

  it("treats a sender that throws before it returns a promise like a rejected request", async () => {
    const outcome = await sendInChunks([["a"]], (() => { throw requestFailed; }) as () => Promise<number>, add, 7);

    expect(outcome).toEqual({ tally: 7, failed: true, failure: requestFailed });
  });

  it("sends nothing for no chunks and hands back the initial tally", async () => {
    let calls = 0;
    const outcome = await sendInChunks([], async () => { calls += 1; return 1; }, add, 0);

    expect(calls).toBe(0);
    expect(outcome).toEqual({ tally: 0, failed: false });
  });

  it("does not count a failure that is undefined as no failure", async () => {
    const outcome = await sendInChunks([["a"]], async () => { throw undefined; }, add, 0);

    expect(outcome).toEqual({ tally: 0, failed: true, failure: undefined });
  });
});

describe("approval tally", () => {
  it("adds the approved count and groups the skips by reason across responses", () => {
    const first = addApprovalResponse(emptyApprovalTally(), {
      updatedCount: 2,
      outcomes: [
        { sourceId: "a", outcome: "approved", reason: null },
        { sourceId: "b", outcome: "approved", reason: null },
        { sourceId: "c", outcome: "skipped", reason: "held" },
        { sourceId: "d", outcome: "skipped", reason: "precheck_missing" },
      ],
    });
    const second = addApprovalResponse(first, {
      updatedCount: 1,
      outcomes: [
        { sourceId: "e", outcome: "approved", reason: null },
        { sourceId: "f", outcome: "skipped", reason: "held" },
        { sourceId: "g", outcome: "skipped", reason: null },
      ],
    });

    expect(second).toEqual({ approved: 3, skippedByReason: { held: 2, precheck_missing: 1, unknown: 1 } });
  });

  it("counts a response without outcomes (a hold-style answer) by its updated count and never mutates the tally it is given", () => {
    const start = emptyApprovalTally();
    const next = addApprovalResponse(start, { updatedCount: 4 });

    expect(next).toEqual({ approved: 4, skippedByReason: {} });
    expect(start).toEqual({ approved: 0, skippedByReason: {} });
  });
});

describe("bulk reports", () => {
  it("says how many prechecks were queued and how many rows were left out", () => {
    expect(precheckReport(t, { tally: 3, failed: false }, 0)).toEqual({ message: "Queued 3 prechecks.", outcome: "done" });
    expect(precheckReport(t, { tally: 3, failed: false }, 2)).toEqual({
      message: "Queued 3 prechecks. 2 left out: only enabled local sources awaiting approval are prechecked.",
      outcome: "done",
    });
    expect(precheckReport(t, { tally: 0, failed: false }, 5).message).toBe(
      "Queued 0 prechecks. 5 left out: only enabled local sources awaiting approval are prechecked.",
    );
  });

  it("shows what was queued before a precheck request failed, together with the server's message", () => {
    expect(precheckReport(t, { tally: 500, failed: true, failure: requestFailed }, 0)).toEqual({
      message: "Queued 500 prechecks. Stopped on an error: Request failed",
      outcome: "failed",
    });
    expect(precheckReport(t, { tally: 0, failed: true, failure: requestFailed }, 3).message).toBe(
      "3 left out: only enabled local sources awaiting approval are prechecked. Stopped on an error: Request failed",
    );
  });

  it("keeps the approval summary of the earlier version when every chunk went through", () => {
    expect(approvalReport({ t, reasonLabel }, { tally: { approved: 5, skippedByReason: {} }, failed: false })).toEqual({
      message: "Source approvals updated.",
      outcome: "done",
    });
    expect(
      approvalReport({ t, reasonLabel }, { tally: { approved: 3, skippedByReason: { held: 2, precheck_missing: 1 } }, failed: false }),
    ).toEqual({ message: "Approved 3, skipped 3. held by a person × 2; never prechecked × 1", outcome: "done" });
  });

  it("shows the approvals and skips of the earlier chunks with the server's message when a later chunk failed", () => {
    const notFound = new AdminApiError(404, "DATA_SOURCE_NOT_FOUND", "Data source was not found.");

    expect(approvalReport({ t, reasonLabel }, { tally: { approved: 100, skippedByReason: { held: 1 } }, failed: true, failure: notFound })).toEqual({
      message: "Approved 100, skipped 1. held by a person × 1. Stopped on an error: Data source was not found.",
      outcome: "failed",
    });
    expect(approvalReport({ t, reasonLabel }, { tally: { approved: 100, skippedByReason: {} }, failed: true, failure: notFound }).message).toBe(
      "Approved 100, skipped 0. Stopped on an error: Data source was not found.",
    );
    expect(approvalReport({ t, reasonLabel }, { tally: emptyApprovalTally(), failed: true, failure: notFound }).message).toBe(
      "Stopped on an error: Data source was not found.",
    );
  });

  it("reports a hold as done, or shows how many were held before it stopped", () => {
    expect(holdReport(t, { tally: 12, failed: false })).toEqual({ message: "Source approvals updated.", outcome: "done" });
    expect(holdReport(t, { tally: 100, failed: true, failure: requestFailed })).toEqual({
      message: "Held 100 sources. Stopped on an error: Request failed",
      outcome: "failed",
    });
    expect(holdReport(t, { tally: 0, failed: true, failure: requestFailed }).message).toBe("Stopped on an error: Request failed");
  });

  it("reports a request that failed on its own with the server's words, and never with an empty reason", () => {
    expect(failedReport(t, new Error("offline"))).toEqual({ message: "Stopped on an error: offline", outcome: "failed" });
    expect(failedReport(t, new Error("")).message).toBe("Stopped on an error: Unable to update source.");
    expect(failedReport(t, undefined).message).toBe("Stopped on an error: Unable to update source.");
    expect(errorText("plain text")).toBe("plain text");
    expect(errorText(requestFailed)).toBe("Request failed");
  });
});

describe("bulk confirmations", () => {
  it("asks about the eligible count before everything matching is queued, and mentions the rows left out", () => {
    expect(precheckConfirmText(t, { eligibleIds: ["a", "b", "c"], leftOut: 0 })).toBe(
      "Queue prechecks for 3 sources? The crawler worker runs them within each platform's request budget.",
    );
    expect(precheckConfirmText(t, { eligibleIds: ["a", "b", "c"], leftOut: 2 })).toBe(
      "Queue prechecks for 3 sources? The crawler worker runs them within each platform's request budget. 2 left out: only enabled local sources awaiting approval are prechecked.",
    );
  });

  it("asks about the count before a batch hold", () => {
    expect(holdConfirmText(t, 12)).toBe(
      "Hold 12 selected sources? A batch approval skips a held source, and lifting the hold is done by hand, one source at a time.",
    );
  });
});

describe("bulk action wording", () => {
  const newKeys = [
    "sourcesPrecheckLeftOut",
    "sourcesQueueAllConfirm",
    "sourcesQueueAllTruncated",
    "sourcesHoldConfirm",
    "sourcesHeldResult",
    "sourcesBulkFailed",
  ];
  const placeholders = (text: string) => (text.match(/\{[a-z]+\}/g) ?? []).sort();

  it.each(newKeys)("has %s in both languages, with the same placeholders and a different zh text", (key) => {
    expect(adminEn[key], `en ${key}`).toBeTruthy();
    expect(adminZh[key], `zh ${key}`).toBeTruthy();
    expect(adminZh[key]).not.toBe(adminEn[key]);
    expect(placeholders(adminZh[key])).toEqual(placeholders(adminEn[key]));
  });

  it("fills every placeholder the reports use in the language of the page", () => {
    const tZh = (key: string) => adminZh[key.replace(/^admin\./, "")] ?? key;

    expect(precheckReport(tZh, { tally: 3, failed: false }, 2).message).not.toMatch(/[{}]/);
    expect(holdReport(tZh, { tally: 4, failed: true, failure: requestFailed }).message).not.toMatch(/[{}]/);
    expect(approvalReport({ t: tZh, reasonLabel }, { tally: { approved: 1, skippedByReason: { held: 1 } }, failed: true, failure: requestFailed }).message).not.toMatch(/[{}]/);
  });
});
