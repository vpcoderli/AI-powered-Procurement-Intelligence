import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { runMigrations } from "@/server/db/migrate";
import { importCrawlerSqliteRunIntoMysql } from "./mysql-importer";

export interface MysqlCrawlerRunContext {
  databasePath: string;
  isMysqlImport: boolean;
  importIntoMysql: () => Promise<void>;
  cleanup: () => void;
}

export function prepareMysqlCrawlerRun(explicitDatabasePath?: string): MysqlCrawlerRunContext {
  if (explicitDatabasePath || !isMysqlDatabaseUrlConfigured()) {
    return {
      databasePath: explicitDatabasePath ?? path.resolve(process.cwd(), "data", "apsi.sqlite"),
      isMysqlImport: false,
      importIntoMysql: async () => {},
      cleanup: () => {},
    };
  }

  const directory = mkdtempSync(path.join(os.tmpdir(), "crawler-mysql-"));
  const databasePath = path.join(directory, "apsi.sqlite");
  const sqliteDb = createDatabase(databasePath);
  runMigrations(sqliteDb);
  sqliteDb.$client.close();

  return {
    databasePath,
    isMysqlImport: true,
    importIntoMysql: async () => {
      await importCrawlerSqliteRunIntoMysql(resolveMysqlPool(), databasePath);
    },
    cleanup: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
