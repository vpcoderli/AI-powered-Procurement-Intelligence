import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeResolvedMysqlPool,
  createMysqlPool,
  isMysqlDatabaseUrlConfigured,
  MYSQL_LOCAL_ISSUER_TYPE_BACKFILL,
  mysqlColumnMigrationStatements,
  mysqlDataMigrationStatements,
  mysqlIndexColumnModification,
  mysqlIndexMigrationStatements,
  mysqlMigrationStatements,
  mysqlPoolSizing,
  requireMysqlDatabaseUrl,
  resetMysqlPoolForTests,
  resolveMysqlPool,
} from "./mysql";

describe("mysql database foundation", () => {
  it("requires an explicit MySQL database URL", () => {
    expect(() => requireMysqlDatabaseUrl({})).toThrow("DATABASE_URL or MYSQL_DATABASE_URL is required");
    expect(() => requireMysqlDatabaseUrl({ DATABASE_URL: "postgres://localhost/db" })).toThrow(
      "must start with mysql://",
    );
    expect(requireMysqlDatabaseUrl({ MYSQL_DATABASE_URL: "mysql2://user:pass@localhost:3306/winbids" })).toBe(
      "mysql://user:pass@localhost:3306/winbids",
    );
    expect(isMysqlDatabaseUrlConfigured({ DATABASE_URL: "sqlite://local" })).toBe(false);
    expect(isMysqlDatabaseUrlConfigured({ MYSQL_DATABASE_URL: "mysql://user:pass@localhost:3306/winbids" })).toBe(true);
  });

  it("reuses the default MySQL pool for runtime calls", async () => {
    const pool = resolveMysqlPool("mysql://user:pass@localhost:3306/winbids");

    expect(resolveMysqlPool("mysql://user:pass@localhost:3306/winbids")).toBe(pool);

    resetMysqlPoolForTests();
    expect(resolveMysqlPool("mysql://user:pass@localhost:3306/winbids")).not.toBe(pool);

    // resetMysqlPoolForTests only forgets a pool; end both so no idle-connection timer outlives the test.
    await pool.end();
    await closeResolvedMysqlPool();
  });

  it("converts the local migration DDL into executable MySQL table statements", () => {
    const statements = mysqlMigrationStatements();
    const joined = statements.join("\n");

    expect(statements.length).toBeGreaterThan(40);
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS users");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS bids");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS data_sources");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS award_outcomes");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS artifact_versions");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS response_package_export_review_events");
    expect(joined).toContain("award_notice_url LONGTEXT NOT NULL DEFAULT ('')");
    expect(joined).toContain("idx_award_outcomes_intent_id");
    expect(joined).toContain("status LONGTEXT NOT NULL DEFAULT ('draft')");
    expect(joined).toContain("VARCHAR(191) PRIMARY KEY");
    expect(joined).not.toContain("PRAGMA");
    expect(joined).not.toContain("sqlite_master");
    expect(joined).not.toContain("CREATE INDEX IF NOT EXISTS");
    expect(joined).not.toContain("REFERENCES");
  });

  it("keeps MySQL row sizes safe while preserving long content columns", () => {
    const statements = mysqlMigrationStatements();
    const joined = statements.join("\n");
    const bidsTable = statements.find((statement) => statement.includes("CREATE TABLE IF NOT EXISTS bids"));
    const overridesTable = statements.find((statement) =>
      statement.includes("CREATE TABLE IF NOT EXISTS organization_feature_overrides"),
    );

    expect(joined).not.toContain("VARCHAR(2048)");
    expect(bidsTable).toContain("source VARCHAR(191) NOT NULL");
    expect(bidsTable).toContain("source_bid_id VARCHAR(191)");
    expect(bidsTable).toContain("description LONGTEXT NOT NULL");
    expect(bidsTable).toContain("full_description LONGTEXT");
    expect(bidsTable).toContain("quality_flags_json LONGTEXT NOT NULL DEFAULT ('[]')");
    expect(overridesTable).toContain("organization_id VARCHAR(191) NOT NULL");
    expect(overridesTable).toContain("feature_key VARCHAR(191) NOT NULL");
  });
});

