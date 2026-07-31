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
        raw_payload: JSON.stringify({ id: "TX-JSON-1" }),
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
    ).rejects.toThrow("Crawler MySQL JSON import refused a successful run with no bid rows.");
  });

  it("includes jurisdiction_level, jurisdiction_name, and fips_code in the emitted bids upsert SQL and persists their values", async () => {
    let capturedSql = "";
    let capturedValues: unknown[] = [];
    const mysql = {
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
          raw_payload: values[22],
          quality_flags_json: values[24],
          updated_at: values[34],
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
