import { describe, expect, it, vi } from "vitest";
import {
  applyAttachmentRepairWritesToMysql,
  attachmentRepairLogStatement,
  attachmentUpdateStatement,
  listAttachmentRepairCandidatesFromMysql,
  listAttachmentsForVerificationFromMysql,
  type MysqlAttachmentStore,
} from "./mysql-repository";

const NOW = new Date("2026-09-16T00:00:00.000Z");

/** `rows` answers attachment reads; `sources` answers the data_sources policy read. */
function fakeReader(rows: Record<string, unknown>[] = [], sources: Record<string, unknown>[] = []) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  return {
    calls,
    /** The attachment read (the policy read, when there is one, comes first). */
    attachmentCall: () => calls.find((call) => call.sql.includes("FROM bid_attachments a"))!,
    store: {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values });
        return [sql.includes("bid_attachments") ? rows : sources] as [unknown[]];
      }),
      execute: vi.fn(async () => [{ affectedRows: 1 }] as [unknown]),
    },
  };
}

function fakeTransactionPool() {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const events: string[] = [];
  const connection = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      return [[]] as [unknown[]];
    }),
    execute: vi.fn(async () => [{ affectedRows: 1 }] as [unknown]),
    beginTransaction: vi.fn(async () => { events.push("begin"); }),
    commit: vi.fn(async () => { events.push("commit"); }),
    rollback: vi.fn(async () => { events.push("rollback"); }),
    release: vi.fn(() => { events.push("release"); }),
  };

  return {
    statements,
    events,
    connection,
    store: { ...connection, getConnection: vi.fn(async () => connection) } as unknown as MysqlAttachmentStore,
  };
}

describe("listAttachmentRepairCandidatesFromMysql", () => {
  it("joins bids and data_sources and binds the due/parked cutoffs", async () => {
    const reader = fakeReader();

    await listAttachmentRepairCandidatesFromMysql(reader.store, { now: NOW, limit: 25 });

    const call = reader.attachmentCall();
    expect(call.sql).toContain("INNER JOIN bids b ON b.id = a.bid_id");
    expect(call.sql).toContain("LEFT JOIN data_sources d ON d.id = b.source OR d.label = b.source");
    expect(call.sql).toContain("a.archive_status IN ('not_archived', 'failed')");
    expect(call.sql).toContain("a.next_repair_at IS NULL OR a.next_repair_at <= ?");
    expect(call.sql).toContain("a.archive_status = 'unavailable'");
    expect(call.sql).toContain("LIMIT 25");
    expect(call.values).toEqual([NOW.toISOString(), "2026-08-17T00:00:00.000Z"]);
  });

  it("expands a source filter over both the bid source and the data source id", async () => {
    const reader = fakeReader();

    await listAttachmentRepairCandidatesFromMysql(reader.store, { now: NOW, sourceIds: ["il_bidbuy", "Missouri"] });

    const call = reader.attachmentCall();
    expect(call.sql).toContain("AND (b.source IN (?, ?) OR d.id IN (?, ?))");
    expect(call.values.slice(2)).toEqual(["il_bidbuy", "Missouri", "il_bidbuy", "Missouri"]);
  });

  it("ranks candidates inside each source and keeps only that source's window", async () => {
    const reader = fakeReader();

    await listAttachmentRepairCandidatesFromMysql(reader.store, { now: NOW });

    const call = reader.attachmentCall();
    expect(call.sql).toContain(
      "ROW_NUMBER() OVER (PARTITION BY COALESCE(d.id, b.source) ORDER BY CASE WHEN a.failure_kind IN ('archive_missing', 'archive_corrupt') THEN 0 WHEN a.archive_status = 'not_archived' THEN 1 ELSE 2 END ASC, a.id ASC) AS sourceRank",
    );
    expect(call.sql).toContain("WHERE ranked.sourceRank <= 50");
    // Every source's first candidate comes before any source's second, so the run-wide cap cuts evenly.
    expect(call.sql).toContain("ORDER BY ranked.sourceRank ASC, ranked.sourceKey ASC, ranked.id ASC");
    expect(call.sql).toContain("LIMIT 5000");
    // The data source a row was ranked under is the one it is returned with.
    expect(call.sql).toContain("LEFT JOIN data_sources d ON d.id = picked.dataSourceId");
    expect(call.sql).toContain("ORDER BY picked.sourceRank ASC, picked.sourceKey ASC, a.id ASC");
    expect(call.values).toEqual([NOW.toISOString(), "2026-08-17T00:00:00.000Z"]);
  });

  it("reads every source's policy to drop archive-off sources and size each window", async () => {
    const reader = fakeReader([], [
      { id: "il_bidbuy", fetchConfig: JSON.stringify({ attachments: { archive: false } }) },
      { id: "sam_gov", fetchConfig: JSON.stringify({ attachments: { max_per_run: 7 } }) },
      { id: "broken", fetchConfig: "{not json" },
    ]);

    await listAttachmentRepairCandidatesFromMysql(reader.store, { now: NOW, maxPerSource: 10 });

    expect(reader.calls[0].sql).toContain("SELECT id, fetch_config AS fetchConfig FROM data_sources WHERE fetch_config IS NOT NULL");
    const call = reader.attachmentCall();
    expect(call.sql).toContain("AND (d.id IS NULL OR d.id NOT IN (?))");
    expect(call.sql).toContain("WHERE ranked.sourceRank <= CASE ranked.dataSourceId WHEN ? THEN 7 ELSE 10 END");
    expect(call.values).toEqual([NOW.toISOString(), "2026-08-17T00:00:00.000Z", "il_bidbuy", "sam_gov"]);
  });

  it("normalizes rows and drops duplicates produced by the data_sources join", async () => {
    const raw = {
      id: "att-1",
      bidId: "bid-1",
      name: "Doc.pdf",
      url: "https://portal/doc.pdf",
      originalUrl: null,
      storagePath: null,
      byteSize: "2048",
      contentType: null,
      checksumSha256: null,
      archiveStatus: "failed",
      archiveError: null,
      failureKind: "timeout",
      repairAttempts: "2",
      nextRepairAt: "2026-09-10T00:00:00.000Z",
      verifiedAt: null,
      bidSource: "Illinois BidBuy",
      bidSourceUrl: "https://portal/detail",
      bidSourceBidId: "27-444",
      sourceId: "il_bidbuy",
      sourceLabel: "Illinois BidBuy",
      fetchConfig: "{}",
    };
    const reader = fakeReader([raw, { ...raw, sourceId: "il_other" }]);

    const rows = await listAttachmentRepairCandidatesFromMysql(reader.store, { now: NOW });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ byteSize: 2048, repairAttempts: 2, sourceId: "il_bidbuy" });
  });
});

