# Backup and Restore Runbook

Updated: 2026-07-01

This runbook covers backing up and restoring the APSi database in both
supported runtime modes (local/dev SQLite and MySQL/RDS), and how to turn a
completed restore drill into the evidence that
`frontend/src/server/operations/production-readiness.ts` requires before
production launch.

**Scope of what is delivered here:** `frontend/scripts/backup-db.ts`,
`restore-db.ts`, and `backup-drill.ts` implement and locally verify the
backup/restore *mechanism*. They have only been run against local/dev data on
a developer machine as part of this change. They have **not** been run
against production-like infrastructure or production-scale data. Per
`docs/transferability/known-limitations.md`, "Backup and restore has been
tested on production-like data" remains an open item until a human/ops team
runs an equivalent drill against a staging or production-like MySQL/RDS
instance and records that evidence. Do not treat this runbook or the local
drill script's evidence file as closing that gap by itself — see
[Production sign-off](#production-sign-off) below for exactly what is still
required.

## Overview

| Runtime | Backup mechanism | Restore mechanism | Script |
|---|---|---|---|
| SQLite (local/dev, persistent volume) | better-sqlite3 `.backup()` (SQLite's native Online Backup API) | File copy + `PRAGMA quick_check` | `npm run db:backup`, `npm run db:restore` |
| MySQL / RDS | `mysqldump --single-transaction` | `mysql` client restore into a scratch/target database | `npm run db:backup`, `npm run db:restore` |
| Either | End-to-end backup -> restore -> integrity check, writes JSON evidence | — | `npm run db:backup-drill` (SQLite only today; see [Limitations](#limitations-and-follow-ups)) |

All three scripts live in `frontend/scripts/` and share logic in
`frontend/src/server/backup/`:

- `sqlite-backup.ts` / `sqlite-restore.ts`
- `mysql-backup.ts` / `mysql-restore.ts`
- `checksum.ts` (streaming SHA-256)
- `upload.ts` (optional S3 upload, see [Object storage upload](#object-storage-upload-optional))

## SQLite case (local dev, or a persistent-volume deployment)

### Why not just `cp`

`frontend/src/server/db/client.ts` opens the database with
`PRAGMA journal_mode = WAL`. In WAL mode, recent committed writes can live in
a separate `-wal` file rather than the main `.sqlite` file until a checkpoint
happens. A plain `cp apsi.sqlite backup.sqlite` while the app is running can
copy the main file without the WAL contents, producing a backup that is
missing recent commits or is internally inconsistent.

`backup-db.ts` instead uses better-sqlite3's `.backup()` method, which wraps
SQLite's native Online Backup API. It copies the database page-by-page under
a brief read lock and is explicitly designed to be safe against a live
database in WAL mode. The output file is a complete, standalone database —
no `-wal`/`-shm` sidecar files need to be copied alongside it.

### Backup

```bash
cd frontend
npm run db:backup
```

This backs up `DATABASE_PATH` (or `data/apsi.sqlite` if unset) to
`frontend/data/backups/apsi-sqlite-<ISO-timestamp>.sqlite`, prints the
SHA-256 checksum and per-table row counts, and attempts an optional S3
upload (see below). `frontend/data/backups/` is already gitignored — do not
commit backup files.

Custom source/output paths:

```bash
npm run db:backup -- --source=/absolute/path/to/apsi.sqlite --out=/absolute/path/to/backup-dir
```

### Restore

Restoring **always** requires an explicit `--target` path, and refuses to
overwrite an existing file at that path unless `--force` is also passed. The
intended, safe usage is to restore into a new scratch path first and inspect
it before ever considering restoring over a real database:

```bash
npm run db:restore -- \
  --backup=data/backups/apsi-sqlite-2026-07-01T00-00-00-000Z.sqlite \
  --target=data/restore-check.sqlite
```

To actually replace the live dev database (rare — only do this to recover
from local corruption, and only on a machine where you are sure the current
`data/apsi.sqlite` is expendable):

```bash
npm run db:restore -- \
  --backup=data/backups/apsi-sqlite-2026-07-01T00-00-00-000Z.sqlite \
  --target=data/apsi.sqlite \
  --force
```

Restart the dev server / any workers after replacing `data/apsi.sqlite`, since
`better-sqlite3` connections hold the file open.

### Persistent-volume production SQLite case

`docs/transferability/known-limitations.md` explicitly allows "Production can
start on durable SQLite only with explicit backup/restore ownership." If APSi
is deployed with SQLite on a persistent volume rather than MySQL:

1. Run `npm run db:backup` on a schedule (cron, a sidecar container, or a
   scheduled task in your platform) with `DATABASE_PATH` pointing at the
   production volume path, and `OBJECT_STORAGE_PROVIDER=s3` configured (see
   [Object storage upload](#object-storage-upload-optional)) so backups leave
   the volume.
2. Treat the persistent volume itself as a single point of failure — an
   off-volume copy (S3, or a separate backup volume/snapshot) is required,
   not optional, for this case.
3. Test restore periodically into a scratch path on a separate host, not the
   production volume, using `npm run db:restore -- --backup=<s3-downloaded-file> --target=<scratch-path>`.

## MySQL / RDS case

### Backup

Requires the MySQL client tools (`mysqldump`) to be installed and on `PATH`.
Set `DATABASE_URL` or `MYSQL_DATABASE_URL` to a `mysql://` URL before running:

```bash
cd frontend
DATABASE_URL=mysql://winbids:REPLACE_ME@<host>:3306/winbids npm run db:backup
```

This runs `mysqldump --single-transaction --routines --triggers --events` and
writes a single `.sql` file to
`frontend/data/backups/apsi-mysql-<ISO-timestamp>.sql`. `--single-transaction`
takes a consistent InnoDB snapshot without holding a table lock for the
duration of the dump, so the dump does not block production writers. The
database password is passed to `mysqldump` via the `MYSQL_PWD` environment
variable rather than a command-line flag, so it does not appear in `ps`
output on shared hosts.

For a managed RDS instance, run this from a host/task that has network access
to the RDS endpoint (a bastion, an ECS one-off task, etc.) — do not assume the
developer machine can reach production RDS directly.

### Restore

MySQL restore **defaults to a scratch/target database**, created
automatically if it does not exist, rather than the database the connection
URL points at:

```bash
DATABASE_URL=mysql://winbids:REPLACE_ME@<host>:3306/winbids npm run db:restore -- \
  --backup=data/backups/apsi-mysql-2026-07-01T00-00-00-000Z.sql \
  --target-database=winbids_restore_drill
```

To restore directly into the database the URL points at (only ever do this
during an actual incident recovery, never as a routine drill):

```bash
DATABASE_URL=mysql://winbids:REPLACE_ME@<host>:3306/winbids npm run db:restore -- \
  --backup=<path> \
  --force
```

After a scratch-database restore, verify row counts against the source
before dropping the scratch database. `docs/operations/mysql-cutover.md`'s
smoke verifier (`npm run db:mysql:smoke`) or ad hoc `SELECT COUNT(*)` queries
against the tables listed in `frontend/src/server/db/schema.ts` are both
reasonable ways to do this.

### RDS-specific notes

- Prefer RDS automated snapshots (point-in-time recovery) as the primary
  production backup mechanism; treat `mysqldump` via this script as a
  portable, human-triggerable secondary backup (useful for cross-environment
  data moves, pre-migration safety copies, and the drill described below) —
  not a replacement for RDS snapshots and PITR.
- RDS automated snapshot/PITR configuration and the restore-from-snapshot
  procedure are AWS console/CLI operations outside the scope of this script;
  see `docs/operations/aws-deployment-runbook.md` for the target
  infrastructure this repository assumes.
- `mysqldump --set-gtid-purged=OFF` is used so the dump can be imported into
  a fresh scratch RDS instance or local MySQL container without GTID
  replication errors.

## Object storage upload (optional)

If `OBJECT_STORAGE_PROVIDER=s3` is configured (see
`frontend/src/server/storage/object-storage.ts`, delivered under a separate
P0 item for the Artifact Vault / response exports), `backup-db.ts` also
uploads the backup file to that same bucket under a `backups/sqlite/` or
`backups/mysql/` key prefix. This upload is best-effort:

- If `OBJECT_STORAGE_PROVIDER` is unset or `local`, the upload is skipped and
  reported as such — the local backup file is still written normally.
- If the S3 adapter module is not present in a given checkout, or the upload
  fails for any reason (credentials, network, bucket policy), the script logs
  a warning and still exits successfully, because the local backup already
  succeeded at that point and should not be reported as failed.

This means **the local backup file, not the S3 upload, is the thing to check
for backup success.** Treat the S3 upload as a nice-to-have off-site copy
until it has been verified end-to-end against a real bucket.

## Backup drill (`npm run db:backup-drill`)

```bash
cd frontend
npm run db:backup-drill
```

This runs, against local SQLite only:

1. **Backup** — `backupSqliteDatabase` against `DATABASE_PATH` (or
   `data/apsi.sqlite`).
2. **Restore** — into a scratch file under
   `frontend/data/backup-drill-scratch/` (never the live database).
3. **Integrity check** — compares per-table row counts between the source
   backup and the restored file, and compares the SHA-256 checksum of the
   backup file against the restored file (they should be byte-identical,
   since restore is a verified file copy).
4. **Evidence** — on success, writes a JSON evidence file to
   `frontend/data/backup-drill-evidence/backup-drill-<ISO-timestamp>.json`,
   and mirrors it to `latest.json` in the same directory. The scratch
   backup/restore files are deleted afterward unless `--keep` is passed.

Evidence file shape (fields relevant to review):

```json
{
  "ok": true,
  "drillType": "local-sqlite-only",
  "scope": "... explicit statement that this is local-only, not production evidence ...",
  "generatedAt": "2026-07-01T12:00:00.000Z",
  "backupChecksumSha256": "...",
  "restoredChecksumSha256": "...",
  "checksumMatch": true,
  "totalSourceRowCount": 1234,
  "totalRestoredRowCount": 1234,
  "rowCountsMatch": true,
  "tables": [{ "tableName": "bids", "sourceRowCount": 42, "restoredRowCount": 42, "match": true }],
  "productionDrillRequired": "UNRESOLVED: ..."
}
```

The command exits non-zero if `rowCountsMatch` or `checksumMatch` is false,
so it is safe to wire into CI as a smoke check of the mechanism itself (not
as a substitute for a production drill).

### Limitations and follow-ups

- The drill script only exercises SQLite today. There is no equivalent
  one-command `backup -> restore -> integrity check -> evidence` script for
  MySQL in this change; the MySQL backup and restore mechanisms exist and can
  be composed manually (`npm run db:backup` then `npm run db:restore --target-database=...`
  then a manual row-count comparison), but producing a MySQL evidence JSON
  the same way SQLite does is a reasonable follow-up if a fully automated
  MySQL drill becomes a repeated need.
- `frontend/data/backup-drill-evidence/*.json` is gitignored. It is a local
  artifact, not something to commit. A human must upload the real
  production-drill evidence file somewhere durable and reachable by URL (an
  internal wiki attachment, an S3 object with a signed/internal URL, etc.)
  and put that URL in `PRODUCTION_BACKUP_EVIDENCE_URL` /
  `PRODUCTION_RESTORE_EVIDENCE_URL` — see below.

## Wiring drill evidence into `production-readiness.ts`

`frontend/src/server/operations/production-readiness.ts` requires these
environment variables before `validateProductionReadiness()` (and
`npm run ops:production:check`) will pass:

| Variable | What it should contain |
|---|---|
| `PRODUCTION_OWNER_BACKUPS` | Email/handle of the person or team who owns backup/restore for production. |
| `PRODUCTION_BACKUP_RUNBOOK_URL` | An `http(s)://` URL pointing at this runbook (or an internal copy of it). |
| `PRODUCTION_BACKUP_EVIDENCE_URL` | An `http(s)://` URL to the evidence artifact from the **actual production-like drill** (not the local-only `backup-drill.ts` JSON file directly, unless that file has been uploaded somewhere reachable — see below). |
| `PRODUCTION_RESTORE_EVIDENCE_URL` | An `http(s)://` URL to evidence that a restore was verified, which can be the same document/link as `PRODUCTION_BACKUP_EVIDENCE_URL` if the drill evidence covers both. |
| `PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP` | ISO-8601 timestamp (e.g. `2026-07-01T12:00:00Z`) of when the referenced drill was actually run. `production-readiness.ts` validates this is a well-formed ISO timestamp; it does not independently verify freshness, so treat "how recent is acceptable" as an ops policy decision. |

Recommended procedure for a human to satisfy these before launch:

1. Run the real drill against production-like infrastructure (a staging RDS
   instance restored from a real production snapshot, or — at minimum — a
   scratch RDS instance loaded with a `mysqldump` of production-scale data).
   For MySQL, this is: `npm run db:backup` against the source, then
   `npm run db:restore -- --target-database=<scratch>` against the scratch
   instance, then a manual row-count/spot-check comparison (see
   [MySQL / RDS case](#mysql--rds-case) above; also see
   [Limitations and follow-ups](#limitations-and-follow-ups) for why this is
   manual rather than one command today).
2. Record the result (what was backed up, what was restored, row counts
   before/after, who ran it, when) in a durable, linkable location — an
   internal doc, a ticket, or an uploaded copy of the evidence JSON/notes.
3. Set:
   ```bash
   PRODUCTION_OWNER_BACKUPS=<owner>
   PRODUCTION_BACKUP_RUNBOOK_URL=https://internal.example.com/docs/operations/backup-restore-runbook
   PRODUCTION_BACKUP_EVIDENCE_URL=<link to the drill record from step 2>
   PRODUCTION_RESTORE_EVIDENCE_URL=<link to the drill record from step 2, or a more specific restore-only link>
   PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP=<ISO-8601 timestamp of when the drill was run>
   ```
4. Run `NODE_ENV=production npm run ops:production:check` in the production
   deployment environment and confirm it passes with `warnings=0`.

## Production sign-off

Do not consider backup/restore closed for launch based on this change alone.
What this change delivers:

- A working backup mechanism for both SQLite and MySQL.
- A working restore mechanism for both, with guardrails against accidentally
  overwriting a live database.
- A working, scriptable, evidence-producing drill — **for local SQLite only.**

What is still required, and must be done by a human/ops team, per
`docs/transferability/known-limitations.md`:

- Run an actual backup/restore drill against production-like infrastructure
  and production-scale (or realistically-sized) data — not the local dev
  SQLite file used by `npm run db:backup-drill`.
- Record and link that evidence, and populate the four
  `PRODUCTION_BACKUP_*`/`PRODUCTION_RESTORE_*` environment variables above
  with real values pointing at it.
- Decide and document a backup retention/rotation policy (this change does
  not implement retention — every `npm run db:backup` run adds a new
  timestamped file with nothing pruned).
- Decide and document a backup schedule/automation mechanism for production
  (cron, platform-native scheduled job, RDS automated snapshots, etc.) — the
  scripts in this change are manually invoked; nothing here schedules them.
- Confirm IAM/bucket policy for the S3 upload path (if used) follows the same
  private/least-privilege posture required by
  `frontend/src/server/storage/object-storage.ts`'s production preflight.
