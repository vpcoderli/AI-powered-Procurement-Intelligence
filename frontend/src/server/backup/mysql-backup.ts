import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { requireMysqlDatabaseUrl } from "../db/mysql";

export interface MysqlBackupResult {
  destinationPath: string;
  byteSize: number;
  databaseUrlSummary: string;
}

export class MysqldumpNotAvailableError extends Error {
  constructor(message = "mysqldump was not found on PATH. Install the MySQL client tools (e.g. `apt-get install default-mysql-client` or `brew install mysql-client`) before running a MySQL backup.") {
    super(message);
    this.name = "MysqldumpNotAvailableError";
  }
}

export class MysqldumpFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MysqldumpFailedError";
  }
}

function redactDatabaseUrl(databaseUrl: string) {
  try {
    const url = new URL(databaseUrl.replace(/^mysql2:\/\//, "mysql://"));
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "mysql://***";
  }
}

/**
 * Parses a `mysql://user:pass@host:port/db` URL into discrete `mysqldump`
 * connection flags. `mysqldump` does not accept a single connection URI, so
 * the pieces are passed individually; the password is passed via the
 * `MYSQL_PWD` environment variable (not argv) so it does not appear in
 * process listings (`ps`) on shared hosts.
 */
export function mysqlConnectionArgsFromUrl(databaseUrl: string) {
  const normalized = databaseUrl.replace(/^mysql2:\/\//, "mysql://");
  const url = new URL(normalized);
  const database = url.pathname.replace(/^\//, "");

  if (!database) {
    throw new Error("MySQL database URL is missing a database name.");
  }

  return {
    host: url.hostname || "127.0.0.1",
    port: url.port || "3306",
    user: decodeURIComponent(url.username || "root"),
    password: url.password ? decodeURIComponent(url.password) : "",
    database,
  };
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

export interface MysqlBackupOptions {
  env?: Record<string, string | undefined>;
  /** Injectable for tests; defaults to checking `mysqldump` on PATH. */
  checkMysqldumpAvailable?: () => Promise<boolean>;
  extraArgs?: string[];
}

/**
 * Shells out to `mysqldump` against the database resolved from
 * `DATABASE_URL`/`MYSQL_DATABASE_URL` and writes a single-file SQL dump to
 * `destinationPath`. Uses `--single-transaction` so the dump is a
 * consistent snapshot of an InnoDB database without locking writers for the
 * duration of the dump (the same non-blocking approach used for
 * production-safe MySQL backups), plus `--routines --triggers --events` so
 * stored procedures/triggers/events are included if they are ever added,
 * and `--set-gtid-purged=OFF` so the dump can be imported into non-source
 * replication topologies (e.g. a scratch RDS instance for the restore drill)
 * without GTID errors.
 */
export async function backupMysqlDatabase(
  destinationPath: string,
  options: MysqlBackupOptions = {},
): Promise<MysqlBackupResult> {
  const env = options.env ?? process.env;
  const databaseUrl = requireMysqlDatabaseUrl(env);
  const checkAvailable = options.checkMysqldumpAvailable ?? (() => which("mysqldump"));

  if (!(await checkAvailable())) {
    throw new MysqldumpNotAvailableError();
  }

  const connection = mysqlConnectionArgsFromUrl(databaseUrl);
  mkdirSync(path.dirname(destinationPath), { recursive: true });

  const args = [
    `--host=${connection.host}`,
    `--port=${connection.port}`,
    `--user=${connection.user}`,
    "--single-transaction",
    "--routines",
    "--triggers",
    "--events",
    "--set-gtid-purged=OFF",
    "--default-character-set=utf8mb4",
    ...(options.extraArgs ?? []),
    connection.database,
  ];

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(destinationPath);
    const child = spawn("mysqldump", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Passed via env rather than --password=... on argv so the
        // credential does not appear in `ps`/process-list output.
        MYSQL_PWD: connection.password,
      },
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.stdout.pipe(output);

    child.on("error", (error) => {
      output.close();
      reject(new MysqldumpNotAvailableError(`Failed to launch mysqldump: ${error.message}`));
    });

    child.on("close", (code) => {
      output.close();
      if (code === 0) {
        resolve();
      } else {
        reject(new MysqldumpFailedError(`mysqldump exited with code ${code}: ${stderr.trim() || "no stderr output"}`));
      }
    });
  });

  return {
    destinationPath,
    byteSize: statSync(destinationPath).size,
    databaseUrlSummary: redactDatabaseUrl(databaseUrl),
  };
}

export function defaultMysqlBackupFileName(now: Date = new Date()) {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return `apsi-mysql-${timestamp}.sql`;
}
