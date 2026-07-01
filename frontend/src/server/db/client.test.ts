import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeDatabase, MysqlRuntimeDatabaseGuardError } from "./client";

describe("runtime database client", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalMysqlDatabaseUrl = process.env.MYSQL_DATABASE_URL;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    if (originalMysqlDatabaseUrl === undefined) {
      delete process.env.MYSQL_DATABASE_URL;
    } else {
      process.env.MYSQL_DATABASE_URL = originalMysqlDatabaseUrl;
    }
  });

  it("uses an explicit guard instead of SQLite when MySQL is configured", () => {
    process.env.DATABASE_URL = "mysql://user:pass@localhost:3306/winbids";
    delete process.env.MYSQL_DATABASE_URL;

    const runtimeDb = createRuntimeDatabase();

    expect(() => runtimeDb.select()).toThrow(MysqlRuntimeDatabaseGuardError);
    expect(() => runtimeDb.insert({} as never)).toThrow(/MySQL is configured/);
  });
});
