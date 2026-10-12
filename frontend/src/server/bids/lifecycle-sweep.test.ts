import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bids } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { sweepExpiredBids } from "./lifecycle-sweep";

/** 02:00 on 13 October in the deadline zone (UTC-10). */
const NOW = new Date("2026-10-13T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const SEEDED_AT = "2026-10-01T00:00:00.000Z";

interface Seed {
  id: string;
  deadline: string | null;
  issuerType?: string;
  lifecycleStatus?: string;
  rawPayload?: string | null;
  /** Whether the sweep is expected to close the bid. */
  expired?: boolean;
}

/** One open row in each shape the sweep has to read, plus the rows it must leave alone. */
const SEEDS: Seed[] = [
  // Expired.
  { id: "ex:us-date", deadline: "10/12/2026", issuerType: "state", expired: true },
  { id: "ex:iso-date", deadline: "2026-10-12", issuerType: "state", expired: true },
  { id: "ex:us-time-at-now", deadline: "10/13/2026 2:00 AM", issuerType: "county", expired: true },
  { id: "ex:two-digit-year", deadline: "05/31/26", issuerType: "county", expired: true },
  { id: "ex:month-name", deadline: "Aug 21, 2026 @ 02:00 PM", issuerType: "city", expired: true },
  { id: "ex:epoch-ms", deadline: "1761757200000", issuerType: "state", expired: true },
  { id: "ex:iso-instant", deadline: "2026-10-13T11:59:59Z", issuerType: "state", expired: true },
  // Still open: the deadline is today (a date-only deadline is good through its day) or ahead.
  { id: "open:today", deadline: "10/13/2026" },
  { id: "open:iso-today", deadline: "2026-10-13" },
  { id: "open:cst", deadline: "10/13/2026 2:00 PM CST" },
  { id: "open:month-ahead", deadline: "Dec 1, 2026 @ 10:00 AM" },
  { id: "open:dotnet", deadline: "/Date(1893456000000)/" },
  { id: "open:instant-ahead", deadline: "2026-10-13T12:00:01Z" },
  { id: "open:offset-ahead", deadline: "2026-10-13T08:00:00-05:00" },
  { id: "open:2028", deadline: "01/01/2028" },
  // Open, with a deadline nobody can read.
  { id: "odd:not-available", deadline: "Not Available" },
  { id: "odd:tbd", deadline: "TBD" },
  { id: "odd:impossible-date", deadline: "02/30/2026" },
  // Open, with a placeholder no portal means as a deadline (outside the years 2000-2100): unreadable too, and never closed.
  { id: "odd:min-date", deadline: "0001-01-01" },
  { id: "odd:epoch-zero", deadline: "01/01/1970" },
  { id: "odd:dotnet-min", deadline: "/Date(-62135596800000)/" },
  // Open, with no deadline at all: not unparseable, just undated.
  { id: "none:null", deadline: null },
  { id: "none:blank", deadline: "  " },
  // Not open: the sweep never touches them, whatever the deadline says.
  { id: "done:awarded", deadline: "10/01/2026", lifecycleStatus: "awarded" },
  { id: "done:closed", deadline: "10/01/2026", lifecycleStatus: "closed" },
];
const OPEN_ROWS = SEEDS.filter((seed) => !seed.lifecycleStatus).length;
const EXPIRED = SEEDS.filter((seed) => seed.expired).map((seed) => seed.id).sort();
const UNREADABLE = SEEDS.filter((seed) => seed.id.startsWith("odd:")).map((seed) => seed.id);
const EXPECTED = { scanned: OPEN_ROWS, closed: EXPIRED.length, unparseable: UNREADABLE.length, closedByIssuerType: { state: 4, county: 2, city: 1 } };

describe("sweepExpiredBids on SQLite", () => {
  let testDb: TestDatabase;
  beforeEach(async () => { testDb = await createTestDatabase({ seed: false }); });
  afterEach(async () => { vi.restoreAllMocks(); await testDb.cleanup(); });

  const payloadOf = (seed: Seed) => seed.rawPayload !== undefined ? seed.rawPayload : JSON.stringify({ portal_id: seed.id, lifecycle: { note: "kept" } });

  function seed(rows: Seed[] = SEEDS) {
    rows.forEach((row, index) => {
      testDb.db.insert(bids).values({
        id: row.id, source: row.id.split(":")[0], sourceBidId: row.id, dedupeKey: row.id, title: `Bid ${index}`, description: "Repair the road.",
        deadlineDate: row.deadline, issuerName: "Agency", issuerType: row.issuerType ?? "state", stateCode: "CO",
        sourceUrl: `https://portal.example.gov/${index}`, isActive: row.lifecycleStatus ? 0 : 1, lifecycleStatus: row.lifecycleStatus ?? "open",
        rawPayload: payloadOf(row), firstSeenAt: SEEDED_AT, lastSeenAt: SEEDED_AT, createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
      }).run();
    });
  }
  const read = (id: string) => testDb.db.select().from(bids).where(eq(bids.id, id)).get()!;
  const snapshot = () => testDb.db.select().from(bids).orderBy(bids.id).all();
  const closedIds = () => testDb.db.select().from(bids).all().filter((row) => row.lifecycleStatus === "closed" && row.updatedAt === NOW_ISO).map((row) => row.id).sort();
  const sweep = (options: { dryRun?: boolean; batchSize?: number } = {}) => sweepExpiredBids({ database: testDb.db }, { now: NOW, ...options });

  /** Calls `listener` with the SQL of every SELECT the sweep runs, as it runs (a statement may be prepared once and run often). */
  function watchSelects(listener: (sql: string) => void) {
    const client = testDb.db.$client;
    const prepare = client.prepare.bind(client);
    vi.spyOn(client, "prepare").mockImplementation(((sql: string) => {
      const statement = prepare(sql);
      const all = statement.all.bind(statement);
      statement.all = ((...args: unknown[]) => { listener(sql); return all(...args); }) as typeof statement.all;
      return statement;
    }) as typeof client.prepare);
  }

  it("closes exactly the bids whose deadline has passed and reports what it saw", async () => {
    seed();
    const result = await sweep();

    expect(result).toEqual({ ...EXPECTED, dryRun: false });
    expect(closedIds()).toEqual(EXPIRED);
    for (const id of EXPIRED) {
      expect(read(id)).toMatchObject({ lifecycleStatus: "closed", isActive: 0, updatedAt: NOW_ISO, firstSeenAt: SEEDED_AT, lastSeenAt: SEEDED_AT });
    }
    for (const row of SEEDS.filter((candidate) => !candidate.expired && !candidate.lifecycleStatus)) {
      expect(read(row.id)).toMatchObject({ lifecycleStatus: "open", isActive: 1, updatedAt: SEEDED_AT });
    }
  });

  it("records why and when under raw_payload.lifecycle without losing the payload", async () => {
    seed();
    await sweep();

    const closed = JSON.parse(read("ex:us-date").rawPayload!);
    expect(closed).toEqual({
      portal_id: "ex:us-date",
      lifecycle: { note: "kept", closed_reason: "deadline_passed", closed_observed_at: NOW_ISO, deadline: "10/12/2026" },
    });
    expect(JSON.parse(read("ex:month-name").rawPayload!).lifecycle.deadline).toBe("Aug 21, 2026 @ 02:00 PM");
    // Rows that stay open keep their payload byte for byte.
    expect(read("open:today").rawPayload).toBe(payloadOf({ id: "open:today", deadline: "10/13/2026" }));
  });

  it("leaves awarded and closed bids alone, even with a deadline that has passed", async () => {
    seed();
    const before = { awarded: read("done:awarded"), closed: read("done:closed") };
    await sweep();

    expect(read("done:awarded")).toEqual(before.awarded);
    expect(read("done:closed")).toEqual(before.closed);
  });

  it("counts open bids whose non-blank deadline cannot be read, and never closes them", async () => {
    seed();
    const result = await sweep();

    expect(result.unparseable).toBe(6);
    expect(UNREADABLE).toHaveLength(6);
    for (const id of [...UNREADABLE, "none:null", "none:blank"]) {
      expect(read(id)).toMatchObject({ lifecycleStatus: "open", isActive: 1, updatedAt: SEEDED_AT });
    }
  });

  it("keys the closures by issuer type", async () => {
    seed();
    expect((await sweep()).closedByIssuerType).toEqual({ state: 4, county: 2, city: 1 });
  });

  it("reports what it would do on a dry run and writes nothing", async () => {
    seed();
    const before = snapshot();
    const result = await sweep({ dryRun: true });

    expect(result).toEqual({ ...EXPECTED, dryRun: true });
    expect(snapshot()).toEqual(before);
  });

  it("is idempotent: a second run finds nothing left to close", async () => {
    seed();
    await sweep();
    const afterFirst = snapshot();
    const second = await sweep();

    expect(second).toEqual({ scanned: OPEN_ROWS - EXPIRED.length, closed: 0, unparseable: UNREADABLE.length, closedByIssuerType: {}, dryRun: false });
    expect(snapshot()).toEqual(afterFirst);
  });

  it("closes a bid whose payload is not JSON without touching the payload", async () => {
    seed([
      { id: "ex:text", deadline: "10/12/2026", rawPayload: "not json" },
      { id: "ex:null", deadline: "10/12/2026", rawPayload: null },
      { id: "ex:array", deadline: "10/12/2026", rawPayload: "[1,2]" },
      { id: "ex:empty-object", deadline: "10/12/2026", rawPayload: "{}" },
    ]);
    const result = await sweep();

    expect(result.closed).toBe(4);
    expect(read("ex:text")).toMatchObject({ lifecycleStatus: "closed", isActive: 0, rawPayload: "not json", updatedAt: NOW_ISO });
    expect(read("ex:null")).toMatchObject({ lifecycleStatus: "closed", isActive: 0, rawPayload: null });
    expect(read("ex:array")).toMatchObject({ lifecycleStatus: "closed", rawPayload: "[1,2]" });
    expect(JSON.parse(read("ex:empty-object").rawPayload!)).toEqual({
      lifecycle: { closed_reason: "deadline_passed", closed_observed_at: NOW_ISO, deadline: "10/12/2026" },
    });
  });

  it("gives the same answer when it pages two rows at a time", async () => {
    seed();
    const result = await sweep({ batchSize: 2 });

    expect(result).toEqual({ ...EXPECTED, dryRun: false });
    expect(closedIds()).toEqual(EXPIRED);
    const paged = snapshot();

    await testDb.cleanup();
    testDb = await createTestDatabase({ seed: false });
    seed();
    await sweep();
    expect(snapshot()).toEqual(paged);
  });

  it("reads every page: a page boundary skips nothing, whatever the page size", async () => {
    seed();
    let pages = 0;
    watchSelects((sql) => { if (/ORDER BY id/i.test(sql)) pages += 1; });

    for (const batchSize of [1, 2, 3, OPEN_ROWS - 1, OPEN_ROWS, OPEN_ROWS + 1, 500]) {
      pages = 0;
      const result = await sweep({ batchSize, dryRun: true });
      expect(result).toMatchObject({ scanned: OPEN_ROWS, closed: EXPIRED.length, unparseable: UNREADABLE.length });
      // A full page says there may be more, so the sweep asks once more; a short page ends it.
      expect(pages).toBe(Math.floor(OPEN_ROWS / batchSize) + 1);
    }
  });

  it("pages through more bids than one default page holds", async () => {
    const rows: Seed[] = Array.from({ length: 1_250 }, (_, index) => ({
      id: `bulk:${String(index).padStart(5, "0")}`, deadline: index % 2 === 0 ? "10/12/2026" : "10/20/2026", issuerType: index % 5 === 0 ? "county" : "state",
    }));
    for (let start = 0; start < rows.length; start += 250) seed(rows.slice(start, start + 250));
    let pages = 0;
    watchSelects((sql) => { if (/ORDER BY id/i.test(sql)) pages += 1; });

    const result = await sweep();

    expect(pages).toBe(3);
    expect(result).toMatchObject({ scanned: 1_250, closed: 625, unparseable: 0 });
    expect(result.closedByIssuerType.county! + result.closedByIssuerType.state!).toBe(625);
    expect(testDb.db.select().from(bids).all().filter((row) => row.lifecycleStatus === "open")).toHaveLength(625);
  });

  it("prepares the closing UPDATE once per page of closures, not once per bid", async () => {
    const rows: Seed[] = Array.from({ length: 12 }, (_, index) => ({ id: `many:${String(index).padStart(2, "0")}`, deadline: "10/12/2026" }));
    seed(rows);
    const client = testDb.db.$client;
    const prepare = client.prepare.bind(client);
    const updates: string[] = [];
    vi.spyOn(client, "prepare").mockImplementation(((sql: string) => {
      if (/^\s*UPDATE bids SET lifecycle_status = 'closed'/i.test(sql)) updates.push(sql);
      return prepare(sql);
    }) as typeof client.prepare);

    expect(await sweep()).toMatchObject({ scanned: 12, closed: 12 });
    // One page: at most the two shapes of the statement (with and without a payload to rewrite), however many bids it closes.
    expect(updates.length).toBeLessThanOrEqual(2);

    updates.length = 0;
    seed([{ id: "more:1", deadline: "10/12/2026" }, { id: "more:2", deadline: "10/12/2026" }, { id: "more:3", deadline: "10/12/2026" }, { id: "more:4", deadline: "10/12/2026" }]);
    expect(await sweep({ batchSize: 2 })).toMatchObject({ scanned: 4, closed: 4 });
    // Two pages of closures: at most two statements each.
    expect(updates.length).toBeLessThanOrEqual(4);
  });

  it("holds a bid whose time has no AM/PM open until its PM reading, then closes it", async () => {
    seed([
      { id: "ampm:two", deadline: "10/13/2026 2:00" }, // 02:00 is NOW, but as a PM hour it runs to 00:00Z on the 14th: stays open
      { id: "ampm:noon", deadline: "10/13/2026 12:00" }, // noon is noon: 22:00Z, still ahead
      { id: "ampm:evening", deadline: "10/12/2026 7:30" }, // its PM reading, 19:30 on the 12th (05:30Z on the 13th), has passed
      { id: "ampm:small-hours", deadline: "10/13/2026 0:30" }, // hour 0 cannot be PM: 10:30Z, passed
      { id: "ampm:given", deadline: "10/13/2026 2:00 AM" }, // the AM is given: 12:00Z, passed
    ]);
    const result = await sweep();

    expect(result).toMatchObject({ scanned: 5, closed: 3, unparseable: 0 });
    expect(closedIds()).toEqual(["ampm:evening", "ampm:given", "ampm:small-hours"]);
    for (const id of ["ampm:two", "ampm:noon"]) expect(read(id)).toMatchObject({ lifecycleStatus: "open", isActive: 1, updatedAt: SEEDED_AT });

    // Later that day: noon closes at its own 22:00Z, and 2:00 stays open until its PM reading, 00:00Z on the 14th.
    const sweepAt = (now: string) => sweepExpiredBids({ database: testDb.db }, { now: new Date(now) });
    expect(await sweepAt("2026-10-13T21:59:59.999Z")).toMatchObject({ closed: 0 });
    expect(await sweepAt("2026-10-13T22:00:00.000Z")).toMatchObject({ closed: 1 });
    expect(read("ampm:noon")).toMatchObject({ lifecycleStatus: "closed", isActive: 0 });
    expect(read("ampm:two")).toMatchObject({ lifecycleStatus: "open", isActive: 1 });
    expect(await sweepAt("2026-10-13T23:59:59.999Z")).toMatchObject({ closed: 0 });
    expect(await sweepAt("2026-10-14T00:00:00.000Z")).toMatchObject({ closed: 1 });
    expect(read("ampm:two")).toMatchObject({ lifecycleStatus: "closed", isActive: 0 });
  });

  it("ignores a batch size that is not a positive whole number", async () => {
    seed();
    for (const batchSize of [0, -3, 1.5, Number.NaN]) {
      expect(await sweep({ batchSize, dryRun: true })).toMatchObject({ scanned: OPEN_ROWS, closed: EXPIRED.length });
    }
  });

  it("does not close a bid whose deadline an import moved ahead after the sweep read the page", async () => {
    seed([{ id: "race:moved", deadline: "10/12/2026" }, { id: "race:expired", deadline: "10/12/2026" }]);
    let moved = false;
    // The page has been read; before the sweep reads the payloads it is about to write, an import extends one deadline.
    watchSelects((sql) => {
      if (/raw_payload/i.test(sql) && !moved) {
        moved = true;
        testDb.db.update(bids).set({ deadlineDate: "12/31/2026", rawPayload: '{"imported":"later"}' }).where(eq(bids.id, "race:moved")).run();
      }
    });

    const result = await sweep();

    expect(moved).toBe(true);
    expect(result).toMatchObject({ scanned: 2, closed: 1, closedByIssuerType: { state: 1 } });
    expect(read("race:moved")).toMatchObject({ lifecycleStatus: "open", isActive: 1, deadlineDate: "12/31/2026", rawPayload: '{"imported":"later"}' });
    expect(read("race:expired")).toMatchObject({ lifecycleStatus: "closed", isActive: 0 });
  });

  it("returns an empty result when there is nothing open", async () => {
    expect(await sweep()).toEqual({ scanned: 0, closed: 0, unparseable: 0, closedByIssuerType: {}, dryRun: false });
  });

  it("works with the quoted-id and unusual-character ids bids really have", async () => {
    seed([{ id: "il_bidbuy:Q'1;--", deadline: "10/12/2026" }, { id: "bidnet_co_x:00043%_9", deadline: "10/12/2026" }]);
    expect(await sweep({ batchSize: 1 })).toMatchObject({ scanned: 2, closed: 2 });
  });
});