describe("the default MySQL pool is shared through globalThis", () => {
  const url = "mysql://user:pass@localhost:3306/winbids";
  const sharedPool = () => (globalThis as { __apsiMysqlPool?: unknown }).__apsiMysqlPool;
  // Compares identities: a failed toBe() would print an entire mysql2 pool.
  const isSamePool = (a: unknown, b: unknown) => a === b;

  afterEach(async () => {
    await closeResolvedMysqlPool();
  });

  // Next dev re-evaluates server modules on every hot reload (and a route bundle can carry its own copy of
  // this one); a module-level variable then leaks one pool per evaluation. 2026-09-29: a long-lived dev
  // server held 147 of MySQL's 151 connections.
  it("gives a re-evaluated module the pool the first copy created", async () => {
    const pool = resolveMysqlPool(url);

    vi.resetModules();
    const reloaded = await import("./mysql");

    expect(reloaded.resolveMysqlPool).not.toBe(resolveMysqlPool);
    expect(isSamePool(reloaded.resolveMysqlPool(url), pool)).toBe(true);
    expect(isSamePool(resolveMysqlPool(url), pool)).toBe(true);
    expect(isSamePool(sharedPool(), pool)).toBe(true);
  });

  it("closeResolvedMysqlPool ends the shared pool and clears it for every module copy", async () => {
    const pool = resolveMysqlPool(url);
    const end = vi.spyOn(pool, "end");

    vi.resetModules();
    const reloaded = await import("./mysql");
    await reloaded.closeResolvedMysqlPool();

    expect(end).toHaveBeenCalledTimes(1);
    expect(sharedPool()).toBeUndefined();

    const next = resolveMysqlPool(url);
    expect(isSamePool(next, pool)).toBe(false);
    expect(isSamePool(reloaded.resolveMysqlPool(url), next)).toBe(true);

    // With nothing left to close the helper stays a no-op, so worker shutdown can call it unconditionally.
    await closeResolvedMysqlPool();
    await expect(closeResolvedMysqlPool()).resolves.toBeUndefined();
    expect(sharedPool()).toBeUndefined();
  });

  it("resetMysqlPoolForTests forgets the shared pool without ending it", async () => {
    const pool = resolveMysqlPool(url);
    const end = vi.spyOn(pool, "end");
    expect(isSamePool(sharedPool(), pool)).toBe(true);

    resetMysqlPoolForTests();

    expect(sharedPool()).toBeUndefined();
    expect(end).not.toHaveBeenCalled();
    expect(isSamePool(resolveMysqlPool(url), pool)).toBe(false);
    await pool.end();
  });

  it("only reads the databaseUrl argument when it has to create the pool", () => {
    const pool = resolveMysqlPool(url);

    expect(isSamePool(resolveMysqlPool("mysql://someone:else@elsewhere:3307/other"), pool)).toBe(true);
  });
});

