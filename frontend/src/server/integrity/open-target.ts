/**
 * Which database an integrity tool works on, and how it is opened: the one opener of `purge-demo-bids`, `data-integrity`
 * and `sweep-bid-lifecycle`. The three run around the same change (purge, sweep, then prove nothing else moved), so they must
 * always agree on what "the database" is; a fix made to one copy of this logic could otherwise leave another on a different file.
 *
 * WHICH DATABASE. A `mysql://` URL in `DATABASE_URL` (else `MYSQL_DATABASE_URL`) selects MySQL; otherwise the SQLite file
 * `DATABASE_PATH` names, default `data/apsi.sqlite`. A relative path is read from the `frontend/` directory, whatever
 * directory the command was typed in: the main checkout has a stray `<repo root>/data/apsi.sqlite`, and a path read from the
 * working directory would open that one when run from there. The environment is the one the caller passes (the scripts
 * pass `process.env`); `.env.local` is not read.
 *
 * HOW. SQLite: the file must exist (nothing is created, and neither is anything created by loading `db/client`, which this
 * module never does: its `db` opens `<cwd>/data/apsi.sqlite` at import time), opened with `fileMustExist`, read-only when the
 * tool only reads. MySQL: the process-wide shared pool, ended by `close()`; the target is named with its password masked.
 *
 * Scripts only: the frontend directory is found from this file's own location.
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  closeResolvedMysqlPool,
  isMysqlDatabaseUrlConfigured,
  redactMysqlDatabaseUrl,
  requireMysqlDatabaseUrl,
  resolveMysqlPool,
} from "@/server/db/mysql";
import type { DemoPurgeTarget } from "./demo-purge";

/** `frontend/`: three levels above `src/server/integrity/`. */
export const FRONTEND_DIRECTORY = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

/** A bad command line, or a target or file that cannot be used: reported, then exit code 2. The usage errors of all three scripts extend it. */
export class IntegrityUsageError extends Error {}

export type ResolvedTarget = { kind: "mysql"; databaseUrl: string } | { kind: "sqlite"; databasePath: string };

/** Which database the environment points at, without touching it. */
export function resolveIntegrityTarget(env: NodeJS.ProcessEnv): ResolvedTarget {
  if (isMysqlDatabaseUrlConfigured(env)) return { kind: "mysql", databaseUrl: requireMysqlDatabaseUrl(env) };
  return { kind: "sqlite", databasePath: path.resolve(FRONTEND_DIRECTORY, env.DATABASE_PATH?.trim() || path.join("data", "apsi.sqlite")) };
}

export interface OpenedIntegrityTarget {
  target: DemoPurgeTarget;
  /** `sqlite <path>` or `mysql <url with its password masked>`: what a tool prints as its target. */
  description: string;
  close: () => Promise<void>;
}

export interface OpenOptions {
  /** True for a tool that only reads: the SQLite connection itself then refuses a write. */
  readonly: boolean;
}

export async function openResolvedTarget(resolved: ResolvedTarget, options: OpenOptions): Promise<OpenedIntegrityTarget> {
  if (resolved.kind === "mysql") {
    return {
      target: { mysql: resolveMysqlPool(resolved.databaseUrl) },
      description: `mysql ${redactMysqlDatabaseUrl(resolved.databaseUrl)}`,
      // An open mysql2 pool keeps the process alive, so it is released on every path (see src/server/db/mysql.ts).
      close: () => closeResolvedMysqlPool(),
    };
  }

  // Opening a SQLite path creates an empty database at a mistyped one, and so does importing the app's db/client (its
  // `db` is created at import time, in <cwd>/data). This module does neither: it checks that the file is there, then opens
  // it with fileMustExist, and the tools read and write through that connection alone.
  if (!existsSync(resolved.databasePath)) {
    throw new IntegrityUsageError(
      `SQLite database not found: ${resolved.databasePath}. Nothing was created. ` +
        "Set DATABASE_PATH to the database file (a relative path is read from the frontend/ directory; the default is data/apsi.sqlite there).",
    );
  }
  if (statSync(resolved.databasePath).isDirectory()) {
    throw new IntegrityUsageError(`DATABASE_PATH is a directory, not a SQLite file: ${resolved.databasePath}.`);
  }
  const sqlite = new Database(resolved.databasePath, { readonly: options.readonly, fileMustExist: true });
  try {
    // The settings the app gives its own connections (db/client.ts), except journal_mode: these tools do not change it.
    // foreign_keys only matters to a connection that writes.
    sqlite.pragma("busy_timeout = 5000");
    if (!options.readonly) sqlite.pragma("foreign_keys = ON");
  } catch (error) {
    sqlite.close();
    throw error;
  }
  return {
    target: { database: { $client: sqlite } },
    description: `sqlite ${resolved.databasePath}`,
    close: async () => {
      sqlite.close();
    },
  };
}

/** Resolves the environment's target and opens it. */
export function openIntegrityTarget(env: NodeJS.ProcessEnv, options: OpenOptions): Promise<OpenedIntegrityTarget> {
  return openResolvedTarget(resolveIntegrityTarget(env), options);
}
