import { describe, expect, it } from "vitest";
import { importCrawlerJsonRunIntoMysql } from "./mysql-json-importer";

const NOW = "2026-06-01T00:00:00.000Z";

describe("crawler JSON MySQL importer", () => {
  it("imports non-empty JSON crawler payloads directly into MySQL", async () => {
    const mysql = createFakeMysql();

    const result = await importCrawlerJsonRunIntoMysql(mysql, {
      source: "tx_esbd",
      runId: "json_run_1",
      status: "success",
      startedAt: NOW,
      finishedAt: NOW,
      durationMs: 10,
      metadata: { mode: "json" },
      bids: [
        {
          id: "json_bid_1",
          source: "tx_esbd",
          source_bid_id: "TX-JSON-1",
          dedupe_key: "tx_esbd:TX-JSON-1",
          title: "JSON Imported Bid",
          description: "Direct JSON crawler content",
          full_description: "Direct JSON crawler content with detail",
          original_category: "IT",
          amount: "$100",
          amount_min: 100,
          amount_max: 200,
          currency: "USD",
          published_date: "2026-05-30",
          deadline_date: "2026-07-01",
          issuer_name: "Texas Agency",
          issuer_type: "state",
          state_code: "TX",
          contact_name: "Buyer",
          contact_email: "buyer@example.com",
          contact_phone: "555-0100",
          source_url: "https://example.com/tx-json-1",
          is_active: 1,
          raw_payload: { id: "TX-JSON-1" },
          source_confidence: "high",
          quality_flags_json: ["has_attachment"],
          admin_review_status: "unreviewed",
          detail_archive_status: "archived",
          detail_archive_path: "/tmp/detail.html",
          detail_fetched_at: NOW,
          detail_checksum_sha256: "detail-checksum",
          detail_archive_error: null,
          first_seen_at: NOW,
          last_seen_at: NOW,
          created_at: NOW,
          updated_at: NOW,
          attachments: [
            {
              name: "Scope.pdf",
              url: "https://example.com/scope.pdf",
              original_url: "https://example.com/scope.pdf",
              storage_path: "/tmp/scope.pdf",
              byte_size: 42,
              content_type: "application/pdf",
              checksum_sha256: "scope-checksum",
              fetched_at: NOW,
              archive_status: "archived",
              archive_error: null,
              size_label: "42 B",
              mime_type: "application/pdf",
              sort_order: 0,
            },
          ],
        },
      ],
    });

    expect(result).toEqual({
      fetchedCount: 1,
      insertedCount: 1,
      updatedCount: 0,
      logCount: 1,
    });
    expect([...mysql.bids.values()]).toEqual([
      expect.objectContaining({
        id: "json_bid_1",
        dedupe_key: "tx_esbd:TX-JSON-1",
        title: "JSON Imported Bid",
        raw_payload: expect.stringContaining('"id":"TX-JSON-1"'),
        quality_flags_json: JSON.stringify(["has_attachment"]),
      }),
    ]);
    expect(mysql.attachments).toEqual([
      expect.objectContaining({
        id: "json_bid_1:attachment:1",
        bid_id: "json_bid_1",
        name: "Scope.pdf",
        archive_status: "archived",
      }),
    ]);
    expect(mysql.logs).toEqual([
      expect.objectContaining({
        source: "tx_esbd",
        status: "success",
        fetched_count: 1,
        inserted_count: 1,
        updated_count: 0,
      }),
    ]);
  });

  it("rejects successful JSON crawler payloads with no bid content", async () => {
    await expect(
      importCrawlerJsonRunIntoMysql(createFakeMysql(), {
        source: "empty_source",
        runId: "json_run_empty",
        status: "success",
        startedAt: NOW,
        finishedAt: NOW,
        durationMs: 1,
        metadata: {},
        bids: [],
      }),
    ).rejects.toThrow("Crawler JSON import refused a successful run with no bid rows.");
  });

  it("includes jurisdiction_level, jurisdiction_name, and fips_code in the emitted bids upsert SQL and persists their values", async () => {
    let capturedSql = "";
    let capturedValues: unknown[] = [];
    const mysql = {
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {},
      execute: async (sql: string, values: unknown[] = []) => {
        if (sql.includes("INSERT INTO bids")) {
          capturedSql = sql;
          capturedValues = values;
        }
        return [{ affectedRows: 1 }, undefined] as [unknown, unknown?];
      },
      query: async () => [[], undefined] as [unknown[], unknown?],
    };

    await importCrawlerJsonRunIntoMysql(mysql, {
      source: "jurisdiction_source",
      runId: "json_run_jurisdiction",
      status: "success",
      startedAt: NOW,
      bids: [
        {
          id: "json_bid_jurisdiction",
          source: "jurisdiction_source",
          dedupe_key: "jurisdiction_source:1",
          title: "Jurisdiction stamped bid",
          description: "d",
          issuer_name: "Issuer",
          issuer_type: "state",
          state_code: "CA",
          source_url: "https://example.com/jurisdiction",
          jurisdiction_level: "state",
          jurisdiction_name: "California",
          fips_code: "06",
        },
      ],
    });

    // Column list and bound values must agree positionally — assert both so a column added to
    // the SQL text without a matching `valueByColumn` branch (or vice versa) would fail here.
    expect(capturedSql).toContain("jurisdiction_level");
    expect(capturedSql).toContain("jurisdiction_name");
    expect(capturedSql).toContain("fips_code");

    const columnNames = capturedSql
      .slice(capturedSql.indexOf("(") + 1, capturedSql.indexOf(")"))
      .split(",")
      .map((column) => column.trim());
    expect(columnNames.at(-3)).toBe("jurisdiction_level");
    expect(columnNames.at(-2)).toBe("jurisdiction_name");
    expect(columnNames.at(-1)).toBe("fips_code");
    expect(capturedValues.at(-3)).toBe("state");
    expect(capturedValues.at(-2)).toBe("California");
    expect(capturedValues.at(-1)).toBe("06");
  });

  it("persists null jurisdiction columns when a payload (e.g. SAM.gov) does not carry the keys", async () => {
    let capturedValues: unknown[] = [];
    const mysql = {
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {},
      execute: async (sql: string, values: unknown[] = []) => {
        if (sql.includes("INSERT INTO bids")) capturedValues = values;
        return [{ affectedRows: 1 }, undefined] as [unknown, unknown?];
      },
      query: async () => [[], undefined] as [unknown[], unknown?],
    };

    await importCrawlerJsonRunIntoMysql(mysql, {
      source: "sam_gov",
      runId: "json_run_no_jurisdiction",
      status: "success",
      startedAt: NOW,
      bids: [
        {
          id: "json_bid_no_jurisdiction",
          source: "sam_gov",
          dedupe_key: "sam_gov:1",
          title: "No jurisdiction keys",
          description: "d",
          issuer_name: "Issuer",
          issuer_type: "federal",
          state_code: "US",
          source_url: "https://example.com/sam",
        },
      ],
    });

    expect(capturedValues.at(-3)).toBeNull();
    expect(capturedValues.at(-2)).toBeNull();
    expect(capturedValues.at(-1)).toBeNull();
  });

  it("uses one acquired connection for reads, writes, commit, and release", async () => {
    const mysql = createFakeMysql();
    await importCrawlerJsonRunIntoMysql(mysql, payload({ description: "Scope", attachments: [{ url: "https://x/a" }] }));
    expect(mysql.events[0]).toBe("acquire");
    expect(mysql.events[1]).toBe("begin");
    expect(mysql.events.slice(-2)).toEqual(["commit", "release"]);
    expect(mysql.events).not.toContain("pool-query");
    expect(mysql.events).not.toContain("pool-execute");
  });

  it("refuses a store with no transaction capability before any bid write", async () => {
    const mysql = createFakeMysql();
    await expect(importCrawlerJsonRunIntoMysql({ query: mysql.query, execute: mysql.execute }, payload())).rejects.toThrow(/transaction/i);
    expect(mysql.bids.size).toBe(0);
  });

  it("merges detailed fields and attachments across repeated list-only imports", async () => {
    const mysql = createFakeMysql();
    await importCrawlerJsonRunIntoMysql(mysql, payload({
      description: "Detailed scope", full_description: "Complete detailed scope", original_category: "Construction", contact_email: "jane@example.gov", detail_fetched_at: NOW,
      raw_payload: { enrichment: { applied_fields: ["description", "full_description", "original_category", "contact_email"], fields: { description: "selector" } } },
      attachments: [{ id: "a", name: "A", url: "https://x/a", storage_path: "/archive/a", archive_status: "archived" }, { id: "b", name: "B", url: "https://x/b" }],
    }));
    for (let n = 0; n < 2; n += 1) {
      await importCrawlerJsonRunIntoMysql(mysql, payload({
        description: "List scope", full_description: "ROAD  REPAIR", original_category: "General", contact_email: "help@example.gov", raw_payload: { list: n },
        attachments: [{ id: "different-id", name: "Updated A", url: "https://x/a", archive_status: "not_archived" }],
      }));
    }
    const row = [...mysql.bids.values()][0];
    expect(row).toMatchObject({ description: "Detailed scope", full_description: "Complete detailed scope", original_category: "Construction", contact_email: "jane@example.gov" });
    expect(JSON.parse(String(row.raw_payload))).toMatchObject({ list: 1, enrichment: { fields: { description: "selector" } } });
    expect(mysql.attachments).toHaveLength(2);
    expect(mysql.attachments[0]).toMatchObject({ id: "a", name: "Updated A", storage_path: "/archive/a", archive_status: "archived" });
  });

  it("rolls back all writes and logs failure after a mid-run attachment error", async () => {
    const mysql = createFakeMysql();
    await importCrawlerJsonRunIntoMysql(mysql, payload({ description: "Original" }));
    mysql.failAttachment = true;
    const failed = payload({ description: "Changed", attachments: [{ url: "https://x/a" }] });
    await expect(importCrawlerJsonRunIntoMysql(mysql, failed)).rejects.toThrow("attachment unavailable");
    expect([...mysql.bids.values()][0].description).toBe("Original");
    expect(mysql.attachments).toHaveLength(0);
    expect(mysql.logs.find((row) => row.run_id === failed.runId)).toMatchObject({ status: "failure", inserted_count: 0, updated_count: 0, error_code: "CrawlerPersistenceError" });
    expect(mysql.events).toContain("rollback");
  });

  it("accepts an explained date-filtered zero-row success", async () => {
    const mysql = createFakeMysql();
    expect(await importCrawlerJsonRunIntoMysql(mysql, { ...payload(), bids: [], metadata: { dateFilter: { from: "2026-09-01", to: null, kept: 0, dropped: 2, unparsed: 0 } } })).toEqual({ fetchedCount: 0, insertedCount: 0, updatedCount: 0, logCount: 1 });
    expect(mysql.logs[0].status).toBe("success");
  });

  it("accepts a verified empty-state zero-row success and rejects an unconfirmed tenant", async () => {
    const mysql = createFakeMysql();
    const emptyState = { verified: true, tenant_confirmed: true, marker: "There are no open bids at this time.", method: "adapter" };
    expect(await importCrawlerJsonRunIntoMysql(mysql, { ...payload(), bids: [], metadata: { emptyState } })).toEqual({ fetchedCount: 0, insertedCount: 0, updatedCount: 0, logCount: 1 });
    expect(mysql.logs[0].status).toBe("success");
    await expect(
      importCrawlerJsonRunIntoMysql(createFakeMysql(), {
        ...payload(),
        bids: [],
        metadata: { emptyState: { ...emptyState, tenant_confirmed: false } },
      }),
    ).rejects.toThrow("Crawler JSON import refused a successful run with no bid rows.");
  });

  it("preserves successful bid archive metadata when a later list import has no archive", async () => {
    const mysql = createFakeMysql();
    await importCrawlerJsonRunIntoMysql(mysql, payload({ detail_archive_status: "archived", detail_archive_path: "/archive/detail.html", detail_checksum_sha256: "sha", detail_fetched_at: NOW, detail_archive_error: null }));
    await importCrawlerJsonRunIntoMysql(mysql, payload({ detail_archive_status: "not_archived", detail_archive_path: null, detail_checksum_sha256: null, detail_fetched_at: null, detail_archive_error: null }));
    expect([...mysql.bids.values()][0]).toMatchObject({ detail_archive_status: "archived", detail_archive_path: "/archive/detail.html", detail_checksum_sha256: "sha", detail_fetched_at: NOW, detail_archive_error: null });
  });

  it("locks and checks the source lease using the write connection and rolls back expiry", async () => {
    const mysql = createFakeMysql();
    mysql.lease = { source: "il_bidbuy", owner: "lease-owner", expiresAt: "2026-06-01T00:00:01.000Z" };
    let now = NOW;
    mysql.beforeAttachment = () => { now = "2026-06-01T00:00:02.000Z"; };
    const run = payload({ attachments: [{ url: "https://x/a" }] });
    await expect(importCrawlerJsonRunIntoMysql(mysql, run, { source: "il_bidbuy", owner: "lease-owner", now: () => now })).rejects.toThrow(/lease was lost/);
    expect(mysql.bids.size).toBe(0);
    expect(mysql.attachments).toHaveLength(0);
    // The opening lease check is a plain read (a held row lock would block the heartbeat);
    // only the pre-commit check locks the row.
    expect(mysql.events.filter((event) => event === "lease-read")).toHaveLength(1);
    expect(mysql.events.filter((event) => event === "lease-lock")).toHaveLength(1);
    expect(mysql.events.indexOf("lease-read")).toBeLessThan(mysql.events.indexOf("lease-lock"));
    expect(mysql.logs[0]).toMatchObject({ status: "failure", error_code: "CrawlerLeaseLostError", inserted_count: 0 });
    expect(mysql.events).not.toContain("commit");
  });

  it("rolls back if lease cancellation arrives during an otherwise valid write", async () => {
    const mysql = createFakeMysql();
    const controller = new AbortController();
    mysql.lease = { source: "il_bidbuy", owner: "lease-owner", expiresAt: "2026-06-01T00:10:00.000Z" };
    mysql.beforeAttachment = () => controller.abort();
    await expect(importCrawlerJsonRunIntoMysql(mysql, payload({ attachments: [{ url: "https://x/a" }] }), { source: "il_bidbuy", owner: "lease-owner", now: () => NOW, signal: controller.signal })).rejects.toThrow(/lease was lost/);
    expect(mysql.bids.size).toBe(0);
    expect(mysql.events).not.toContain("commit");
  });
});

