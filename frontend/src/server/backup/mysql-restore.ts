import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import mysql from "mysql2/promise";
import { mysqlConnectionArgsFromUrl } from "./mysql-backup";

export class MysqlRestoreGuardError extends Error {
  constructor(database: string) {
    super(
      `Refusing to restore into database "${database}" without --force. ` +
        `Set --target-database=<scratch_db_name> to restore into a separate scratch/target ` +
        `database, or pass --force to explicitly confirm restoring into the database resolved ` +
        `from DATABASE_URL/MYSQL_DATABASE_URL. This guard exists so a restore drill cannot ` +
        `silently overwrite a live database.`,
    );
    this.name = "MysqlRestoreGuardError";
  }
}

export class MysqlRestoreFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MysqlRestoreFailedError";
  }
}

export interface MysqlRestoreResult {
  backupPath: string;
  targetDatabase: string;
  host: string;
  port: string;
}

interface MysqlRestoreOptions {
  /** Restore into this database name instead of the URL's database. Strongly preferred for drills. */
  targetDatabase?: string;
  /** Required to restore directly into the URL's own database (skip this guard at your own risk). */
  force?: boolean;
  env?: Record<string, string | undefined>;
}

function which(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const finder = spawn(process.platform === "win32" ? "where" : "which", [command], {
      stdio: "ignore",
    });
    finder.on("error", () => resolve(false));
    finder.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Restores a `mysqldump` SQL file into a MySQL database. Defaults to
 * restoring into `options.targetDatabase` (a scratch/target database that is
 * created if missing) rather than whatever database `DATABASE_URL`/
 * `MYSQL_DATABASE_URL` points at, so a drill run cannot accidentally
 * overwrite a live database. Restoring directly into the URL's database
 * requires `options.force`.
 */
export async function restoreMysqlBackup(backupPath: string, options: MysqlRestoreOptions = {}): Promise<MysqlRestoreResult> {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }

  const env = options.env ?? process.env;
  const databaseUrl = env.DATABASE_URL?.trim() || env.MYSQL_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL or MYSQL_DATABASE_URL is required for MySQL restore.");
  }

  const connection = mysqlConnectionArgsFromUrl(databaseUrl);
  const targetDatabase = options.targetDatabase?.trim();

  if (!targetDatabase && !options.force) {
    throw new MysqlRestoreGuardError(connection.database);
  }

  const database = targetDatabase || connection.database;

  if (!(await which("mysql"))) {
    throw new MysqlRestoreFailedError(
      "The `mysql` CLI client was not found on PATH. Install MySQL client tools before running a restore.",
    );
  }

  // Create the target database if it does not exist yet (this is expected
  // and normal for a scratch/target restore database used by a drill).
  const adminConnection = await mysql.createConnection({
    host: connection.host,
    port: Number(connection.port),
    user: connection.user,
    password: connection.password,
    multipleStatements: false,
  });

  try {
    await adminConnection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, "")}\` CHARACTER SET utf8mb4`,
    );
  } finally {
    await adminConnection.end();
  }

  await new Promise<void>((resolve, reject) => {
    const args = [
      `--host=${connection.host}`,
      `--port=${connection.port}`,
      `--user=${connection.user}`,
      database,
    ];

    const child = spawn("mysql", args, {
      stdio: ["pipe", "ignore", "pipe"],
      env: {
        ...process.env,
        MYSQL_PWD: connection.password,
      },
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    createReadStream(backupPath).pipe(child.stdin);

    child.on("error", (error) => {
      reject(new MysqlRestoreFailedError(`Failed to launch mysql client: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new MysqlRestoreFailedError(`mysql restore exited with code ${code}: ${stderr.trim() || "no stderr output"}`));
      }
    });
  });

  return {
    backupPath,
    targetDatabase: database,
    host: connection.host,
    port: connection.port,
  };
}

/**
 * Row counts for every base table in `database`, used by the restore drill
 * to compare source vs. restored row counts.
 */
export async function countMysqlRows(
  connectionConfig: { host: string; port: string; user: string; password: string },
  database: string,
): Promise<{ tableName: string; rowCount: number }[]> {
  const connection = await mysql.createConnection({
    host: connectionConfig.host,
    port: Number(connectionConfig.port),
    user: connectionConfig.user,
    password: connectionConfig.password,
    database,
  });

  try {
    const [tableRows] = await connection.query(
      `SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY TABLE_NAME ASC`,
      [database],
    );

    const results: { tableName: string; rowCount: number }[] = [];
    for (const row of tableRows as { tableName: string }[]) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.tableName)) continue;
      const [countRows] = await connection.query(`SELECT COUNT(*) AS count FROM \`${row.tableName}\``);
      const count = (countRows as { count: number }[])[0]?.count ?? 0;
      results.push({ tableName: row.tableName, rowCount: count });
    }

    return results;
  } finally {
    await connection.end();
  }
}
