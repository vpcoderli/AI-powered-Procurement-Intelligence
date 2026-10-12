import { randomUUID } from "node:crypto";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BID_CHILD_REFERENCES, type BidChildReference } from "@/server/db/bid-child-references";
import { createMysqlPool, mysqlDataMigrationStatements, runMysqlMigrations } from "@/server/db/mysql";

const NOW = "2026-10-13T00:00:00Z";
const SOURCE = "New York State Contract Reporter";
const MARKER = "This is a subcontracting opportunity";
type BidRow = Record<string, string | null>;

/**
 * A subcontracting card as the spider stored it before it learned the "Company:" label: the company text was glued
 * onto the CR# value, so the id, dedupe key and source bid id all carry it, the card has no Agency (the normalizer's
 * placeholder issuer), and the marker sentence trails the title.
 */
function malformedBid(cr: string, company: string, overrides: BidRow = {}): BidRow {
  const sourceBidId = `${cr} Company: ${company}`;
  const id = `ny_contract_reporter:${sourceBidId}`;
  return {
    id, source: SOURCE, source_bid_id: sourceBidId, dedupe_key: id,
    title: `Empire State Plaza Decarb Plan ${MARKER}`, description: `Empire State Plaza Decarb Plan ${MARKER}`,
    issuer_name: "Unknown state agency", issuer_type: "state", jurisdiction_level: null, state_code: "NY",
    source_url: `https://www.nyscr.ny.gov/Ads/Details/${cr}`, deadline_date: "9/8/2026",
    raw_payload: JSON.stringify({ source_bid_id: sourceBidId }),
    first_seen_at: NOW, last_seen_at: NOW, created_at: NOW, updated_at: NOW,
    ...overrides,
  };
}

/** What the fixed spider stores: `ny_contract_reporter:<CR#>`. */
function cleanBid(cr: string, overrides: BidRow = {}): BidRow {
  const id = `ny_contract_reporter:${cr}`;
  return {
    ...malformedBid(cr, "unused"), id, source_bid_id: cr, dedupe_key: id,
    title: "Empire State Plaza Decarb Plan", description: "A clean row", issuer_name: "Pike Construction Services, Inc.",
    ...overrides,
  };
}