describe("MySQL pool sizing", () => {
  const url = "mysql://user:pass@localhost:3306/winbids";
  const defaults = { connectionLimit: 10, maxIdle: 4, idleTimeout: 60_000 };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("caps idle connections and drops stale ones by default", () => {
    expect(mysqlPoolSizing({})).toEqual(defaults);
  });

  it("reads the connection limit, idle cap and idle timeout from the environment", () => {
    expect(
      mysqlPoolSizing({ MYSQL_CONNECTION_LIMIT: "25", MYSQL_MAX_IDLE: "6", MYSQL_IDLE_TIMEOUT_MS: "15000" }),
    ).toEqual({ connectionLimit: 25, maxIdle: 6, idleTimeout: 15_000 });
    expect(mysqlPoolSizing({ MYSQL_CONNECTION_LIMIT: " 25 " })).toEqual({ connectionLimit: 25, maxIdle: 4, idleTimeout: 60_000 });
  });

  it("never lets the idle cap exceed the connection limit", () => {
    expect(mysqlPoolSizing({ MYSQL_CONNECTION_LIMIT: "5", MYSQL_MAX_IDLE: "50" }).maxIdle).toBe(5);
  });

  it("honours an explicit idle cap of 0 but not a blank or negative one", () => {
    expect(mysqlPoolSizing({ MYSQL_MAX_IDLE: "0" }).maxIdle).toBe(0);
    for (const bad of ["", "  ", "abc", "-1", "1.5"]) {
      expect(mysqlPoolSizing({ MYSQL_MAX_IDLE: bad }).maxIdle).toBe(4);
    }
  });

  it("falls back to the defaults for a blank, non-numeric or non-positive limit or timeout", () => {
    for (const bad of ["", "  ", "abc", "0", "-3", "2.5", "10s"]) {
      expect(mysqlPoolSizing({ MYSQL_CONNECTION_LIMIT: bad, MYSQL_IDLE_TIMEOUT_MS: bad })).toEqual(defaults);
    }
  });

  // mysql2 only starts its idle-connection reaper while maxIdle < connectionLimit, and its own default
  // (maxIdle = connectionLimit) never does: idle connections were never released. A one-slot headroom
  // keeps the reaper armed for every pool that has more than one connection.
  it("keeps maxIdle below the limit for every pool larger than one connection", () => {
    for (let limit = 2; limit <= 64; limit += 1) {
      const { connectionLimit, maxIdle } = mysqlPoolSizing({ MYSQL_CONNECTION_LIMIT: String(limit) });

      expect(connectionLimit).toBe(limit);
      expect(maxIdle).toBeLessThan(connectionLimit);
      expect(maxIdle).toBeGreaterThanOrEqual(1);
      expect(maxIdle).toBeLessThanOrEqual(4);
    }
    expect(mysqlPoolSizing({ MYSQL_CONNECTION_LIMIT: "1" }).maxIdle).toBe(1);
  });

  it("hands mysql2 the default sizing", async () => {
    vi.stubEnv("MYSQL_CONNECTION_LIMIT", undefined);
    vi.stubEnv("MYSQL_MAX_IDLE", undefined);
    vi.stubEnv("MYSQL_IDLE_TIMEOUT_MS", undefined);
    const pool = createMysqlPool(url);

    try {
      expect(pool.pool.config).toMatchObject(defaults);
    } finally {
      await pool.end();
    }
  });

  it("hands mysql2 the sizing from the environment", async () => {
    vi.stubEnv("MYSQL_CONNECTION_LIMIT", "12");
    vi.stubEnv("MYSQL_MAX_IDLE", "3");
    vi.stubEnv("MYSQL_IDLE_TIMEOUT_MS", "20000");
    const pool = createMysqlPool(url);

    try {
      expect(pool.pool.config).toMatchObject({ connectionLimit: 12, maxIdle: 3, idleTimeout: 20_000 });
    } finally {
      await pool.end();
    }
  });

  // Without gracefulEnd mysql2's idle reaper only ends a free connection's socket, and MySQL counts every reaped
  // connection as an aborted client (Aborted_clients, and an "Aborted connection" entry in its log). With it the
  // reaper sends a proper quit first, as pool.end() always did. Checked against a real MySQL 8.4 on 2026-09-30.
  it("has the idle reaper close connections with a proper quit, whatever the sizing", async () => {
    const pools: Array<ReturnType<typeof createMysqlPool>> = [];

    try {
      vi.stubEnv("MYSQL_CONNECTION_LIMIT", "3");
      vi.stubEnv("MYSQL_MAX_IDLE", "1");
      vi.stubEnv("MYSQL_IDLE_TIMEOUT_MS", "2000");
      pools.push(createMysqlPool(url));
      vi.unstubAllEnvs();
      pools.push(createMysqlPool(url));

      for (const pool of pools) {
        expect(pool.pool.config).toMatchObject({
          connectionConfig: { gracefulEnd: true, multipleStatements: false, namedPlaceholders: false },
        });
      }
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
    }
  });
});

