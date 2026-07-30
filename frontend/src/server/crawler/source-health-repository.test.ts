import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import {
  recordSourceFailure,
  recordSourceFailureInMysql,
  recordSourceSuccess,
  recordSourceSuccessInMysql,
} from "./source-health-repository";

const NOW = "2026-07-29T00:00:00.000Z";
const LATER = "2026-07-30T00:00:00.000Z";

describe("source health repository", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db
      .insert(dataSources)
      .values({
        id: "src",
        label: "Source",
        issuerType: "state",
        stateCode: "CA",
        isEnabled: 1,
        cadence: "daily",
        consecutiveFailures: 3,
        approvalStatus: "approved",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  function read() {
    return testDb.db.select().from(dataSources).where(eq(dataSources.id, "src")).get();
  }

  it("resets the failure counter on success", () => {
    recordSourceSuccess(testDb.db, "src", LATER);
    const row = read();
    expect(row?.lastSuccessAt).toBe(LATER);
    expect(row?.consecutiveFailures).toBe(0);
  });

  it("increments the failure counter on failure", () => {
    recordSourceFailure(testDb.db, { sourceId: "src", at: LATER, kind: "network" });
    const row = read();
    expect(row?.lastFailureAt).toBe(LATER);
    expect(row?.consecutiveFailures).toBe(4);
    expect(row?.approvalStatus).toBe("approved");
  });

  it("degrades the source to needs_review once the threshold is crossed", () => {
    recordSourceFailure(testDb.db, { sourceId: "src", at: LATER, kind: "network" });
    recordSourceFailure(testDb.db, { sourceId: "src", at: LATER, kind: "network" });
    const row = read();
    expect(row?.consecutiveFailures).toBe(5);
    expect(row?.approvalStatus).toBe("needs_review");
  });

  it("degrades immediately on a parse failure regardless of the counter", () => {
    recordSourceFailure(testDb.db, { sourceId: "src", at: LATER, kind: "parse" });
    expect(read()?.approvalStatus).toBe("needs_review");
  });

  it("degrades silent-empty sources at the lower three-round threshold", () => {
    // Starting counter is 3; one empty result reaches the empty threshold.
    recordSourceFailure(testDb.db, { sourceId: "src", at: LATER, kind: "empty" });
    const row = read();
    expect(row?.consecutiveFailures).toBe(4);
    expect(row?.approvalStatus).toBe("needs_review");
  });
});

describe("source health repository MySQL runtime", () => {
  // These tests run against a stubbed `execute` and assert the SQL text and
  // bound parameters. They pin the statement's shape — they do NOT execute
  // against real MySQL, so they cannot by themselves catch a MySQL
  // evaluation-order bug (the CASE reading an already-reassigned column).
  // That class of bug is guarded here only by asserting the textual order
  // of the two assignments within the SQL string (see the last assertion in
  // "increments the failure counter...").

  it("resets the failure counter on success", async () => {
    const execute = vi.fn(async () => [{ affectedRows: 1, insertId: 0 }]);
    const pool = { execute };

    await recordSourceSuccessInMysql(pool, "src", LATER);

    expect(execute).toHaveBeenCalledWith(expect.stringContaining("UPDATE data_sources"), [
      LATER,
      LATER,
      "src",
    ]);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("consecutive_failures = 0"), expect.anything());
  });

  it("increments the failure counter and evaluates approval_status before reassigning the counter", async () => {
    const execute = vi.fn(async () => [{ affectedRows: 1, insertId: 0 }]);
    const pool = { execute };

    await recordSourceFailureInMysql(pool, { sourceId: "src", at: LATER, kind: "network" });

    // forceDegrade=0 (network isn't shouldFlagForReview), threshold=5 (default).
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("UPDATE data_sources"), [
      LATER,
      0,
      5,
      LATER,
      "src",
    ]);

    const [sql] = execute.mock.calls[0] as [string, unknown[]];
    const approvalIndex = sql.indexOf("approval_status = CASE");
    const counterIndex = sql.indexOf("consecutive_failures = consecutive_failures + 1");
    expect(approvalIndex).toBeGreaterThan(-1);
    expect(counterIndex).toBeGreaterThan(-1);
    // Regression guard for the MySQL left-to-right SET evaluation bug: the
    // CASE (which reads consecutive_failures) must be assigned textually
    // before consecutive_failures is reassigned, or MySQL's documented
    // evaluation-order semantics would make the CASE see the incremented
    // value and demote sources one failure early.
    expect(approvalIndex).toBeLessThan(counterIndex);
  });

  it("forces degradation for a parse failure via the forceDegrade parameter", async () => {
    const execute = vi.fn(async () => [{ affectedRows: 1, insertId: 0 }]);
    const pool = { execute };

    await recordSourceFailureInMysql(pool, { sourceId: "src", at: LATER, kind: "parse" });

    // forceDegrade=1 (parse is shouldFlagForReview), threshold=5 (default, irrelevant once forced).
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("WHEN ? = 1 THEN 'needs_review'"), [
      LATER,
      1,
      5,
      LATER,
      "src",
    ]);
  });

  it("uses the lower empty threshold in the bound parameters", async () => {
    const execute = vi.fn(async () => [{ affectedRows: 1, insertId: 0 }]);
    const pool = { execute };

    await recordSourceFailureInMysql(pool, { sourceId: "src", at: LATER, kind: "empty" });

    // forceDegrade=0, threshold=3 (empty's lower threshold).
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("UPDATE data_sources"), [
      LATER,
      0,
      3,
      LATER,
      "src",
    ]);
  });
});
