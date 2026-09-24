import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { createMysqlPool, runMysqlMigrations } from "@/server/db/mysql";
import { getBidByIdFromMysql, getBidByIdFromRepository } from "@/server/bids/repository";
import { queryBidsFromDatabase } from "@/server/bids/service";
import { importCrawlerJsonRunIntoSqlite } from "./sqlite-json-importer";
import { importCrawlerJsonRunIntoMysql, type CrawlerJsonRunPayload } from "./mysql-json-importer";

interface LifecycleFixture {
  first: CrawlerJsonRunPayload;
  second: CrawlerJsonRunPayload;
  removedId: string;
}

describe.runIf(process.env.RUN_CRAWLER_INTEGRATION === "1")("BidNet lifecycle through the real reader, sidecar and importers", () => {
  let fixture: LifecycleFixture;

  beforeAll(() => {
    fixture = JSON.parse(execFileSync(
      process.env.CRAWLER_INTEGRATION_PYTHON || "python3",
      [path.resolve("scripts/fixtures/bidnet-lifecycle-pipeline.py")],
      { encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
    ));
  }, 65_000);

  it("walks the saved list on the Scrapling main path and proves it complete", () => {
    expect(fixture.first.metadata?.listExtraction).toMatchObject({ method: "scrapling" });
    expect(fixture.first.metadata?.pagination).toMatchObject({ list_kind: "open", complete: true, pages_fetched: 1 });
    expect(fixture.first.bids).toHaveLength(6);
    expect(fixture.first.bids![0]).toMatchObject({ solicitation_number: "11205A", lifecycle_status: "open" });
    expect(fixture.second.bids).toHaveLength(5);
  });

  it("closes the delisted bid in SQLite and drops it from search", async () => {
    const database = await createTestDatabase({ seed: false });
    try {
      importCrawlerJsonRunIntoSqlite(database.db, fixture.first);
      const result = importCrawlerJsonRunIntoSqlite(database.db, fixture.second);
      expect(result.delistedCount).toBe(1);
      expect(await getBidByIdFromRepository(database.db, fixture.removedId)).toMatchObject({ lifecycleStatus: "closed", isActive: false });
      const open = await queryBidsFromDatabase(database.db, {});
      expect(open.bids.map((bid) => bid.id)).not.toContain(fixture.removedId);
      expect(open.bids.every((bid) => bid.solicitationNumber)).toBe(true);
    } finally {
      await database.cleanup();
    }
  });

  describe.runIf(Boolean(process.env.CRAWLER_INTEGRATION_MYSQL_URL))("real MySQL", () => {
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

    it("closes the delisted bid in MySQL", async () => {
      await importCrawlerJsonRunIntoMysql(mysql, fixture.first);
      const result = await importCrawlerJsonRunIntoMysql(mysql, fixture.second);
      expect(result.delistedCount).toBe(1);
      expect(await getBidByIdFromMysql(mysql, fixture.removedId)).toMatchObject({ lifecycleStatus: "closed", isActive: false });
    });
  });
});
