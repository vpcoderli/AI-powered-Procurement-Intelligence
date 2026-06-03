import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importCrawlerSqliteRunIntoMysql } from "./mysql-importer";

const NOW = "2026-06-01T00:00:00.000Z";

describe("crawler MySQL importer", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempSqlite() {
    const dir = mkdtempSync(path.join(os.tmpdir(), "crawler-mysql-import-"));
    tempDirs.push(dir);
    const databasePath = path.join(dir, "apsi.sqlite");
    const sqlite = new Database(databasePath);
    sqlite.exec(`
      CREATE TABLE bids (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_bid_id TEXT,
        dedupe_key TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        full_description TEXT,
        original_category TEXT,
        amount TEXT,
        amount_min INTEGER,
        amount_max INTEGER,
        currency TEXT NOT NULL DEFAULT 'USD',
        published_date TEXT,
        deadline_date TEXT,
        issuer_name TEXT NOT NULL,
        issuer_type TEXT NOT NULL,
        state_code TEXT NOT NULL,
        contact_name TEXT,
        contact_email TEXT,
        contact_phone TEXT,
        source_url TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        raw_payload TEXT,
        source_confidence TEXT NOT NULL DEFAULT 'medium',
        quality_flags_json TEXT NOT NULL DEFAULT '[]',
        admin_review_status TEXT NOT NULL DEFAULT 'unreviewed',
        detail_archive_status TEXT NOT NULL DEFAULT 'not_archived',
        detail_archive_path TEXT,
        detail_fetched_at TEXT,
        detail_checksum_sha256 TEXT,
        detail_archive_error TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE bid_attachments (
        id TEXT PRIMARY KEY,
        bid_id TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        original_url TEXT,
        storage_path TEXT,
        byte_size INTEGER,
        content_type TEXT,
        checksum_sha256 TEXT,
        fetched_at TEXT,
        archive_status TEXT NOT NULL DEFAULT 'not_archived',
        archive_error TEXT,
        size_label TEXT,
        mime_type TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE crawler_logs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        fetched_count INTEGER NOT NULL DEFAULT 0,
        inserted_count INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        error_stack TEXT,
        metadata TEXT
      );
    `);
    return { databasePath, sqlite };
  }

  it("upserts non-empty crawler bids, replaces attachments, and writes actual MySQL run counts", async () => {
    const { databasePath, sqlite } = tempSqlite();
    sqlite.prepare(`
      INSERT INTO bids (
        id, source, source_bid_id, dedupe_key, title, description, currency, deadline_date,
        issuer_name, issuer_type, state_code, source_url, source_confidence, quality_flags_json,
        detail_archive_status, first_seen_at, last_seen_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "crawler_bid_1",
      "tx_esbd",
      "TX-1",
      "tx_esbd:TX-1",
      "Crawler MySQL Bid",
      "Non-empty crawler description",
      "USD",
      "2026-08-01",
      "Texas Agency",
      "state",
      "TX",
      "https://example.com/tx-1",
      "high",
      "[]",
      "archived",
      NOW,
      NOW,
      NOW,
      NOW,
    );
    sqlite.prepare(`
      INSERT INTO bid_attachments (
        id, bid_id, name, url, original_url, storage_path, byte_size, content_type,
        checksum_sha256, fetched_at, archive_status, archive_error, size_label, mime_type, sort_order, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "crawler_bid_1:attachment:1",
      "crawler_bid_1",
      "Scope.pdf",
      "https://example.com/scope.pdf",
      "https://example.com/scope.pdf",
      "/tmp/scope.pdf",
      12,
      "application/pdf",
      "abc123",
      NOW,
      "archived",
      null,
      "12 B",
      "application/pdf",
      0,
      NOW,
    );
    sqlite.prepare(`
      INSERT INTO crawler_logs (
        id, source, run_id, status, started_at, finished_at, fetched_count,
        inserted_count, updated_count, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("log_1", "tx_esbd", "run_1", "success", NOW, NOW, 1, 1, 0, JSON.stringify({ mode: "fixture" }));
    sqlite.close();

    const mysql = createFakeMysql();
    mysql.bids.set("existing_bid", {
      id: "existing_bid",
      dedupe_key: "existing:bid",
      title: "Existing",
    });

    const result = await importCrawlerSqliteRunIntoMysql(mysql, databasePath);

    expect(result).toEqual({
      fetchedCount: 1,
      insertedCount: 1,
      updatedCount: 0,
      logCount: 1,
    });
    expect([...mysql.bids.values()]).toEqual([
      expect.objectContaining({ id: "existing_bid" }),
      expect.objectContaining({
        id: "crawler_bid_1",
        dedupe_key: "tx_esbd:TX-1",
        title: "Crawler MySQL Bid",
        description: "Non-empty crawler description",
      }),
    ]);
    expect(mysql.attachments).toEqual([
      expect.objectContaining({
        bid_id: "crawler_bid_1",
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

  it("rejects successful crawler runs with no bid content", async () => {
    const { databasePath, sqlite } = tempSqlite();
    sqlite.prepare(`
      INSERT INTO crawler_logs (
        id, source, run_id, status, started_at, finished_at, fetched_count, inserted_count, updated_count
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("log_empty", "empty_source", "run_empty", "success", NOW, NOW, 0, 0, 0);
    sqlite.close();

    await expect(importCrawlerSqliteRunIntoMysql(createFakeMysql(), databasePath)).rejects.toThrow(
      "Crawler MySQL import refused a successful run with no bid rows.",
    );
  });
});

function createFakeMysql() {
  const bids = new Map<string, Record<string, unknown>>();
  const attachments: Record<string, unknown>[] = [];
  const logs: Record<string, unknown>[] = [];

  return {
    bids,
    attachments,
    logs,
    execute: async (sql: string, values: unknown[] = []) => {
      if (sql.includes("INSERT INTO bids")) {
        const existing = [...bids.values()].find((row) => row.dedupe_key === values[3]);
        const id = existing?.id as string | undefined;
        bids.set(id ?? values[0] as string, {
          id: id ?? values[0],
          source: values[1],
          source_bid_id: values[2],
          dedupe_key: values[3],
          title: values[4],
          description: values[5],
          currency: values[11],
          deadline_date: values[13],
          issuer_name: values[14],
          issuer_type: values[15],
          state_code: values[16],
          source_url: values[20],
          updated_at: values[35],
        });
      }

      if (sql.includes("DELETE FROM bid_attachments")) {
        for (let index = attachments.length - 1; index >= 0; index -= 1) {
          if (attachments[index].bid_id === values[0]) attachments.splice(index, 1);
        }
      }

      if (sql.includes("INSERT INTO bid_attachments")) {
        attachments.push({
          id: values[0],
          bid_id: values[1],
          name: values[2],
          url: values[3],
          archive_status: values[10],
        });
      }

      if (sql.includes("INSERT INTO crawler_logs")) {
        logs.push({
          id: values[0],
          source: values[1],
          run_id: values[2],
          status: values[3],
          fetched_count: values[7],
          inserted_count: values[8],
          updated_count: values[9],
        });
      }

      return [{ affectedRows: 1 }, undefined];
    },
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT id FROM bids WHERE dedupe_key")) {
        return [[...bids.values()].filter((row) => row.dedupe_key === values[0]).map((row) => ({ id: row.id })), undefined];
      }

      return [[], undefined];
    },
  };
}
