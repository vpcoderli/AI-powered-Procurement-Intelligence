import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../src/server/db/test-utils";
import { dataSources } from "../src/server/db/schema";
import { formatSourcePrecheckHelp, parseSourcePrecheckArgs, runSourcePrecheckCommand } from "./source-precheck";

const NOW = new Date("2026-09-29T08:00:00.000Z");

describe("parseSourcePrecheckArgs", () => {
  it("reads --provider/--pending, repeatable --source, --dry-run, both flag spellings", () => {
    expect(parseSourcePrecheckArgs(["--provider", "bidnet", "--pending"])).toEqual({ providerFamily: "bidnet", pending: true, sourceIds: [], dryRun: false, help: false });
    expect(parseSourcePrecheckArgs(["--provider=bidnet", "--pending", "--dry-run"])).toMatchObject({ providerFamily: "bidnet", dryRun: true });
    expect(parseSourcePrecheckArgs(["--source", "a", "--source=b"])).toMatchObject({ sourceIds: ["a", "b"] });
    expect(parseSourcePrecheckArgs(["--help"]).help).toBe(true);
  });

  it("rejects unknown flags and a provider without --pending", () => {
    expect(() => parseSourcePrecheckArgs(["--bogus"])).toThrow(/unknown argument/);
    expect(() => parseSourcePrecheckArgs(["--provider", "bidnet"])).toThrow(/--pending/);
    expect(formatSourcePrecheckHelp()).toContain("--pending");
  });
});

describe("runSourcePrecheckCommand (SQLite)", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values([
      { id: "bidnet_mi_a", label: "A", issuerType: "county", stateCode: "MI", providerFamily: "bidnet", jurisdictionLevel: "county", isEnabled: 1, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
      { id: "bidnet_mi_b", label: "B", issuerType: "county", stateCode: "MI", providerFamily: "bidnet", jurisdictionLevel: "county", isEnabled: 1, approvalStatus: "approved", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
    ]).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("dry-run lists without writing; the real run marks and reports", async () => {
    const lines: string[] = [];
    const dry = await runSourcePrecheckCommand(parseSourcePrecheckArgs(["--provider", "bidnet", "--pending", "--dry-run"]), { database: testDb.db, now: NOW, log: (line) => lines.push(line) });
    expect(dry).toEqual({ requestedCount: 1, sourceIds: ["bidnet_mi_a"] });
    expect(lines.join("\n")).toContain("Dry run");
    const dryRunRows = testDb.db.select({ at: dataSources.precheckRequestedAt }).from(dataSources).all();
    expect(dryRunRows).toHaveLength(2);
    expect(dryRunRows.every((row) => row.at === null)).toBe(true);

    const real = await runSourcePrecheckCommand(parseSourcePrecheckArgs(["--provider", "bidnet", "--pending"]), { database: testDb.db, now: NOW, log: (line) => lines.push(line) });
    expect(real.sourceIds).toEqual(["bidnet_mi_a"]);
    expect(lines.at(-1)).toContain("Queued 1");

    // Verify the database write actually happened
    const afterRealRun = testDb.db.select({ id: dataSources.id, at: dataSources.precheckRequestedAt }).from(dataSources).all();
    expect(afterRealRun).toHaveLength(2);
    const aRow = afterRealRun.find((row) => row.id === "bidnet_mi_a");
    const bRow = afterRealRun.find((row) => row.id === "bidnet_mi_b");
    expect(aRow?.at).toBe(NOW.toISOString());
    expect(bRow?.at).toBeNull();

    // Verify idempotency: running again should find 0 targets
    const rerun = await runSourcePrecheckCommand(parseSourcePrecheckArgs(["--provider", "bidnet", "--pending"]), { database: testDb.db, now: NOW, log: () => {} });
    expect(rerun.requestedCount).toBe(0);
    expect(rerun.sourceIds).toHaveLength(0);
  });
});
