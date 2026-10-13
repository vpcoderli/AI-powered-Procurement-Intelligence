import { randomUUID } from "node:crypto";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BID_CHILD_REFERENCES, type BidChildReference } from "@/server/db/bid-child-references";
import { createMysqlPool, MYSQL_NY_SUBCONTRACT_REKEY, mysqlDataMigrationStatements, runMysqlMigrations } from "@/server/db/mysql";

const NOW = "2026-10-13T00:00:00Z";
const SOURCE = "New York State Contract Reporter";
const MARKER = "This is a subcontracting opportunity";
type BidRow = Record<string, string | null>;

/** What the importer stamped on a malformed row while its placeholder issuer made it core-invalid. */
const STALE_DATA_QUALITY = {
  schemaVersion: 1, checkedAt: NOW, coreValid: false, coreIssues: ["invalid_issuer"], warnings: ["missing_valid_body"],
  capabilities: { discovery: false, analysis: false, attachments: false },
  body: { valid: false, reason: "missing_or_invalid", verifiedAt: null, reused: false },
  attachments: { discovered: 0, archived: 0, verified: 0 },
};

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
    const oldTitle = `PIKE CS - NYS OGS Empire State Plaza Decarb Plan ${MARKER}`;
    await insertBids([malformedBid("2138281", "Pike Construction Services, Inc.", {
      title: oldTitle,
      // The spider copied the title into the description (the card has no Note:), so both bodies echo the OLD title.
      description: oldTitle, full_description: oldTitle,
      raw_payload: JSON.stringify({ source_bid_id: "2138281 Company: Pike Construction Services, Inc.", title: oldTitle, data_quality: STALE_DATA_QUALITY, enrichment: { applied_fields: [] } }),
    })]);
    const [before] = await allBids();

    await applyDataMigrations();

    const rows = await allBids();
    expect(rows).toEqual([{
      ...before,
      id: "ny_contract_reporter:2138281", dedupe_key: "ny_contract_reporter:2138281", source_bid_id: "2138281",
      issuer_name: "Pike Construction Services, Inc.", title: "PIKE CS - NYS OGS Empire State Plaza Decarb Plan",
      // Once the title is cleaned a copy of the old title would no longer read as a title echo and would be shown as a body.
      description: "", full_description: null,
      raw_payload: rows[0].raw_payload,
    }]);
    // The stale quality verdict (the invalid placeholder issuer) is gone, so the row is judged by its fields again; the rest stays.
    expect(JSON.parse(rows[0].raw_payload!)).toEqual({
      source_bid_id: "2138281 Company: Pike Construction Services, Inc.", title: oldTitle, enrichment: { applied_fields: [] },
      contractor_company: "Pike Construction Services, Inc.", subcontracting: true,
    });
  }, 30_000);

  it("clears a body that echoes the old title, however it is cased or padded, and keeps a real one", async () => {
    const title = `Razran Hall Renovation ${MARKER}`;
    const real = "Furnish and install new HVAC equipment at Razran Hall, including commissioning and training.";
    const cases: Array<[string, BidRow, { description: string; full_description: string | null }]> = [
      ["2200001", { description: real, full_description: `${real} Quotes are due 9/8/2026.` }, { description: real, full_description: `${real} Quotes are due 9/8/2026.` }],
      // A body that merely contains the title but says more is a real body.
      ["2200002", { description: `${title}. Furnish and install new HVAC equipment.`, full_description: null }, { description: `${title}. Furnish and install new HVAC equipment.`, full_description: null }],
      // Only one of the two bodies echoes the title.
      ["2200003", { description: title, full_description: real }, { description: "", full_description: real }],
      ["2200004", { description: real, full_description: title }, { description: real, full_description: null }],
      // Case and edge padding do not make it a real body.
      ["2200005", { description: `  ${title.toUpperCase()}  `, full_description: ` ${title.toLowerCase()} ` }, { description: "", full_description: null }],
      // Nothing to clear.
      ["2200006", { description: "", full_description: null }, { description: "", full_description: null }],
    ];
    await insertBids(cases.map(([cr, bodies]) => malformedBid(cr, "Acme Builders, LLC", { title, ...bodies })));

    await applyDataMigrations();

    for (const [cr, , expected] of cases) {
      expect(await rowOf(`ny_contract_reporter:${cr}`), cr).toMatchObject({ title: "Razran Hall Renovation", ...expected });
    }
  }, 30_000);

  it("reads the company after the first ' Company: ' and trims it", async () => {
    await insertBids([malformedBid("2138500", "Acme Company: Holdings, LLC"), malformedBid("2138501", "  Padded Co  ")]);

    await applyDataMigrations();

    expect(await rowOf("ny_contract_reporter:2138500")).toMatchObject({ source_bid_id: "2138500", issuer_name: "Acme Company: Holdings, LLC" });
    expect(JSON.parse((await rowOf("ny_contract_reporter:2138500")).raw_payload!).contractor_company).toBe("Acme Company: Holdings, LLC");
    expect(await rowOf("ny_contract_reporter:2138501")).toMatchObject({ source_bid_id: "2138501", issuer_name: "Padded Co" });
    expect(JSON.parse((await rowOf("ny_contract_reporter:2138501")).raw_payload!).contractor_company).toBe("Padded Co");
  }, 30_000);

  it("refreshes the stored evidence of a re-keyed row only when raw_payload is a JSON object", async () => {
    const objects: Array<[string, string, Record<string, unknown>, Record<string, unknown>]> = [
      // [cr, title, payload before, payload after]
      ["2300001", `X ${MARKER}`, { data_quality: STALE_DATA_QUALITY, keep: 1 }, { keep: 1, contractor_company: "Acme Builders, LLC", subcontracting: true }],
      ["2300002", `X ${MARKER}`, { keep: 1 }, { keep: 1, contractor_company: "Acme Builders, LLC", subcontracting: true }],
      // The marker was not on the title: the flag is not added, and one that is there is left as it is.
      ["2300003", "X", { keep: 1, data_quality: STALE_DATA_QUALITY }, { keep: 1, contractor_company: "Acme Builders, LLC" }],
      ["2300004", "X", { subcontracting: false }, { subcontracting: false, contractor_company: "Acme Builders, LLC" }],
      ["2300005", `X ${MARKER}`, { subcontracting: false }, { subcontracting: true, contractor_company: "Acme Builders, LLC" }],
      // Only the top-level verdict goes.
      ["2300006", `X ${MARKER}`, { nested: { data_quality: 1 } }, { nested: { data_quality: 1 }, contractor_company: "Acme Builders, LLC", subcontracting: true }],
    ];
    const notObjects: Array<[string, string | null]> = [
      ["2300007", "not json {"], ["2300008", "[1,2,3]"], ["2300009", "42"], ["2300010", "\"just text\""], ["2300011", ""], ["2300012", null],
    ];
    await insertBids([
      ...objects.map(([cr, title, before]) => malformedBid(cr, "Acme Builders, LLC", { title, raw_payload: JSON.stringify(before) })),
      ...notObjects.map(([cr, rawPayload]) => malformedBid(cr, "Acme Builders, LLC", { raw_payload: rawPayload })),
    ]);

    await applyDataMigrations();

    for (const [cr, , , after] of objects) {
      expect(JSON.parse((await rowOf(`ny_contract_reporter:${cr}`)).raw_payload!), cr).toEqual(after);
    }
    for (const [cr, rawPayload] of notObjects) {
      // Still re-keyed; only the payload is left alone.
      expect(await rowOf(`ny_contract_reporter:${cr}`), cr).toMatchObject({ source_bid_id: cr, raw_payload: rawPayload });
    }
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
      // Like the spider, the sentence may be followed by any mix of ".", "!" and spaces, and nothing else.
      ["2100007", `Razran Hall Renovation ${MARKER}..`, "Razran Hall Renovation"],
      ["2100008", `Razran Hall Renovation ${MARKER.toUpperCase()}!`, "Razran Hall Renovation"],
      ["2100009", `Razran Hall Renovation ${MARKER} . ! .  `, "Razran Hall Renovation"],
      ["2100010", `Razran Hall Renovation   ${MARKER}..!`, "Razran Hall Renovation"],
      ["2100011", `Razran Hall Renovation ${MARKER}.y`, `Razran Hall Renovation ${MARKER}.y`],
      ["2100012", `Razran Hall Renovation ${MARKER}, thanks`, `Razran Hall Renovation ${MARKER}, thanks`],
      // The last sentence is the one that goes.
      ["2100013", `A ${MARKER}. B ${MARKER}!`, `A ${MARKER}. B`],
      // The sentence needs something before it; it alone is not a suffix.
      ["2100014", `${MARKER}.`, `${MARKER}.`],
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

  it("gives the same rows whether MySQL evaluates the assignments left to right or from the original row", async () => {
    // A single-table UPDATE with a plain WHERE evaluates its assignments left to right, each seeing the ones before it. The real
    // statement has subqueries in its WHERE (the twin and child checks), and on MySQL 8.4 that evaluates every assignment from the
    // original row. The order of the assignments is what makes the two agree, so run the same SET list down both paths.
    const fixtures = () => [
      malformedBid("2400001", "Acme Company: Holdings, LLC", {
        title: `Razran Hall Renovation ${MARKER}..`, description: `Razran Hall Renovation ${MARKER}..`, full_description: `Razran Hall Renovation ${MARKER}..`,
        raw_payload: JSON.stringify({ keep: 1, data_quality: STALE_DATA_QUALITY }),
      }),
      malformedBid("2400002", "  Padded Co  ", { issuer_name: "Office of General Services", description: "A real description.", raw_payload: "not json {" }),
    ];
    const withoutSubqueries = MYSQL_NY_SUBCONTRACT_REKEY.slice(0, MYSQL_NY_SUBCONTRACT_REKEY.indexOf(" AND NOT EXISTS "));
    expect(withoutSubqueries).not.toContain("SELECT");

    await insertBids(fixtures());
    await mysql.query(withoutSubqueries);
    const leftToRight = await allBids();
    await mysql.query("DELETE FROM bids");
    await insertBids(fixtures());
    await mysql.query(MYSQL_NY_SUBCONTRACT_REKEY);

    expect(await allBids()).toEqual(leftToRight);
    expect(leftToRight.map((row) => row.id)).toEqual(["ny_contract_reporter:2400001", "ny_contract_reporter:2400002"]);
    expect(leftToRight[0]).toMatchObject({ source_bid_id: "2400001", issuer_name: "Acme Company: Holdings, LLC", title: "Razran Hall Renovation", description: "", full_description: null });
    expect(leftToRight[1]).toMatchObject({ source_bid_id: "2400002", issuer_name: "Office of General Services", description: "A real description.", raw_payload: "not json {" });
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
