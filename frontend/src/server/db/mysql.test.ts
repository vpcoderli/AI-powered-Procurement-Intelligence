import { describe, expect, it } from "vitest";
import {
  isMysqlDatabaseUrlConfigured,
  mysqlColumnMigrationStatements,
  mysqlIndexColumnModification,
  mysqlIndexMigrationStatements,
  mysqlMigrationStatements,
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

  it("reuses the default MySQL pool for runtime calls", () => {
    const pool = resolveMysqlPool("mysql://user:pass@localhost:3306/winbids");

    expect(resolveMysqlPool("mysql://user:pass@localhost:3306/winbids")).toBe(pool);

    resetMysqlPoolForTests();
    expect(resolveMysqlPool("mysql://user:pass@localhost:3306/winbids")).not.toBe(pool);
    resetMysqlPoolForTests();
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
