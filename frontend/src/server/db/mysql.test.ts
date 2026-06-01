import { describe, expect, it } from "vitest";
import {
  isMysqlDatabaseUrlConfigured,
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
