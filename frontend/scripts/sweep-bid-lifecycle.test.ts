import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bids } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";

/**
 * The sweep script end to end on a SQLite file: its flags, its output and its exit status. The sweep's own
 * behavior is covered where it lives (src/server/bids/lifecycle-sweep*.test.ts); how it reaches MySQL, and that it
 * exits when MySQL refuses it, is covered by mysql-pool-exit.test.ts.
 */

const frontendDir = fileURLToPath(new URL("..", import.meta.url));
const SEEDED_AT = "2026-01-01T00:00:00.000Z";

describe("scripts/sweep-bid-lifecycle.ts", () => {
  let testDb: TestDatabase;
  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    // Deadlines far from any clock this suite will run on: long past, far ahead, and unreadable.
    const rows = [
      { id: "state_a:1", issuerType: "state", deadline: "01/01/2020" },
      { id: "state_a:2", issuerType: "state", deadline: "2020-06-30" },
      { id: "county_b:1", issuerType: "county", deadline: "03/15/20" },
      { id: "state_a:3", issuerType: "state", deadline: "01/01/2090" },
      { id: "state_a:4", issuerType: "state", deadline: "Not Available" },
      { id: "state_a:5", issuerType: "state", deadline: null },
    ];
    for (const row of rows) {
      testDb.db.insert(bids).values({
        id: row.id, source: row.id.split(":")[0], sourceBidId: row.id, dedupeKey: row.id, title: "Road repair", description: "Repair the road.",
        deadlineDate: row.deadline, issuerName: "Agency", issuerType: row.issuerType, stateCode: "CO", sourceUrl: `https://portal.example.gov/${row.id}`,
        rawPayload: JSON.stringify({ id: row.id }), firstSeenAt: SEEDED_AT, lastSeenAt: SEEDED_AT, createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
      }).run();
    }
  });
  afterEach(async () => { await testDb.cleanup(); });

  function run(...flags: string[]) {
    const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/sweep-bid-lifecycle.ts", ...flags], {
      cwd: frontendDir,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, NODE_ENV: "test", DATABASE_PATH: testDb.databasePath, DATABASE_URL: "", MYSQL_DATABASE_URL: "" },
    });
    return { status: child.status, stdout: child.stdout, stderr: child.stderr };
  }
  const statuses = () => Object.fromEntries(testDb.db.select().from(bids).all().map((row) => [row.id, row.lifecycleStatus]));

  it("prints what it would close on --dry-run --json and writes nothing", () => {
    const { status, stdout } = run("--dry-run", "--json");

    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ scanned: 6, closed: 3, unparseable: 1, closedByIssuerType: { state: 2, county: 1 }, dryRun: true });
    expect(Object.values(statuses()).every((value) => value === "open")).toBe(true);
  });

  it("closes the expired bids and prints a summary of scanned, closed, unparseable and the issuer types", () => {
    const { status, stdout } = run();

    expect(status).toBe(0);
    expect(stdout).toContain("scanned: 6");
    expect(stdout).toContain("closed: 3");
    expect(stdout).toContain("unparseable: 1");
    expect(stdout).toMatch(/closed by issuer type:\n {2}state: 2\n {2}county: 1/);
    expect(stdout).not.toContain("dry run");
    expect(statuses()).toEqual({ "state_a:1": "closed", "state_a:2": "closed", "county_b:1": "closed", "state_a:3": "open", "state_a:4": "open", "state_a:5": "open" });
    const closed = testDb.db.select().from(bids).where(eq(bids.id, "state_a:1")).get()!;
    expect(JSON.parse(closed.rawPayload!)).toMatchObject({ id: "state_a:1", lifecycle: { closed_reason: "deadline_passed", deadline: "01/01/2020" } });
  });

  it("says so in the summary when it is a dry run", () => {
    const { status, stdout } = run("--dry-run");

    expect(status).toBe(0);
    expect(stdout).toContain("dry run");
    expect(stdout).toContain("closed: 3 (would be closed)");
  });

  it("finds nothing to close on a second run and reports that as JSON", () => {
    expect(run().status).toBe(0);
    const { status, stdout } = run("--json");

    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ scanned: 3, closed: 0, unparseable: 1, closedByIssuerType: {}, dryRun: false });
  });

  it("refuses an option it does not know instead of sweeping for real, and exits 1", () => {
    const { status, stdout, stderr } = run("--dryrun");

    expect(status).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Unknown option --dryrun");
    expect(Object.values(statuses()).every((value) => value === "open")).toBe(true);
  });
});
