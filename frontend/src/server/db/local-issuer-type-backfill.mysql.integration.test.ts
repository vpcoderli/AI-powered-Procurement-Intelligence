import { randomUUID } from "node:crypto";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMysqlPool, runMysqlMigrations } from "@/server/db/mysql";
import { getBidByIdFromMysql } from "@/server/bids/repository";

const NOW = "2026-10-01T00:00:00Z";

describe.runIf(Boolean(process.env.CRAWLER_INTEGRATION_MYSQL_URL))("legacy local issuer_type backfill on real MySQL", () => {
  const databaseName = `apsi_crawler_test_${randomUUID().replaceAll("-", "")}`;
  let admin: ReturnType<typeof createMysqlPool>;
  let mysql: ReturnType<typeof createMysqlPool>;

  beforeAll(async () => {
    // Always a new isolated schema; never migrate or clear the supplied database.
    const url = new URL(process.env.CRAWLER_INTEGRATION_MYSQL_URL!);
    url.pathname = "/";
    admin = createMysqlPool(url.toString());
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    url.pathname = `/${databaseName}`;
    mysql = createPool({ uri: url.toString(), connectionLimit: 1 });
    await runMysqlMigrations(mysql);
  }, 60_000);

  afterAll(async () => {
    if (mysql) await mysql.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
  });

  it("aligns only legacy rows of registered local sources, idempotently", async () => {
    await mysql.query(
      "INSERT INTO data_sources (id, label, issuer_type, jurisdiction_level, state_code, fips_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)",
      ["bidnet_co_boulder", "Boulder County, CO (BidNet)", "county", "county", "CO", "08013", NOW, NOW,
        "co_state", "Colorado State Procurement", "state", "state", "CO", "08", NOW, NOW],
    );
    // (source, source_bid_id) is unique, and co_state:1 and unknown_portal:1 share source_bid_id "1", so the state row needs its own source label.
    const legacy = (id: string, jurisdictionLevel: string, fipsCode = "08013", source = "Boulder County, CO (BidNet)") => {
      const sourceBidId = id.slice(id.indexOf(":") + 1);
      return [id, source, sourceBidId, id, "Road repairs",
        "Resurface county roads and provide traffic management.", "Boulder County", "state", jurisdictionLevel, "CO", fipsCode,
        `https://www.bidnetdirect.com/colorado/bouldercounty/bid/${sourceBidId}`, NOW, NOW, NOW, NOW];
    };
    for (const values of [legacy("bidnet_co_boulder:legacy", "county"), legacy("bidnet_co_boulder:conflict", "city"),
      legacy("co_state:1", "state", "08", "Colorado State Procurement"), legacy("unknown_portal:1", "county")]) {
      await mysql.query(
        "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, jurisdiction_level, state_code, fips_code, source_url, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        values,
      );
    }
    expect(await getBidByIdFromMysql(mysql, "bidnet_co_boulder:legacy")).toBeUndefined();

    await runMysqlMigrations(mysql);
    await runMysqlMigrations(mysql);

    const [rows] = await mysql.query("SELECT id, issuer_type FROM bids");
    expect(Object.fromEntries((rows as Array<{ id: string; issuer_type: string }>).map((row) => [row.id, row.issuer_type]))).toEqual({
      "bidnet_co_boulder:legacy": "county", "bidnet_co_boulder:conflict": "state", "co_state:1": "state", "unknown_portal:1": "state",
    });
    expect(await getBidByIdFromMysql(mysql, "bidnet_co_boulder:legacy")).toBeDefined();
  });
});