describe.runIf(Boolean(process.env.CRAWLER_INTEGRATION_MYSQL_URL))("NY Contract Reporter subcontracting re-key on real MySQL", () => {
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

  beforeEach(async () => {
    for (const { table } of BID_CHILD_REFERENCES) await mysql.query(`DELETE FROM ${table}`);
    await mysql.query("DELETE FROM bids");
  });

  const insertBids = async (rows: BidRow[]) => {
    for (const row of rows) {
      const columns = Object.keys(row);
      await mysql.query(`INSERT INTO bids (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, columns.map((column) => row[column]));
    }
  };
  const allBids = async () => ((await mysql.query("SELECT * FROM bids ORDER BY id"))[0] as BidRow[]);
  const rowOf = async (id: string) => (await allBids()).find((row) => row.id === id)!;
  /** Only the data fixes, the same statements runMysqlMigrations ends with. */
  const applyDataMigrations = async () => { for (const statement of mysqlDataMigrationStatements()) await mysql.query(statement); };

  /** A row in one of the child tables, filled with dummy values for everything but the reference. */
  const insertChildRow = async ({ table, column }: BidChildReference, bidId: string) => {
    const [columns] = await mysql.query(
      "SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt, COLUMN_KEY AS columnKey FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?",
      [table],
    );
    const values = new Map<string, string | number>();
    for (const info of columns as Array<{ name: string; dataType: string; nullable: string; dflt: string | null; columnKey: string }>) {
      if (info.name === column) values.set(info.name, bidId);
      else if (info.columnKey === "PRI" || (info.nullable === "NO" && info.dflt === null)) values.set(info.name, /int/i.test(info.dataType) ? 0 : `${table}:${bidId}`);
    }
    const names = [...values.keys()];
    await mysql.query(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`, [...values.values()]);
  };

  it("re-keys a malformed row that has no clean twin and no children, field by field", async () => {
    await insertBids([malformedBid("2138281", "Pike Construction Services, Inc.", { title: `PIKE CS - NYS OGS Empire State Plaza Decarb Plan ${MARKER}` })]);
    const [before] = await allBids();

    await applyDataMigrations();

    expect(await allBids()).toEqual([{
      ...before,
      id: "ny_contract_reporter:2138281", dedupe_key: "ny_contract_reporter:2138281", source_bid_id: "2138281",
      issuer_name: "Pike Construction Services, Inc.", title: "PIKE CS - NYS OGS Empire State Plaza Decarb Plan",
    }]);
  }, 30_000);

  it("names the contractor as issuer only where the issuer is blank or a placeholder", async () => {
    const cases: Array<[string, string, string]> = [
      ["2000001", "Unknown state agency", "Acme Builders, LLC"],
      ["2000002", "Unknown", "Acme Builders, LLC"],
      ["2000003", "", "Acme Builders, LLC"],
      ["2000004", "Office of General Services", "Office of General Services"],
    ];
    await insertBids(cases.map(([cr, issuerName]) => malformedBid(cr, "Acme Builders, LLC", { issuer_name: issuerName })));

    await applyDataMigrations();

    for (const [cr, , expected] of cases) expect((await rowOf(`ny_contract_reporter:${cr}`)).issuer_name, cr).toBe(expected);
  }, 30_000);

  it("strips a trailing subcontracting sentence from the title, ignoring case, and trims what is left", async () => {
    const cases: Array<[string, string, string]> = [
      ["2100001", `Razran Hall Renovation ${MARKER}`, "Razran Hall Renovation"],
      ["2100002", `Razran Hall Renovation ${MARKER.toUpperCase()}`, "Razran Hall Renovation"],
      ["2100003", `Razran Hall Renovation   ${MARKER.toLowerCase()}  `, "Razran Hall Renovation"],
      ["2100004", "Razran Hall Renovation", "Razran Hall Renovation"],
      ["2100005", `${MARKER} for Razran Hall Renovation`, `${MARKER} for Razran Hall Renovation`],
      ["2100006", `Razran Hall ${MARKER} Renovation`, `Razran Hall ${MARKER} Renovation`],
    ];
    await insertBids(cases.map(([cr, title]) => malformedBid(cr, "Acme Builders, LLC", { title })));

    await applyDataMigrations();

    for (const [cr, , expected] of cases) expect((await rowOf(`ny_contract_reporter:${cr}`)).title, cr).toBe(expected);
  }, 30_000);

  it("deletes a malformed row whose clean twin already exists and leaves the twin as it is", async () => {
    await insertBids([malformedBid("2138289", "E.W. Howell Co., LLC."), cleanBid("2138289", { title: "Twin title", updated_at: "2026-10-12T00:00:00Z" })]);
    const twin = await rowOf("ny_contract_reporter:2138289");

    await applyDataMigrations();

    expect(await allBids()).toEqual([twin]);
  }, 30_000);

  it("deletes the second of two malformed rows for one CR# once the first has taken the clean key, and never throws", async () => {
    await insertBids([malformedBid("2138400", "Dup Builders, LLC"), malformedBid("2138400", "Dup Builders LLC")]);

    await applyDataMigrations();

    const rows = await allBids();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "ny_contract_reporter:2138400", dedupe_key: "ny_contract_reporter:2138400", source_bid_id: "2138400" });
  }, 30_000);

  it("leaves a malformed row alone while any table points at it, with or without a clean twin", async () => {
    // MySQL has no foreign keys, so a re-key or delete would orphan these rows without a word.
    for (const [index, reference] of BID_CHILD_REFERENCES.entries()) {
      const lonely = malformedBid(String(3000 + index), "Lonely Co");
      const twinned = malformedBid(String(4000 + index), "Twinned Co");
      await insertBids([lonely, twinned, cleanBid(String(4000 + index))]);
      await insertChildRow(reference, lonely.id!);
      await insertChildRow(reference, twinned.id!);
    }
    const before = await allBids();
    expect(before).toHaveLength(BID_CHILD_REFERENCES.length * 3);

    await applyDataMigrations();

    expect(await allBids()).toEqual(before);
    for (const { table, column } of BID_CHILD_REFERENCES) {
      const [rows] = await mysql.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} LIKE 'ny!_contract!_reporter:%' ESCAPE '!'`);
      expect(Number((rows as Array<{ n: number }>)[0].n), table).toBe(2);
    }
  }, 60_000);

  it("never touches a clean row or anything that only looks like a malformed one", async () => {
    await insertBids([
      // Clean rows that would qualify for cleanup if they were malformed.
      cleanBid("2138281", { title: `Razran Hall Renovation ${MARKER}`, issuer_name: "Unknown state agency" }),
      cleanBid("2138282"),
      // The marker in another source's id.
      { ...malformedBid("77", "Foo"), id: "bidnet_ny_foo:77 Company: Foo", dedupe_key: "bidnet_ny_foo:77 Company: Foo" },
      // "_" is a LIKE wildcard: a different prefix of the same length must not match.
      { ...malformedBid("78", "Foo"), id: "nyXcontractXreporter:78 Company: Foo", dedupe_key: "nyXcontractXreporter:78 Company: Foo" },
      // The marker's case differs. MySQL's LIKE and LOCATE ignore case under the default collation, SUBSTRING_INDEX does not.
      malformedBid("79", "Foo", { source_bid_id: "79 company: Foo", id: "ny_contract_reporter:79 company: Foo", dedupe_key: "ny_contract_reporter:79 company: Foo" }),
      // The id carries the marker but the source bid id does not: not the shape this repair knows.
      malformedBid("80", "Foo", { source_bid_id: "80" }),
      // The id and source bid id disagree.
      malformedBid("81", "Foo", { source_bid_id: "82 Company: Foo" }),
      // The id and source bid id differ only in case: MySQL's default comparison would call them equal.
      malformedBid("83", "Foo", { id: "NY_CONTRACT_REPORTER:83 Company: Foo", dedupe_key: "NY_CONTRACT_REPORTER:83 Company: Foo" }),
      // No CR# before the marker.
      malformedBid("", "Foo"),
    ]);
    const before = await allBids();

    await applyDataMigrations();

    expect(await allBids()).toEqual(before);
  }, 30_000);

  it("skips, without throwing, a row whose clean dedupe key or (source, source bid id) another row already holds", async () => {
    await insertBids([
      malformedBid("500", "Dedupe Clash"),
      { ...cleanBid("501"), id: "elsewhere:1", source_bid_id: "1", dedupe_key: "ny_contract_reporter:500" },
      malformedBid("600", "Source Clash"),
      { ...cleanBid("601"), id: "elsewhere:2", source_bid_id: "600", dedupe_key: "elsewhere:2" },
    ]);
    const before = await allBids();

    await applyDataMigrations();

    expect(await allBids()).toEqual(before);
  }, 30_000);

  it("changes nothing the second time, through the full migration", async () => {
    const saved = malformedBid("2138300", "Saver Co");
    await insertBids([
      malformedBid("2138281", "Pike Construction Services, Inc."), malformedBid("2138289", "E.W. Howell Co., LLC."), cleanBid("2138289"),
      saved, malformedBid("2138400", "Dup A"), malformedBid("2138400", "Dup B"),
    ]);
    await insertChildRow({ table: "saved_bids", column: "bid_id" }, saved.id!);

    await runMysqlMigrations(mysql);
    const afterFirstRun = await allBids();
    await runMysqlMigrations(mysql);

    expect(afterFirstRun.map((row) => row.id)).toEqual(["ny_contract_reporter:2138281", "ny_contract_reporter:2138289", "ny_contract_reporter:2138300 Company: Saver Co", "ny_contract_reporter:2138400"]);
    expect(await allBids()).toEqual(afterFirstRun);
  }, 60_000);
});