describe("mysql column migrations cover jurisdiction columns", () => {
  it("includes every jurisdiction column for existing MySQL databases", () => {
    const statements = mysqlColumnMigrationStatements();
    const joined = statements.join("\n");
    for (const column of ["jurisdiction_level", "jurisdiction_name", "fips_code", "fetch_config"]) {
      expect(joined).toContain(`data_sources ADD COLUMN ${column}`);
    }
    for (const column of ["jurisdiction_level", "jurisdiction_name", "fips_code"]) {
      expect(joined).toContain(`bids ADD COLUMN ${column}`);
    }
  });
});

describe("mysql index migrations cover jurisdiction columns", () => {
  it("declares the jurisdiction and fips code indexes for existing MySQL databases", () => {
    const statements = mysqlIndexMigrationStatements();
    const joined = statements.join("\n");
    expect(joined).toContain("idx_data_sources_jurisdiction");
    expect(joined).toContain("idx_bids_fips_code");
  });

  it("sizes indexed jurisdiction/fips columns as VARCHAR(191) on a fresh database", () => {
    const statements = mysqlMigrationStatements();
    const dataSourcesTable = statements.find((statement) =>
      statement.includes("CREATE TABLE IF NOT EXISTS data_sources"),
    );
    const bidsTable = statements.find((statement) => statement.includes("CREATE TABLE IF NOT EXISTS bids"));

    expect(dataSourcesTable).toContain("jurisdiction_level VARCHAR(191)");
    expect(dataSourcesTable).toContain("fips_code VARCHAR(191)");
    expect(dataSourcesTable).not.toContain("jurisdiction_level LONGTEXT");
    expect(dataSourcesTable).not.toContain("fips_code LONGTEXT");

    expect(bidsTable).toContain("fips_code VARCHAR(191)");
    expect(bidsTable).not.toContain("fips_code LONGTEXT");
  });
});

describe("mysql migrations cover the attachment repair columns (C4)", () => {
  it("adds verified_at / repair_attempts / next_repair_at / failure_kind to existing databases", () => {
    const joined = mysqlColumnMigrationStatements().join("\n");

    expect(joined).toContain("bid_attachments ADD COLUMN verified_at VARCHAR(191)");
    expect(joined).toContain("bid_attachments ADD COLUMN repair_attempts INT NOT NULL DEFAULT 0");
    expect(joined).toContain("bid_attachments ADD COLUMN next_repair_at VARCHAR(191)");
    expect(joined).toContain("bid_attachments ADD COLUMN failure_kind VARCHAR(191)");
  });

  it("declares the repair index and sizes both of its columns as VARCHAR(191)", () => {
    expect(mysqlIndexMigrationStatements().join("\n")).toContain(
      "CREATE INDEX idx_bid_attachments_repair ON bid_attachments(archive_status, next_repair_at)",
    );

    const table = mysqlMigrationStatements().find((statement) =>
      statement.includes("CREATE TABLE IF NOT EXISTS bid_attachments"),
    );

    expect(table).toContain("archive_status VARCHAR(191) NOT NULL DEFAULT 'not_archived'");
    expect(table).toContain("next_repair_at VARCHAR(191)");
    expect(table).toContain("repair_attempts INT NOT NULL DEFAULT 0");
    expect(table).not.toContain("archive_status LONGTEXT");
  });

  it("preserves nullability and defaults when narrowing a text column for indexing", () => {
    expect(mysqlIndexColumnModification({ dataType: "varchar", isNullable: "YES", columnDefault: null })).toBeNull();
    expect(mysqlIndexColumnModification({ dataType: "longtext", isNullable: "YES", columnDefault: null })).toBe(
      "VARCHAR(191) NULL",
    );
    expect(
      mysqlIndexColumnModification({ dataType: "longtext", isNullable: "NO", columnDefault: "_utf8mb4\\'not_archived\\'" }),
    ).toBe("VARCHAR(191) NOT NULL DEFAULT 'not_archived'");
    expect(mysqlIndexColumnModification({ dataType: "text", isNullable: "NO", columnDefault: "draft" })).toBe(
      "VARCHAR(191) NOT NULL DEFAULT 'draft'",
    );
  });
});

