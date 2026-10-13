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

  // (source, source_bid_id) is unique, and several fixture ids share source_bid_id "1", so a row can carry its own source label.
  const legacy = (id: string, jurisdictionLevel: string | null, fipsCode: string | null = "08013", source = "Boulder County, CO (BidNet)", stateCode = "CO", rawPayload: string | null = null) => {
    const sourceBidId = id.slice(id.indexOf(":") + 1);
    return [id, source, sourceBidId, id, "Road repairs",
      "Resurface county roads and provide traffic management.", "Boulder County", "state", jurisdictionLevel, stateCode, fipsCode,
      `https://www.bidnetdirect.com/colorado/bouldercounty/bid/${sourceBidId}`, rawPayload, NOW, NOW, NOW, NOW];
  };
  const insertLegacy = async (values: Array<string | null>) => {
    await mysql.query(
      "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, jurisdiction_level, state_code, fips_code, source_url, raw_payload, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      values,
    );
  };
  const snapshot = async () => {
    const [rows] = await mysql.query("SELECT * FROM bids ORDER BY id");
    return rows as Array<Record<string, string | null>>;
  };

  it("aligns only legacy rows of registered local sources, idempotently", async () => {
    await mysql.query(
      "INSERT INTO data_sources (id, label, issuer_type, jurisdiction_level, state_code, fips_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)",
      ["bidnet_co_boulder", "Boulder County, CO (BidNet)", "county", "county", "CO", "08013", NOW, NOW,
        "co_state", "Colorado State Procurement", "state", "state", "CO", "08", NOW, NOW],
    );
    // drift: the stored FIPS disagrees with the source's, so the first statement leaves the row and the FIPS-drift statements
    // align it. nulllevel: a missing level does not conflict.
    // lowercase: the state code differs only in case; the importer's identity check compares it exactly, so that row stays as it is.
    for (const values of [legacy("bidnet_co_boulder:legacy", "county"), legacy("bidnet_co_boulder:conflict", "city"),
      legacy("co_state:1", "state", "08", "Colorado State Procurement"), legacy("unknown_portal:1", "county"),
      legacy("bidnet_co_boulder:drift", "county", "08014", undefined, undefined, JSON.stringify({ detail_access: "locked" })),
      legacy("bidnet_co_boulder:nulllevel", null),
      legacy("bidnet_co_boulder:lowercase", "county", "08013", "Boulder County, CO (BidNet)", "co")]) {
      await insertLegacy(values);
    }
    expect(await getBidByIdFromMysql(mysql, "bidnet_co_boulder:legacy")).toBeUndefined();

    await runMysqlMigrations(mysql);
    const afterFirstRun = await snapshot();
    await runMysqlMigrations(mysql);

    const [rows] = await mysql.query("SELECT id, issuer_type, fips_code, raw_payload FROM bids");
    const byId = Object.fromEntries((rows as Array<{ id: string; issuer_type: string; fips_code: string | null; raw_payload: string | null }>).map((row) => [row.id, row]));
    expect(Object.fromEntries(Object.entries(byId).map(([id, row]) => [id, row.issuer_type]))).toEqual({
      "bidnet_co_boulder:legacy": "county", "bidnet_co_boulder:conflict": "state", "co_state:1": "state", "unknown_portal:1": "state",
      "bidnet_co_boulder:drift": "county", "bidnet_co_boulder:nulllevel": "county", "bidnet_co_boulder:lowercase": "state",
    });
    expect(byId["bidnet_co_boulder:drift"].fips_code).toBe("08013");
    expect(JSON.parse(byId["bidnet_co_boulder:drift"].raw_payload!)).toEqual({ detail_access: "locked", legacy_fips_code: "08014" });
    expect(await getBidByIdFromMysql(mysql, "bidnet_co_boulder:legacy")).toBeDefined();
    expect(await getBidByIdFromMysql(mysql, "bidnet_co_boulder:drift")).toBeDefined();
    expect(await snapshot()).toEqual(afterFirstRun);
  }, 60_000);

  it("corrects a drifted row whatever its raw_payload, and leaves a row alone when anything else disagrees with its source", async () => {
    await mysql.query(
      "INSERT INTO data_sources (id, label, issuer_type, jurisdiction_level, state_code, fips_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["bidnet_co_city_aurora", "City of Aurora, CO (BidNet)", "city", "city", "CO", "0804000", NOW, NOW],
    );
    const aurora = (name: string, rawPayload: string | null, overrides: { level?: string | null; state?: string; fips?: string | null; id?: string } = {}) =>
      legacy(overrides.id ?? `bidnet_co_city_aurora:${name}`, overrides.level === undefined ? "city" : overrides.level, overrides.fips === undefined ? "0803455" : overrides.fips,
        "City of Aurora, CO (BidNet)", overrides.state ?? "CO", rawPayload);
    const corrected: Record<string, string | null> = {
      "bidnet_co_city_aurora:object": JSON.stringify({ lifecycle: { closed_reason: "delisted" } }),
      // Not a JSON object, so there is nowhere to put legacy_fips_code: the row is still corrected, its payload kept as it was.
      "bidnet_co_city_aurora:text": "not json {", "bidnet_co_city_aurora:array": "[1,2,3]", "bidnet_co_city_aurora:scalar": "42",
      "bidnet_co_city_aurora:string": "\"just text\"", "bidnet_co_city_aurora:empty": "", "bidnet_co_city_aurora:null": null,
    };
    for (const [id, rawPayload] of Object.entries(corrected)) await insertLegacy(aurora(id.split(":")[1], rawPayload));
    const untouched = [
      aurora("lowercase", "{}", { state: "co" }), aurora("conflict", "{}", { level: "county" }), aurora("elsewhere", "{}", { state: "WY" }),
      aurora("nullfips", "{}", { fips: null }), aurora("blankfips", "{}", { fips: "" }), aurora("match", "{}", { fips: "0804000" }),
    ];
    for (const values of untouched) await insertLegacy(values);

    await runMysqlMigrations(mysql);
    const afterFirstRun = await snapshot();
    await runMysqlMigrations(mysql);

    const rows = Object.fromEntries((await snapshot()).map((row) => [row.id, row]));
    for (const [id, rawPayload] of Object.entries(corrected)) {
      expect(rows[id], id).toMatchObject({ issuer_type: "city", fips_code: "0804000" });
      if (id.endsWith(":object")) expect(JSON.parse(rows[id].raw_payload!)).toEqual({ lifecycle: { closed_reason: "delisted" }, legacy_fips_code: "0803455" });
      else expect(rows[id].raw_payload, id).toBe(rawPayload);
    }
    // Only the first statement re-types these, and it never fills in or changes a FIPS.
    expect(rows["bidnet_co_city_aurora:nullfips"]).toMatchObject({ issuer_type: "city", fips_code: null, raw_payload: "{}" });
    expect(rows["bidnet_co_city_aurora:blankfips"]).toMatchObject({ issuer_type: "city", fips_code: "", raw_payload: "{}" });
    expect(rows["bidnet_co_city_aurora:match"]).toMatchObject({ issuer_type: "city", fips_code: "0804000", raw_payload: "{}" });
    // Drifted too, but also disagreeing with the source on state or level: untouched, FIPS and payload included.
    for (const name of ["lowercase", "conflict", "elsewhere"]) {
      expect(rows[`bidnet_co_city_aurora:${name}`], name).toMatchObject({ issuer_type: "state", fips_code: "0803455", raw_payload: "{}" });
    }
    expect(await snapshot()).toEqual(afterFirstRun);
  }, 60_000);
});