describe("listAttachmentsForVerificationFromMysql", () => {
  it("selects archived rows whose verification is stale", async () => {
    const reader = fakeReader();

    await listAttachmentsForVerificationFromMysql(reader.store, { verifyBefore: NOW, limit: 10 });

    const [call] = reader.calls;
    expect(call.sql).toContain("a.archive_status = 'archived'");
    expect(call.sql).toContain("a.verified_at IS NULL OR a.verified_at <= ?");
    expect(call.sql).toContain("LIMIT 10");
    expect(call.values).toEqual([NOW.toISOString()]);
  });
});

describe("statement builders", () => {
  it("writes only the provided columns, id last", () => {
    expect(attachmentUpdateStatement({ id: "att-1", archiveStatus: "archived", checksumSha256: "abc" })).toEqual({
      sql: "UPDATE bid_attachments SET archive_status = ?, checksum_sha256 = ? WHERE id = ?",
      values: ["archived", "abc", "att-1"],
    });
    expect(attachmentUpdateStatement({ id: "att-1" })).toBeNull();
    expect(attachmentUpdateStatement({ id: "att-1", verifiedAt: null })?.values).toEqual([null, "att-1"]);
  });

  it("stamps the crawler_logs row with the attachment_repair source", () => {
    const statement = attachmentRepairLogStatement({
      id: "log-1",
      runId: "run-1",
      status: "success",
      startedAt: "a",
      finishedAt: "b",
      durationMs: 1,
      fetchedCount: 2,
      insertedCount: 3,
      updatedCount: 4,
      skippedCount: 5,
      failedCount: 6,
      errorCode: null,
      errorMessage: null,
      metadata: "{}",
    });

    expect(statement.sql).toContain("INSERT INTO crawler_logs (id, source, run_id");
    expect(statement.values[1]).toBe("attachment_repair");
    expect(statement.values.slice(6, 12)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("applyAttachmentRepairWritesToMysql", () => {
  it("commits updates and the log on one connection", async () => {
    const pool = fakeTransactionPool();

    await applyAttachmentRepairWritesToMysql(pool.store, {
      updates: [{ id: "att-1", archiveStatus: "archived" }],
      log: {
        id: "log-1",
        runId: "run-1",
        status: "success",
        startedAt: "a",
        finishedAt: "b",
        durationMs: 1,
        fetchedCount: 1,
        insertedCount: 1,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        errorCode: null,
        errorMessage: null,
        metadata: "{}",
      },
    });

    expect(pool.events).toEqual(["begin", "commit", "release"]);
    expect(pool.statements.map((statement) => statement.sql.split(" ").slice(0, 3).join(" "))).toEqual([
      "UPDATE bid_attachments SET",
      "INSERT INTO crawler_logs",
    ]);
  });

  it("rolls back when a statement fails", async () => {
    const pool = fakeTransactionPool();
    pool.connection.query.mockRejectedValueOnce(new Error("deadlock"));

    await expect(
      applyAttachmentRepairWritesToMysql(pool.store, { updates: [{ id: "att-1", archiveStatus: "archived" }] }),
    ).rejects.toThrow("deadlock");

    expect(pool.events).toEqual(["begin", "rollback", "release"]);
  });

  it("is a no-op when there is nothing to write", async () => {
    const pool = fakeTransactionPool();

    expect(await applyAttachmentRepairWritesToMysql(pool.store, {})).toBe(0);
    expect(pool.events).toEqual([]);
  });

  it("refuses a pool that cannot open a transaction", async () => {
    const reader = fakeReader();

    await expect(
      applyAttachmentRepairWritesToMysql(reader.store as unknown as MysqlAttachmentStore, {
        updates: [{ id: "att-1", archiveStatus: "archived" }],
      }),
    ).rejects.toThrow("transaction-capable pool");
  });
});