describe("mysql migrations cover the bid lifecycle columns (2026-09-24 phase 1)", () => {
  it("adds the lifecycle and empty-run columns to existing databases", () => {
    const joined = mysqlColumnMigrationStatements().join("\n");
    expect(joined).toContain("bids ADD COLUMN lifecycle_status LONGTEXT NOT NULL DEFAULT ('open')");
    expect(joined).toContain("bids ADD COLUMN awarded_date LONGTEXT");
    expect(joined).toContain("bids ADD COLUMN solicitation_number LONGTEXT");
    expect(joined).toContain("data_sources ADD COLUMN consecutive_empty_runs INT NOT NULL DEFAULT 0");
  });

  it("backfills closed lifecycle for inactive rows and local issuer types for legacy bids", () => {
    expect(mysqlDataMigrationStatements()).toEqual([
      "UPDATE bids SET lifecycle_status = 'closed' WHERE is_active = 0 AND lifecycle_status = 'open'",
      MYSQL_LOCAL_ISSUER_TYPE_BACKFILL,
    ]);
    expect(MYSQL_LOCAL_ISSUER_TYPE_BACKFILL).toContain("ON data_sources.id = SUBSTRING_INDEX(bids.id, ':', 1)");
    expect(MYSQL_LOCAL_ISSUER_TYPE_BACKFILL).toContain("IN ('county', 'city', 'township', 'special_district')");
    expect(MYSQL_LOCAL_ISSUER_TYPE_BACKFILL).toContain("bids.fips_code = data_sources.fips_code");
    expect(MYSQL_LOCAL_ISSUER_TYPE_BACKFILL).toContain("data_sources.state_code COLLATE utf8mb4_bin = bids.state_code COLLATE utf8mb4_bin");
  });
});

describe("mysql migrations cover phase 3 governance (2026-09-24 §7)", () => {
  it("adds precheck_requested_at to existing databases", () => {
    expect(mysqlColumnMigrationStatements().join("\n")).toContain(
      "data_sources ADD COLUMN precheck_requested_at LONGTEXT",
    );
  });

  it("derives platform_reviews with key-sized indexed columns and long text elsewhere", () => {
    const table = mysqlMigrationStatements().find((statement) => statement.includes("CREATE TABLE IF NOT EXISTS platform_reviews"));
    expect(table).toBeDefined();
    expect(table).toContain("provider_family VARCHAR(191) NOT NULL");
    expect(table).toContain("reviewed_at VARCHAR(191) NOT NULL");
    expect(table).toContain("robots_summary LONGTEXT NOT NULL");
    expect(mysqlMigrationStatements().join("\n")).toContain(
      "CREATE INDEX idx_platform_reviews_family_reviewed ON platform_reviews(provider_family, reviewed_at)",
    );
  });
});

describe("mysql migrations index crawler_logs by start time", () => {
  // The overview's run counts and the unfiltered runs log (ORDER BY started_at DESC, id DESC, paged by a
  // (before, beforeId) cursor) otherwise scan and sort the whole table.
  it("derives the (started_at, id) index from the first sqlite.exec block", () => {
    const statements = mysqlMigrationStatements();

    expect(statements).toContain("CREATE INDEX idx_crawler_logs_started ON crawler_logs(started_at, id)");
    expect(statements.filter((statement) => statement.includes("idx_crawler_logs_started "))).toHaveLength(1);
  });

  it("keeps the crawler_logs key columns VARCHAR(191) so the index fits a MySQL key", () => {
    const table = mysqlMigrationStatements().find((statement) =>
      statement.includes("CREATE TABLE IF NOT EXISTS crawler_logs"),
    );

    expect(table).toContain("id VARCHAR(191) PRIMARY KEY");
    expect(table).toContain("started_at VARCHAR(191) NOT NULL");
    expect(table).toContain("error_message LONGTEXT");
  });
});