let sequence = 0;
function payload(overrides: Record<string, unknown> = {}) {
  return { source: "il_bidbuy", runId: `run_${sequence++}`, status: "success" as const, startedAt: NOW, bids: [{ id: "bid_1", source: "Illinois BidBuy", dedupe_key: "il_bidbuy:1", title: "Road Repair", state_code: "IL", source_url: "https://x/1", ...overrides }] };
}

// An explicit transaction-capable connection fake tests orchestration and bound values.
// Real SQL constraint/rollback behavior is checked by the isolated MySQL integration suite.
function createFakeMysql() {
  const bids = new Map<string, Record<string, unknown>>();
  const attachments: Record<string, unknown>[] = [];
  const logs: Record<string, unknown>[] = [];
  const events: string[] = [];
  let snapshot: { bids: typeof bids; attachments: typeof attachments; logs: typeof logs };
  const execute = async (sql: string, values: unknown[] = []): Promise<[unknown, unknown?]> => {
    events.push("execute");
    const match = sql.match(/INSERT INTO (bids|bid_attachments|crawler_logs) \(([^)]+)\)/);
    if (match) {
      const columns = match[2].split(",").map((name) => name.trim());
      const row = Object.fromEntries(columns.map((name, index) => [name, values[index]]));
      if (match[1] === "bids") {
        const existing = [...bids.values()].find((bid) => bid.dedupe_key === row.dedupe_key || bid.id === row.id);
        if (existing) {
          // Mirror the real ON DUPLICATE KEY UPDATE column list: identity/first-seen columns stay.
          const update = Object.fromEntries(Object.entries(row).filter(([column]) => !["id", "source", "dedupe_key", "first_seen_at", "created_at"].includes(column)));
          bids.set(String(existing.id), { ...existing, ...update });
        } else {
          bids.set(String(row.id), row);
        }
      } else if (match[1] === "bid_attachments") {
        store.beforeAttachment?.();
        if (store.failAttachment) throw new Error("attachment unavailable");
        const index = attachments.findIndex((attachment) => attachment.id === row.id);
        if (index >= 0) attachments[index] = row;
        else attachments.push(row);
      } else logs.push(row);
    }
    if (sql.includes("DELETE FROM bid_attachments")) {
      for (let index = attachments.length - 1; index >= 0; index -= 1) {
        if (attachments[index].bid_id === values[0]) attachments.splice(index, 1);
      }
    }
    return [{ affectedRows: 1 }, undefined];
  };
  const query = async (sql: string, values: unknown[] = []): Promise<[unknown[], unknown?]> => {
    events.push("query");
    if (sql.includes("FROM crawler_locks")) {
      events.push(sql.includes("FOR UPDATE") ? "lease-lock" : "lease-read");
      return [store.lease && store.lease.source === values[0] ? [store.lease] : [], undefined];
    }
    if (sql.includes("FROM bids WHERE id = ?")) return [[...bids.values()].filter((row) => row.id === values[0]), undefined];
    if (sql.includes("FROM bids WHERE dedupe_key = ?")) return [[...bids.values()].filter((row) => row.dedupe_key === values[0]), undefined];
    if (sql.includes("FROM bid_attachments WHERE")) return [attachments.filter((row) => row.bid_id === values[0]), undefined];
    return [[], undefined];
  };
  const connection = {
    query, execute,
    beginTransaction: async () => { events.push("begin"); snapshot = structuredClone({ bids, attachments, logs }); },
    commit: async () => { events.push("commit"); },
    rollback: async () => {
      events.push("rollback");
      bids.clear();
      for (const [key, value] of snapshot.bids) bids.set(key, value);
      attachments.splice(0, attachments.length, ...snapshot.attachments);
      logs.splice(0, logs.length, ...snapshot.logs);
    },
    release: () => { events.push("release"); },
  };
  const store = {
    bids, attachments, logs, events, failAttachment: false,
    lease: null as { source: string; owner: string; expiresAt: string } | null,
    beforeAttachment: undefined as (() => void) | undefined,
    query: async (sql: string, values: unknown[] = []) => { events.push("pool-query"); return query(sql, values); },
    execute: async (sql: string, values: unknown[] = []) => { events.push("pool-execute"); return execute(sql, values); },
    getConnection: async () => { events.push("acquire"); return connection; },
  };
  return store;
}
