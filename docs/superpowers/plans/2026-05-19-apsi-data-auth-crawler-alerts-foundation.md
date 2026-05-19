# APSi Data, Auth, Crawler, And Alerts Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local SQLite database foundation, move bids and saved bids onto it, add local account/session auth, persist saved search alerts, and scaffold a fixture-backed SAM.gov crawler import path.

**Architecture:** SQLite + Drizzle becomes the local data boundary for the Next.js app. The bid APIs keep their current response shapes while repositories move from mock/JSON storage to DB-backed queries. Auth, alerts, and crawler code build against narrow server-side modules so each feature can be tested independently and later migrated toward PostgreSQL or production services.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, SQLite, Drizzle ORM, `better-sqlite3`, Node `crypto.scrypt`, Python 3 crawler scaffold with fixture tests.

---

## Execution Notes

- Use TDD for every behavior change.
- Commit after each task.
- Keep runtime SQLite files ignored under `frontend/data/`.
- Preserve these API response shapes:
  - `GET /api/bids` -> `{ bids, total, filters }`
  - `GET /api/bids/[id]` -> `{ bid }`
  - `GET/POST/DELETE /api/saved-bids` -> `{ savedBidIds, bids }`
- Do not promise real alert emails in UI copy.
- Do not implement 40+ state crawlers in this plan.
- Parallel implementation may start after Task 1 is complete. Keep the write sets below disjoint.

## File Ownership Map

Task 1 owns:

- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/drizzle.config.ts`
- `frontend/src/server/db/*`
- `frontend/drizzle/*`
- `frontend/scripts/*`
- `frontend/.gitignore`

Task 2 owns:

- `frontend/src/server/bids/domain.ts`
- `frontend/src/server/bids/repository.ts`
- `frontend/src/server/bids/service.ts`
- `frontend/src/server/bids/types.ts`
- `frontend/src/app/api/bids/*`
- `frontend/src/app/api/saved-bids/*`
- related bid tests

Task 3 owns:

- `frontend/src/server/auth/*`
- `frontend/src/app/api/auth/*`
- `frontend/src/lib/api/auth.ts`
- `frontend/src/context/AuthContext.tsx`
- `frontend/src/app/login/page.tsx`
- `frontend/src/app/register/page.tsx`
- auth-related edits in layout/sidebar/header only

Task 4 owns:

- `frontend/src/server/search-alerts/*`
- `frontend/src/app/api/search-alerts/*`
- `frontend/src/lib/api/search-alerts.ts`
- `frontend/src/app/search/page.tsx`
- dictionary additions in `frontend/src/lib/i18n/dictionaries/*`

Task 5 owns:

- `crawler/*`
- `frontend/src/server/crawler/*`
- optional `frontend/src/app/api/health/scrapers/*`

Task 6 owns final integration and browser acceptance only.

---

### Task 1: Add SQLite And Drizzle Foundation

**Files:**

- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/.gitignore`
- Create: `frontend/drizzle.config.ts`
- Create: `frontend/src/server/db/schema.ts`
- Create: `frontend/src/server/db/client.ts`
- Create: `frontend/src/server/db/migrate.ts`
- Create: `frontend/src/server/db/seed.ts`
- Create: `frontend/src/server/db/test-utils.ts`
- Create: `frontend/src/server/db/schema.test.ts`
- Create: `frontend/scripts/migrate-db.ts`
- Create: `frontend/scripts/seed-db.ts`

- [ ] **Step 1: Install DB dependencies**

Run:

```bash
cd frontend
npm install drizzle-orm better-sqlite3
npm install -D drizzle-kit @types/better-sqlite3 tsx
```

Expected: `package.json` and `package-lock.json` include the new dependencies.

- [ ] **Step 2: Update ignored runtime files**

Add these lines to `frontend/.gitignore` if absent:

```gitignore
/data/*.sqlite
/data/*.sqlite-shm
/data/*.sqlite-wal
```

Expected: SQLite runtime files stay untracked.

- [ ] **Step 3: Add failing schema smoke test**

Create `frontend/src/server/db/schema.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "./client";
import { runMigrations } from "./migrate";
import { bids, users } from "./schema";

describe("database schema", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it("creates core tables in an empty sqlite database", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "apsi-db-"));
    const databasePath = path.join(directory, "apsi.sqlite");
    const db = createDatabase(databasePath);

    runMigrations(db);

    db.insert(users).values({
      id: "anon_test",
      createdAt: "2026-05-19T00:00:00.000Z",
      updatedAt: "2026-05-19T00:00:00.000Z",
    }).run();

    db.insert(bids).values({
      id: "1",
      source: "SAM.gov",
      sourceBidId: "mock:1",
      dedupeKey: "mock:1",
      title: "Enterprise Cloud Migration Services",
      description: "Short description",
      amount: "$5M - $10M",
      issuerName: "DEPARTMENT OF DEFENSE",
      issuerType: "federal",
      stateCode: "US",
      sourceUrl: "https://sam.gov/example",
      isActive: 1,
      firstSeenAt: "2026-05-19T00:00:00.000Z",
      lastSeenAt: "2026-05-19T00:00:00.000Z",
      createdAt: "2026-05-19T00:00:00.000Z",
      updatedAt: "2026-05-19T00:00:00.000Z",
    }).run();

    expect(db.select().from(users).all()).toHaveLength(1);
    expect(db.select().from(bids).all()).toHaveLength(1);
    db.$client.close();
  });
});
```

- [ ] **Step 4: Run schema smoke test and verify RED**

Run:

```bash
cd frontend
npm test -- src/server/db/schema.test.ts
```

Expected: FAIL because `./client`, `./migrate`, and `./schema` do not exist.

- [ ] **Step 5: Add Drizzle config**

Create `frontend/drizzle.config.ts`:

```ts
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/apsi.sqlite",
  },
} satisfies Config;
```

- [ ] **Step 6: Add database schema**

Create `frontend/src/server/db/schema.ts` with these tables:

```ts
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  passwordHash: text("password_hash"),
  displayName: text("display_name"),
  role: text("role").notNull().default("user"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastLoginAt: text("last_login_at"),
}, (table) => ({
  emailIdx: uniqueIndex("idx_users_email").on(table.email),
}));

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => ({
  tokenHashIdx: uniqueIndex("idx_sessions_token_hash").on(table.tokenHash),
  userIdx: index("idx_sessions_user_id").on(table.userId),
}));

export const bids = sqliteTable("bids", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  sourceBidId: text("source_bid_id"),
  dedupeKey: text("dedupe_key").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  fullDescription: text("full_description"),
  originalCategory: text("original_category"),
  amount: text("amount"),
  amountMin: integer("amount_min"),
  amountMax: integer("amount_max"),
  currency: text("currency").notNull().default("USD"),
  publishedDate: text("published_date"),
  deadlineDate: text("deadline_date"),
  issuerName: text("issuer_name").notNull(),
  issuerType: text("issuer_type").notNull(),
  stateCode: text("state_code").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  sourceUrl: text("source_url").notNull(),
  isActive: integer("is_active").notNull().default(1),
  rawPayload: text("raw_payload"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  dedupeIdx: uniqueIndex("idx_bids_dedupe_key").on(table.dedupeKey),
  sourceBidIdx: uniqueIndex("idx_bids_source_source_bid_id").on(table.source, table.sourceBidId),
  activeDeadlineIdx: index("idx_bids_active_deadline").on(table.isActive, table.deadlineDate),
  publishedIdx: index("idx_bids_published_date").on(table.publishedDate),
  stateIdx: index("idx_bids_state_code").on(table.stateCode),
  issuerTypeIdx: index("idx_bids_issuer_type").on(table.issuerType),
  sourceIdx: index("idx_bids_source").on(table.source),
}));

export const bidAttachments = sqliteTable("bid_attachments", {
  id: text("id").primaryKey(),
  bidId: text("bid_id").notNull().references(() => bids.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  sizeLabel: text("size_label"),
  mimeType: text("mime_type"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  bidIdx: index("idx_bid_attachments_bid_id").on(table.bidId),
}));

export const savedBids = sqliteTable("saved_bids", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  bidId: text("bid_id").notNull().references(() => bids.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.bidId] }),
  bidIdx: index("idx_saved_bids_bid_id").on(table.bidId),
}));

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  query: text("query"),
  states: text("states"),
  issuerType: text("issuer_type"),
  deadlinePreset: text("deadline_preset"),
  publishedPreset: text("published_preset"),
  frequency: text("frequency").notNull().default("daily"),
  notificationChannel: text("notification_channel").notNull().default("email"),
  isEnabled: integer("is_enabled").notNull().default(1),
  lastMatchedAt: text("last_matched_at"),
  lastNotifiedAt: text("last_notified_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  userIdx: index("idx_alerts_user_id").on(table.userId),
}));

export const crawlerLogs = sqliteTable("crawler_logs", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  runId: text("run_id").notNull(),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  durationMs: integer("duration_ms"),
  fetchedCount: integer("fetched_count").notNull().default(0),
  insertedCount: integer("inserted_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  errorStack: text("error_stack"),
  metadata: text("metadata"),
}, (table) => ({
  sourceStartedIdx: index("idx_crawler_logs_source_started").on(table.source, table.startedAt),
  runIdx: index("idx_crawler_logs_run_id").on(table.runId),
}));

export const dataSources = sqliteTable("data_sources", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  issuerType: text("issuer_type").notNull(),
  stateCode: text("state_code").notNull(),
  baseUrl: text("base_url"),
  isEnabled: integer("is_enabled").notNull().default(1),
  cadence: text("cadence").notNull().default("daily"),
  lastSuccessAt: text("last_success_at"),
  lastFailureAt: text("last_failure_at"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
```

- [ ] **Step 7: Add DB client and migration helper**

Create `frontend/src/server/db/client.ts`:

```ts
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const DEFAULT_DATABASE_PATH = path.join(process.cwd(), "data", "apsi.sqlite");

export type AppDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(databasePath = DEFAULT_DATABASE_PATH) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  return drizzle(sqlite, { schema });
}

export const db = createDatabase();
```

Create `frontend/src/server/db/migrate.ts`:

```ts
import type { AppDatabase } from "./client";

export function runMigrations(db: AppDatabase) {
  const sqlite = db.$client;

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bids (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_bid_id TEXT,
      dedupe_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      full_description TEXT,
      original_category TEXT,
      amount TEXT,
      amount_min INTEGER,
      amount_max INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      published_date TEXT,
      deadline_date TEXT,
      issuer_name TEXT NOT NULL,
      issuer_type TEXT NOT NULL,
      state_code TEXT NOT NULL,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      source_url TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      raw_payload TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source, source_bid_id)
    );

    CREATE TABLE IF NOT EXISTS bid_attachments (
      id TEXT PRIMARY KEY,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      size_label TEXT,
      mime_type TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_bids (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, bid_id)
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      query TEXT,
      states TEXT,
      issuer_type TEXT,
      deadline_preset TEXT,
      published_preset TEXT,
      frequency TEXT NOT NULL DEFAULT 'daily',
      notification_channel TEXT NOT NULL DEFAULT 'email',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      last_matched_at TEXT,
      last_notified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS crawler_logs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      fetched_count INTEGER NOT NULL DEFAULT 0,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      error_stack TEXT,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS data_sources (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      issuer_type TEXT NOT NULL,
      state_code TEXT NOT NULL,
      base_url TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      cadence TEXT NOT NULL DEFAULT 'daily',
      last_success_at TEXT,
      last_failure_at TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_bids_active_deadline ON bids(is_active, deadline_date);
    CREATE INDEX IF NOT EXISTS idx_bids_published_date ON bids(published_date);
    CREATE INDEX IF NOT EXISTS idx_bids_state_code ON bids(state_code);
    CREATE INDEX IF NOT EXISTS idx_bids_issuer_type ON bids(issuer_type);
    CREATE INDEX IF NOT EXISTS idx_bids_source ON bids(source);
    CREATE INDEX IF NOT EXISTS idx_bid_attachments_bid_id ON bid_attachments(bid_id);
    CREATE INDEX IF NOT EXISTS idx_saved_bids_bid_id ON saved_bids(bid_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);
    CREATE INDEX IF NOT EXISTS idx_crawler_logs_source_started ON crawler_logs(source, started_at);
    CREATE INDEX IF NOT EXISTS idx_crawler_logs_run_id ON crawler_logs(run_id);
  `);
}
```

- [ ] **Step 8: Add script entrypoints**

Create `frontend/scripts/migrate-db.ts`:

```ts
import { createDatabase } from "../src/server/db/client.ts";
import { runMigrations } from "../src/server/db/migrate.ts";

const db = createDatabase();
runMigrations(db);
db.$client.close();
console.log("Database migrated");
```

Create `frontend/scripts/seed-db.ts`:

```ts
import { createDatabase } from "../src/server/db/client.ts";
import { runMigrations } from "../src/server/db/migrate.ts";
import { seedDatabase } from "../src/server/db/seed.ts";

const db = createDatabase();
runMigrations(db);
await seedDatabase(db);
db.$client.close();
console.log("Database seeded");
```

Modify `frontend/package.json` scripts:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "db:migrate": "tsx scripts/migrate-db.ts",
    "db:seed": "tsx scripts/seed-db.ts"
  }
}
```

- [ ] **Step 9: Add seed helper**

Create `frontend/src/server/db/seed.ts`:

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "./client";
import { bidAttachments, bids, dataSources, users } from "./schema";
import { MOCK_BIDS } from "../../lib/mock-data";

const SEED_TIMESTAMP = "2026-05-19T00:00:00.000Z";

function parseAmount(value: string) {
  const matches = [...value.matchAll(/\$?(\d+(?:\.\d+)?)\s*([MK])?/gi)];
  const amounts = matches.map((match) => {
    const number = Number(match[1]);
    const suffix = match[2]?.toUpperCase();
    if (suffix === "M") return Math.round(number * 1_000_000);
    if (suffix === "K") return Math.round(number * 1_000);
    return Math.round(number);
  });

  return {
    amountMin: amounts[0] ?? null,
    amountMax: amounts[1] ?? amounts[0] ?? null,
  };
}

export async function seedDatabase(db: AppDatabase) {
  db.insert(users)
    .values({
      id: "anon_seed",
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    })
    .onConflictDoNothing()
    .run();

  const sourceRows = new Map(
    MOCK_BIDS.map((bid) => [
      bid.source,
      {
        id: bid.source.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
        label: bid.source,
        issuerType: bid.issuerType,
        stateCode: bid.stateCode,
        baseUrl: bid.sourceUrl,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
      },
    ]),
  );

  for (const source of sourceRows.values()) {
    db.insert(dataSources).values(source).onConflictDoNothing().run();
  }

  for (const bid of MOCK_BIDS) {
    const amount = parseAmount(bid.amount);
    db.insert(bids)
      .values({
        id: bid.id,
        source: bid.source,
        sourceBidId: `mock:${bid.id}`,
        dedupeKey: `mock:${bid.id}`,
        title: bid.title,
        description: bid.description,
        fullDescription: bid.fullDescription,
        originalCategory: bid.originalCategory,
        amount: bid.amount,
        amountMin: amount.amountMin,
        amountMax: amount.amountMax,
        currency: "USD",
        publishedDate: bid.publishedDate,
        deadlineDate: bid.deadlineDate,
        issuerName: bid.issuerName,
        issuerType: bid.issuerType,
        stateCode: bid.stateCode,
        contactName: bid.contactName,
        contactEmail: bid.contactEmail,
        contactPhone: bid.contactPhone,
        sourceUrl: bid.sourceUrl,
        isActive: bid.isActive ? 1 : 0,
        rawPayload: JSON.stringify(bid),
        firstSeenAt: SEED_TIMESTAMP,
        lastSeenAt: SEED_TIMESTAMP,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
      })
      .onConflictDoUpdate({
        target: bids.id,
        set: {
          title: bid.title,
          description: bid.description,
          fullDescription: bid.fullDescription,
          updatedAt: SEED_TIMESTAMP,
        },
      })
      .run();

    db.delete(bidAttachments).where(eq(bidAttachments.bidId, bid.id)).run();
    bid.attachments.forEach((attachment, index) => {
      db.insert(bidAttachments)
        .values({
          id: randomUUID(),
          bidId: bid.id,
          name: attachment.name,
          url: attachment.url,
          sizeLabel: attachment.size,
          sortOrder: index,
          createdAt: SEED_TIMESTAMP,
        })
        .run();
    });
  }
}
```

- [ ] **Step 10: Add DB test utility**

Create `frontend/src/server/db/test-utils.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDatabase, type AppDatabase } from "./client";
import { runMigrations } from "./migrate";
import { seedDatabase } from "./seed";

export interface TestDatabase {
  db: AppDatabase;
  databasePath: string;
  cleanup: () => Promise<void>;
}

export async function createTestDatabase(options: { seed?: boolean } = {}): Promise<TestDatabase> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "apsi-db-"));
  const databasePath = path.join(directory, "apsi.sqlite");
  const db = createDatabase(databasePath);
  runMigrations(db);

  if (options.seed) {
    await seedDatabase(db);
  }

  return {
    db,
    databasePath,
    cleanup: async () => {
      db.$client.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 11: Verify GREEN**

Run:

```bash
cd frontend
npm test -- src/server/db/schema.test.ts
npm run db:migrate
npm run db:seed
```

Expected:

- Test passes.
- `frontend/data/apsi.sqlite` is created.
- Migration and seed scripts print success messages.

- [ ] **Step 12: Clean runtime DB and commit**

Run:

```bash
rm -f frontend/data/apsi.sqlite frontend/data/apsi.sqlite-shm frontend/data/apsi.sqlite-wal
git status --short
git add frontend/package.json frontend/package-lock.json frontend/.gitignore frontend/drizzle.config.ts frontend/src/server/db frontend/scripts
git commit -m "feat: add sqlite database foundation"
```

Expected: commit succeeds and no runtime SQLite file is staged.

---

### Task 2: Move Bid Repository And Saved Bids To The Database

**Files:**

- Create: `frontend/src/server/bids/domain.ts`
- Modify: `frontend/src/server/bids/repository.ts`
- Modify: `frontend/src/server/bids/service.ts`
- Modify: `frontend/src/server/bids/types.ts`
- Modify: `frontend/src/app/api/bids/route.ts`
- Modify: `frontend/src/app/api/bids/[id]/route.ts`
- Modify: `frontend/src/app/api/saved-bids/route.ts`
- Modify: `frontend/src/app/api/saved-bids/[id]/route.ts`
- Modify tests under `frontend/src/server/bids/*` and `frontend/src/app/api/*`

- [ ] **Step 1: Add failing repository DB tests**

Create or replace `frontend/src/server/bids/repository.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  getBidByIdFromRepository,
  listBids,
  listSavedBidIds,
  removeSavedBidId,
  saveSavedBidId,
} from "./repository";

describe("bid repository", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("lists seeded bids with per-user saved state", async () => {
    await saveSavedBidId(testDb.db, "anon_a", "1");

    const bids = await listBids(testDb.db, ["1"]);

    expect(bids).toHaveLength(6);
    expect(bids.find((bid) => bid.id === "1")?.saved).toBe(true);
    expect(bids.find((bid) => bid.id === "2")?.saved).toBe(false);
  });

  it("gets a bid with attachments by id", async () => {
    const bid = await getBidByIdFromRepository(testDb.db, "1");

    expect(bid?.title).toBe("Enterprise Cloud Migration Services");
    expect(bid?.attachments.map((attachment) => attachment.name)).toContain("Statement_of_Work_v2.pdf");
  });

  it("persists saved bids per user", async () => {
    await saveSavedBidId(testDb.db, "anon_a", "1");
    await saveSavedBidId(testDb.db, "anon_b", "2");

    expect(await listSavedBidIds(testDb.db, "anon_a")).toEqual(["1"]);
    expect(await listSavedBidIds(testDb.db, "anon_b")).toEqual(["2"]);

    await removeSavedBidId(testDb.db, "anon_a", "1");

    expect(await listSavedBidIds(testDb.db, "anon_a")).toEqual([]);
    expect(await listSavedBidIds(testDb.db, "anon_b")).toEqual(["2"]);
  });
});
```

- [ ] **Step 2: Run repository test and verify RED**

Run:

```bash
cd frontend
npm test -- src/server/bids/repository.test.ts
```

Expected: FAIL because repository functions do not accept a DB and saved bid functions do not exist.

- [ ] **Step 3: Add bid domain types**

Create `frontend/src/server/bids/domain.ts`:

```ts
export interface BidAttachment {
  name: string;
  url: string;
  size: string;
}

export type IssuerType = "federal" | "state";

export interface Bid {
  id: string;
  title: string;
  source: string;
  sourceUrl: string;
  issuerName: string;
  issuerType: IssuerType;
  stateCode: string;
  originalCategory: string;
  description: string;
  fullDescription: string;
  amount: string;
  publishedDate: string;
  deadlineDate: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  attachments: BidAttachment[];
  tags: string[];
  saved: boolean;
  isActive: boolean;
}
```

Modify `frontend/src/server/bids/types.ts` to import `Bid` and filter types from `domain.ts` or local string unions rather than `mock-data.ts`.

- [ ] **Step 4: Implement DB repository**

Replace repository internals with DB-backed functions:

```ts
import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { bidAttachments, bids, savedBids, users } from "@/server/db/schema";
import type { Bid } from "./domain";

function nowIso() {
  return new Date().toISOString();
}

function tagsFromBid(row: typeof bids.$inferSelect) {
  return [row.originalCategory, row.stateCode, row.issuerType].filter(Boolean);
}

async function attachmentsForBids(db: AppDatabase, bidIds: string[]) {
  if (bidIds.length === 0) return new Map<string, Bid["attachments"]>();

  const rows = await db
    .select()
    .from(bidAttachments)
    .where(inArray(bidAttachments.bidId, bidIds))
    .orderBy(asc(bidAttachments.sortOrder));

  const byBid = new Map<string, Bid["attachments"]>();
  rows.forEach((row) => {
    const current = byBid.get(row.bidId) ?? [];
    current.push({
      name: row.name,
      url: row.url,
      size: row.sizeLabel ?? "",
    });
    byBid.set(row.bidId, current);
  });

  return byBid;
}

function toBid(
  row: typeof bids.$inferSelect,
  attachments: Bid["attachments"],
  savedBidIds: Set<string>,
): Bid {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    sourceUrl: row.sourceUrl,
    issuerName: row.issuerName,
    issuerType: row.issuerType as Bid["issuerType"],
    stateCode: row.stateCode,
    originalCategory: row.originalCategory ?? "",
    description: row.description,
    fullDescription: row.fullDescription ?? "",
    amount: row.amount ?? "",
    publishedDate: row.publishedDate ?? "",
    deadlineDate: row.deadlineDate ?? "",
    contactName: row.contactName ?? "",
    contactEmail: row.contactEmail ?? "",
    contactPhone: row.contactPhone ?? "",
    attachments,
    tags: tagsFromBid(row),
    saved: savedBidIds.has(row.id),
    isActive: row.isActive === 1,
  };
}

export async function ensureUser(db: AppDatabase, userId: string) {
  const timestamp = nowIso();
  await db.insert(users).values({
    id: userId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).onConflictDoNothing().run();
}

export async function listBids(db: AppDatabase, savedBidIds: string[] = []) {
  const rows = await db.select().from(bids);
  const attachmentMap = await attachmentsForBids(db, rows.map((row) => row.id));
  const savedSet = new Set(savedBidIds);

  return rows.map((row) => toBid(row, attachmentMap.get(row.id) ?? [], savedSet));
}

export async function getBidByIdFromRepository(db: AppDatabase, id: string) {
  const [row] = await db.select().from(bids).where(eq(bids.id, id)).limit(1);
  if (!row) return undefined;
  const attachmentMap = await attachmentsForBids(db, [id]);
  return toBid(row, attachmentMap.get(id) ?? [], new Set());
}

export async function listSavedBidIds(db: AppDatabase, userId: string) {
  await ensureUser(db, userId);
  const rows = await db
    .select({ bidId: savedBids.bidId })
    .from(savedBids)
    .where(eq(savedBids.userId, userId))
    .orderBy(asc(savedBids.createdAt));

  return rows.map((row) => row.bidId);
}

export async function saveSavedBidId(db: AppDatabase, userId: string, bidId: string) {
  await ensureUser(db, userId);
  await db.insert(savedBids).values({
    userId,
    bidId,
    createdAt: nowIso(),
  }).onConflictDoNothing().run();
  return listSavedBidIds(db, userId);
}

export async function removeSavedBidId(db: AppDatabase, userId: string, bidId: string) {
  await db.delete(savedBids).where(and(eq(savedBids.userId, userId), eq(savedBids.bidId, bidId))).run();
  return listSavedBidIds(db, userId);
}
```

- [ ] **Step 5: Update service to async DB-backed behavior**

Modify `frontend/src/server/bids/service.ts`:

- Import `db` from `@/server/db/client`.
- Call `listBids(db, savedIds)`.
- Call `listSavedBidIds(db, userId)`.
- Call `saveSavedBidId(db, userId, id)`.
- Call `removeSavedBidId(db, userId, id)`.
- Make `queryBids` and `getBidById` async.

The public signatures should be:

```ts
export async function queryBids(query: BidQuery, options: BidQueryOptions = {}): Promise<BidListResponse>;
export async function getBidById(id: string): Promise<Bid | undefined>;
export async function getSavedBids(userId: string): Promise<SavedBidsResponse>;
export async function saveBid(userId: string, id: string): Promise<SavedBidsResponse>;
export async function removeSavedBid(userId: string, id: string): Promise<SavedBidsResponse>;
```

- [ ] **Step 6: Update API routes for async bid service**

Modify:

- `frontend/src/app/api/bids/route.ts`
- `frontend/src/app/api/bids/[id]/route.ts`

Ensure they `await bidService.queryBids(...)` and `await bidService.getBidById(...)`.

- [ ] **Step 7: Remove JSON saved-bids store from runtime path**

Keep `saved-bids-store.ts` only if needed for migration tests, or delete it if no longer referenced.

Run:

```bash
cd frontend
rg "saved-bids-store|savedBidsStore"
```

Expected: no runtime imports remain outside old tests. Update or delete obsolete tests.

- [ ] **Step 8: Verify GREEN for bid tests**

Run:

```bash
cd frontend
npm test -- src/server/db src/server/bids src/app/api/bids src/app/api/saved-bids
npm run db:migrate
npm run db:seed
```

Expected: all targeted tests pass and seeded DB supports current routes.

- [ ] **Step 9: Build and commit**

Run:

```bash
cd frontend
npm run lint
npm run build
rm -f data/apsi.sqlite data/apsi.sqlite-shm data/apsi.sqlite-wal
cd ..
git add frontend
git commit -m "feat: move bid data and saved bids to sqlite"
```

Expected: lint and build pass; runtime DB is not staged.

---

### Task 3: Add Local Account And Session Auth

**Files:**

- Create: `frontend/src/server/auth/password.ts`
- Create: `frontend/src/server/auth/password.test.ts`
- Create: `frontend/src/server/auth/session.ts`
- Create: `frontend/src/server/auth/session.test.ts`
- Create: `frontend/src/server/auth/service.ts`
- Create: `frontend/src/server/auth/service.test.ts`
- Create: `frontend/src/app/api/auth/register/route.ts`
- Create: `frontend/src/app/api/auth/login/route.ts`
- Create: `frontend/src/app/api/auth/logout/route.ts`
- Create: `frontend/src/app/api/auth/session/route.ts`
- Create: route tests for the above
- Create: `frontend/src/lib/api/auth.ts`
- Create: `frontend/src/context/AuthContext.tsx`
- Create: `frontend/src/app/login/page.tsx`
- Create: `frontend/src/app/register/page.tsx`
- Modify: app providers/layout/header component as needed

- [ ] **Step 1: Write failing password tests**

Create `frontend/src/server/auth/password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes a password without storing the plain text", async () => {
    const stored = await hashPassword("correct horse battery staple");

    expect(stored).not.toContain("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(await verifyPassword("wrong password", stored)).toBe(false);
  });

  it("uses a different salt for each hash", async () => {
    const first = await hashPassword("same-password");
    const second = await hashPassword("same-password");

    expect(first).not.toBe(second);
  });
});
```

- [ ] **Step 2: Run password tests and verify RED**

Run:

```bash
cd frontend
npm test -- src/server/auth/password.test.ts
```

Expected: FAIL because `./password` does not exist.

- [ ] **Step 3: Implement password hashing**

Create `frontend/src/server/auth/password.ts`:

```ts
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, key] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !key) return false;

  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const storedKey = Buffer.from(key, "hex");
  if (derivedKey.length !== storedKey.length) return false;

  return timingSafeEqual(derivedKey, storedKey);
}
```

- [ ] **Step 4: Add auth service tests**

Create `frontend/src/server/auth/service.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { registerUser, loginUser, getSessionUser, logoutSession } from "./service";

describe("auth service", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("registers a user and creates a session", async () => {
    const result = await registerUser(testDb.db, {
      email: "Buyer@Example.com",
      password: "strong-password",
      displayName: "Buyer One",
    });

    expect(result.user.email).toBe("buyer@example.com");
    expect(result.sessionToken).toMatch(/^sess_/);
    expect(await getSessionUser(testDb.db, result.sessionToken)).toMatchObject({
      email: "buyer@example.com",
    });
  });

  it("logs in with the correct password and rejects the wrong password", async () => {
    await registerUser(testDb.db, {
      email: "buyer@example.com",
      password: "strong-password",
      displayName: "Buyer One",
    });

    await expect(loginUser(testDb.db, "buyer@example.com", "wrong-password")).rejects.toThrow("Invalid email or password");
    await expect(loginUser(testDb.db, "buyer@example.com", "strong-password")).resolves.toMatchObject({
      user: { email: "buyer@example.com" },
    });
  });

  it("logs out by deleting the session", async () => {
    const result = await registerUser(testDb.db, {
      email: "buyer@example.com",
      password: "strong-password",
    });

    await logoutSession(testDb.db, result.sessionToken);

    expect(await getSessionUser(testDb.db, result.sessionToken)).toBeNull();
  });
});
```

- [ ] **Step 5: Implement auth session helpers**

Create `frontend/src/server/auth/session.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "apsi_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function createSessionToken() {
  return `sess_${randomBytes(32).toString("base64url")}`;
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionCookie(token: string) {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ].join("; ");
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readSessionToken(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|; )${SESSION_COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}
```

- [ ] **Step 6: Implement auth service**

Create `frontend/src/server/auth/service.ts` with:

- `registerUser(db, input)`
- `loginUser(db, email, password)`
- `getSessionUser(db, sessionToken)`
- `logoutSession(db, sessionToken)`
- public user shape `{ id, email, displayName }`

Use `users` and `sessions` from DB schema. Use `hashPassword`, `verifyPassword`, `createSessionToken`, and `hashSessionToken`.

- [ ] **Step 7: Add auth API route tests**

Create tests for:

- `POST /api/auth/register` sets `apsi_session`.
- duplicate email returns `409`.
- weak password returns `400`.
- `POST /api/auth/login` sets `apsi_session`.
- wrong password returns `401`.
- `POST /api/auth/logout` clears `apsi_session`.
- `GET /api/auth/session` returns `{ user: null }` without valid session.

Run:

```bash
cd frontend
npm test -- src/app/api/auth src/server/auth
```

Expected before implementation: route tests fail because routes do not exist.

- [ ] **Step 8: Implement auth API routes**

Create:

- `frontend/src/app/api/auth/register/route.ts`
- `frontend/src/app/api/auth/login/route.ts`
- `frontend/src/app/api/auth/logout/route.ts`
- `frontend/src/app/api/auth/session/route.ts`

Each route should use the singleton `db`, validate request body, and return JSON error shapes compatible with existing API style.

- [ ] **Step 9: Add auth client and context**

Create `frontend/src/lib/api/auth.ts` with:

```ts
export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
}

export async function getSession(): Promise<{ user: PublicUser | null }>;
export async function register(input: { email: string; password: string; displayName?: string }): Promise<{ user: PublicUser }>;
export async function login(input: { email: string; password: string }): Promise<{ user: PublicUser }>;
export async function logout(): Promise<void>;
```

Create `frontend/src/context/AuthContext.tsx` with:

- `user`
- `isLoading`
- `error`
- `register`
- `login`
- `logout`
- `refreshSession`

- [ ] **Step 10: Add login and register pages**

Create `frontend/src/app/login/page.tsx` and `frontend/src/app/register/page.tsx`.

Minimum UI:

- email input
- password input
- display name on register
- submit button
- loading state
- error state
- link between login and register

Use existing UI components and bilingual dictionaries where practical.

- [ ] **Step 11: Verify auth flow**

Run:

```bash
cd frontend
npm test -- src/server/auth src/app/api/auth
npm run lint
npm run build
```

Expected: tests, lint, and build pass.

- [ ] **Step 12: Commit**

Run:

```bash
git add frontend
git commit -m "feat: add local account authentication"
```

---

### Task 4: Add Auth-Aware Principal Resolution And Saved-Bid Migration

**Files:**

- Create: `frontend/src/server/auth/principal.ts`
- Modify: `frontend/src/server/bids/repository.ts`
- Modify: `frontend/src/server/bids/service.ts`
- Modify: `frontend/src/app/api/saved-bids/route.ts`
- Modify: `frontend/src/app/api/saved-bids/[id]/route.ts`
- Modify auth register/login routes to merge anonymous saved bids

- [ ] **Step 1: Add failing principal tests**

Create `frontend/src/server/auth/principal.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { registerUser } from "./service";
import { createSessionCookie } from "./session";
import { resolvePrincipal } from "./principal";

describe("principal resolution", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("uses an authenticated session when present", async () => {
    const { user, sessionToken } = await registerUser(testDb.db, {
      email: "buyer@example.com",
      password: "strong-password",
    });

    const request = new Request("http://localhost/api/saved-bids", {
      headers: { cookie: createSessionCookie(sessionToken) },
    });

    await expect(resolvePrincipal(testDb.db, request)).resolves.toMatchObject({
      userId: user.id,
      kind: "authenticated",
      isNewAnonymousUser: false,
    });
  });

  it("falls back to anonymous user and creates a cookie when needed", async () => {
    const request = new Request("http://localhost/api/saved-bids");

    const principal = await resolvePrincipal(testDb.db, request);

    expect(principal.kind).toBe("anonymous");
    expect(principal.userId).toMatch(/^anon_/);
    expect(principal.isNewAnonymousUser).toBe(true);
  });
});
```

- [ ] **Step 2: Run principal tests and verify RED**

Run:

```bash
cd frontend
npm test -- src/server/auth/principal.test.ts
```

Expected: FAIL because `principal.ts` does not exist.

- [ ] **Step 3: Implement principal resolver**

Create `frontend/src/server/auth/principal.ts`:

```ts
import type { AppDatabase } from "@/server/db/client";
import { ensureUser } from "@/server/bids/repository";
import { createAnonymousUserCookie, resolveAnonymousUser } from "@/server/bids/user";
import { getSessionUser } from "./service";
import { readSessionToken } from "./session";

export interface Principal {
  kind: "authenticated" | "anonymous";
  userId: string;
  isNewAnonymousUser: boolean;
  anonymousCookie?: string;
}

export async function resolvePrincipal(db: AppDatabase, request: Request): Promise<Principal> {
  const sessionToken = readSessionToken(request);
  if (sessionToken) {
    const user = await getSessionUser(db, sessionToken);
    if (user) {
      return {
        kind: "authenticated",
        userId: user.id,
        isNewAnonymousUser: false,
      };
    }
  }

  const anonymous = resolveAnonymousUser(request);
  await ensureUser(db, anonymous.userId);

  return {
    kind: "anonymous",
    userId: anonymous.userId,
    isNewAnonymousUser: anonymous.isNewUser,
    anonymousCookie: anonymous.isNewUser ? createAnonymousUserCookie(anonymous.userId) : undefined,
  };
}
```

- [ ] **Step 4: Add saved-bid merge tests**

Add to bid repository or service tests:

```ts
it("merges saved bids from anonymous user into authenticated user", async () => {
  await saveSavedBidId(testDb.db, "anon_a", "1");
  await saveSavedBidId(testDb.db, "user_a", "2");

  await mergeSavedBidIds(testDb.db, "anon_a", "user_a");

  expect(await listSavedBidIds(testDb.db, "user_a")).toEqual(["2", "1"]);
});
```

Expected RED: `mergeSavedBidIds` does not exist.

- [ ] **Step 5: Implement saved-bid merge**

Add to `frontend/src/server/bids/repository.ts`:

```ts
export async function mergeSavedBidIds(db: AppDatabase, fromUserId: string, toUserId: string) {
  await ensureUser(db, fromUserId);
  await ensureUser(db, toUserId);
  const fromIds = await listSavedBidIds(db, fromUserId);
  for (const bidId of fromIds) {
    await saveSavedBidId(db, toUserId, bidId);
  }
  return listSavedBidIds(db, toUserId);
}
```

- [ ] **Step 6: Update saved-bids routes to use principal**

Modify saved-bids routes:

- Resolve principal with singleton `db`.
- Pass `principal.userId` into bid service.
- Set anonymous cookie when `principal.anonymousCookie` exists.
- Continue setting session cookies from auth routes.

- [ ] **Step 7: Merge anonymous saved bids on register/login**

In register/login routes:

- Before creating response, resolve anonymous user from the incoming request if cookie exists.
- After session creation, call `mergeSavedBidIds(db, anonymousId, user.id)`.
- Clear anonymous cookie in the response.

- [ ] **Step 8: Verify migration behavior**

Run:

```bash
cd frontend
npm test -- src/server/auth src/server/bids src/app/api/auth src/app/api/saved-bids
```

Expected: authenticated and anonymous saved-bids tests pass.

- [ ] **Step 9: Commit**

Run:

```bash
git add frontend
git commit -m "feat: use authenticated principals for saved bids"
```

---

### Task 5: Persist Saved Search Alerts

**Files:**

- Create: `frontend/src/server/search-alerts/types.ts`
- Create: `frontend/src/server/search-alerts/service.ts`
- Create: `frontend/src/server/search-alerts/service.test.ts`
- Create: `frontend/src/app/api/search-alerts/route.ts`
- Create: `frontend/src/app/api/search-alerts/[id]/route.ts`
- Create route tests
- Create: `frontend/src/lib/api/search-alerts.ts`
- Create: `frontend/src/lib/api/search-alerts.test.ts`
- Modify: `frontend/src/app/search/page.tsx`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] **Step 1: Add failing service tests**

Create `frontend/src/server/search-alerts/service.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createSearchAlert, deleteSearchAlert, listSearchAlerts, updateSearchAlert } from "./service";

describe("search alerts service", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("creates and lists alerts for one user", async () => {
    const created = await createSearchAlert(testDb.db, "anon_a", {
      name: "Cloud bids",
      query: { q: "cloud", states: ["federal"], issuerType: "all", deadline: "any", published: "any", sort: "relevance" },
      frequency: "daily",
      isEnabled: true,
    });

    expect(created.name).toBe("Cloud bids");
    expect(await listSearchAlerts(testDb.db, "anon_a")).toHaveLength(1);
    expect(await listSearchAlerts(testDb.db, "anon_b")).toEqual([]);
  });

  it("updates and deletes only the owning user's alert", async () => {
    const created = await createSearchAlert(testDb.db, "anon_a", {
      name: "Cloud bids",
      query: { q: "cloud", states: [], issuerType: "all", deadline: "any", published: "any", sort: "relevance" },
      frequency: "daily",
      isEnabled: true,
    });

    await updateSearchAlert(testDb.db, "anon_a", created.id, { isEnabled: false });
    expect((await listSearchAlerts(testDb.db, "anon_a"))[0].isEnabled).toBe(false);

    await expect(deleteSearchAlert(testDb.db, "anon_b", created.id)).rejects.toThrow("Search alert not found");
    await deleteSearchAlert(testDb.db, "anon_a", created.id);
    expect(await listSearchAlerts(testDb.db, "anon_a")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run service test and verify RED**

Run:

```bash
cd frontend
npm test -- src/server/search-alerts/service.test.ts
```

Expected: FAIL because service module does not exist.

- [ ] **Step 3: Implement search alert types and service**

Create `frontend/src/server/search-alerts/types.ts`:

```ts
import type { BidQuery } from "@/server/bids/types";

export type AlertFrequency = "daily" | "weekly";

export interface SearchAlert {
  id: string;
  userId: string;
  name: string;
  query: BidQuery;
  frequency: AlertFrequency;
  isEnabled: boolean;
  lastMatchedAt: string | null;
  lastNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSearchAlertInput {
  name: string;
  query: BidQuery;
  frequency: AlertFrequency;
  isEnabled: boolean;
}

export interface UpdateSearchAlertInput {
  name?: string;
  query?: BidQuery;
  frequency?: AlertFrequency;
  isEnabled?: boolean;
}

export class SearchAlertNotFoundError extends Error {
  constructor() {
    super("Search alert not found");
    this.name = "SearchAlertNotFoundError";
  }
}
```

Create `frontend/src/server/search-alerts/service.ts` with DB-backed create/list/update/delete using `alerts` table and `ensureUser`.

- [ ] **Step 4: Add route and client tests**

Add tests for:

- `GET /api/search-alerts` sets anonymous cookie when needed.
- `POST /api/search-alerts` creates an alert.
- `PATCH /api/search-alerts/[id]` toggles `isEnabled`.
- `DELETE /api/search-alerts/[id]` deletes.
- malformed body returns `INVALID_REQUEST`.
- missing alert returns `ALERT_NOT_FOUND`.
- client API uses correct URLs and methods.

- [ ] **Step 5: Implement search-alert routes**

Create routes:

- `frontend/src/app/api/search-alerts/route.ts`
- `frontend/src/app/api/search-alerts/[id]/route.ts`

Use `resolvePrincipal(db, request)` and set anonymous cookie when needed.

- [ ] **Step 6: Implement search-alert client**

Create `frontend/src/lib/api/search-alerts.ts` exporting:

```ts
export async function listSearchAlerts(): Promise<{ alerts: SearchAlert[] }>;
export async function createSearchAlert(input: CreateSearchAlertInput): Promise<{ alert: SearchAlert }>;
export async function updateSearchAlert(id: string, input: UpdateSearchAlertInput): Promise<{ alert: SearchAlert }>;
export async function deleteSearchAlert(id: string): Promise<void>;
```

Use the existing `ApiError` pattern from `frontend/src/lib/api/bids.ts`.

- [ ] **Step 7: Update `/search` page**

Modify `frontend/src/app/search/page.tsx`:

- Remove `INITIAL_ALERTS`.
- Load alerts from API on mount.
- Show loading, error, empty, and list states.
- Create alert from quick search input.
- Toggle active state with `PATCH`.
- Delete with `DELETE`.
- Keep edit disabled or hidden in this slice.
- Use i18n dictionary keys for all visible copy.

- [ ] **Step 8: Verify alerts**

Run:

```bash
cd frontend
npm test -- src/server/search-alerts src/app/api/search-alerts src/lib/api/search-alerts.test.ts
npm run lint
npm run build
```

Expected: tests, lint, and build pass.

- [ ] **Step 9: Commit**

Run:

```bash
git add frontend
git commit -m "feat: persist saved search alerts"
```

---

### Task 6: Add Crawler Scaffold And Fixture-Backed SAM.gov Importer

**Files:**

- Create: `crawler/requirements.txt`
- Create: `crawler/apsi_crawler/__init__.py`
- Create: `crawler/apsi_crawler/config.py`
- Create: `crawler/apsi_crawler/cli.py`
- Create: `crawler/apsi_crawler/normalizers/bids.py`
- Create: `crawler/apsi_crawler/sources/registry.py`
- Create: `crawler/apsi_crawler/spiders/sam_gov.py`
- Create: `crawler/apsi_crawler/storage/sqlite.py`
- Create: `crawler/tests/fixtures/sam_gov_opportunities.json`
- Create: `crawler/tests/test_normalizers.py`
- Create: `crawler/tests/test_sam_gov.py`
- Create: `crawler/tests/test_storage.py`
- Create: `frontend/src/server/crawler/logs-repository.ts`
- Create: `frontend/src/app/api/health/scrapers/route.ts`

- [ ] **Step 1: Add crawler requirements**

Create `crawler/requirements.txt`:

```text
pytest==8.3.5
requests==2.32.3
```

- [ ] **Step 2: Add failing normalizer test**

Create `crawler/tests/test_normalizers.py`:

```py
from apsi_crawler.normalizers.bids import normalize_sam_gov_opportunity


def test_normalize_sam_gov_opportunity():
    raw = {
        "noticeId": "abc-123",
        "title": "Enterprise Cloud Migration Services",
        "solicitationNumber": "DOD-CLOUD-2026",
        "department": "DEPARTMENT OF DEFENSE",
        "postedDate": "2026-05-01",
        "responseDeadLine": "2026-06-15T17:00:00-05:00",
        "uiLink": "https://sam.gov/opp/abc-123/view",
        "type": "Solicitation",
    }

    bid = normalize_sam_gov_opportunity(raw)

    assert bid["source"] == "SAM.gov"
    assert bid["source_bid_id"] == "abc-123"
    assert bid["title"] == "Enterprise Cloud Migration Services"
    assert bid["issuer_type"] == "federal"
    assert bid["state_code"] == "US"
    assert bid["source_url"] == "https://sam.gov/opp/abc-123/view"
```

- [ ] **Step 3: Run crawler test and verify RED**

Run:

```bash
cd crawler
python -m pip install -r requirements.txt
python -m pytest tests/test_normalizers.py
```

Expected: FAIL because `apsi_crawler.normalizers.bids` does not exist.

- [ ] **Step 4: Implement normalizer**

Create `crawler/apsi_crawler/normalizers/bids.py`:

```py
from datetime import datetime, timezone


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def normalize_sam_gov_opportunity(raw):
    notice_id = raw.get("noticeId") or raw.get("solicitationNumber")
    title = raw.get("title") or "Untitled SAM.gov opportunity"
    timestamp = now_iso()

    return {
        "id": f"sam_gov:{notice_id}",
        "source": "SAM.gov",
        "source_bid_id": notice_id,
        "dedupe_key": f"sam_gov:{notice_id}",
        "title": title,
        "description": raw.get("description") or raw.get("type") or "",
        "full_description": raw.get("description") or "",
        "original_category": raw.get("type") or "",
        "amount": raw.get("award", {}).get("amount") if isinstance(raw.get("award"), dict) else None,
        "amount_min": None,
        "amount_max": None,
        "currency": "USD",
        "published_date": raw.get("postedDate"),
        "deadline_date": raw.get("responseDeadLine"),
        "issuer_name": raw.get("department") or raw.get("organizationName") or "Unknown agency",
        "issuer_type": "federal",
        "state_code": "US",
        "contact_name": None,
        "contact_email": None,
        "contact_phone": None,
        "source_url": raw.get("uiLink") or "https://sam.gov",
        "is_active": 1,
        "raw_payload": raw,
        "first_seen_at": timestamp,
        "last_seen_at": timestamp,
        "created_at": timestamp,
        "updated_at": timestamp,
        "attachments": [],
    }
```

- [ ] **Step 5: Add fixture importer tests**

Create `crawler/tests/fixtures/sam_gov_opportunities.json` with two SAM.gov-shaped records.

Create `crawler/tests/test_sam_gov.py`:

```py
from pathlib import Path
from apsi_crawler.spiders.sam_gov import load_fixture_opportunities


def test_load_fixture_opportunities():
    fixture = Path(__file__).parent / "fixtures" / "sam_gov_opportunities.json"
    bids = load_fixture_opportunities(fixture)

    assert len(bids) == 2
    assert bids[0]["source"] == "SAM.gov"
```

Expected RED: `spiders.sam_gov` does not exist.

- [ ] **Step 6: Implement fixture importer**

Create `crawler/apsi_crawler/spiders/sam_gov.py`:

```py
import json
from pathlib import Path
from apsi_crawler.normalizers.bids import normalize_sam_gov_opportunity


def load_fixture_opportunities(path):
    payload = json.loads(Path(path).read_text())
    records = payload.get("opportunitiesData", payload if isinstance(payload, list) else [])
    return [normalize_sam_gov_opportunity(record) for record in records]
```

- [ ] **Step 7: Add SQLite storage tests**

Create `crawler/tests/test_storage.py`:

```py
import sqlite3
from apsi_crawler.storage.sqlite import upsert_bid, write_crawler_log


def test_upsert_bid_is_idempotent(tmp_path):
    db_path = tmp_path / "apsi.sqlite"
    connection = sqlite3.connect(db_path)
    connection.executescript("""
      CREATE TABLE bids (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_bid_id TEXT,
        dedupe_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        issuer_name TEXT NOT NULL,
        issuer_type TEXT NOT NULL,
        state_code TEXT NOT NULL,
        source_url TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE crawler_logs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        fetched_count INTEGER NOT NULL DEFAULT 0,
        inserted_count INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0
      );
    """)

    bid = {
        "id": "sam_gov:abc",
        "source": "SAM.gov",
        "source_bid_id": "abc",
        "dedupe_key": "sam_gov:abc",
        "title": "Cloud",
        "description": "Cloud work",
        "issuer_name": "DOD",
        "issuer_type": "federal",
        "state_code": "US",
        "source_url": "https://sam.gov",
        "is_active": 1,
        "first_seen_at": "2026-05-19T00:00:00Z",
        "last_seen_at": "2026-05-19T00:00:00Z",
        "created_at": "2026-05-19T00:00:00Z",
        "updated_at": "2026-05-19T00:00:00Z",
    }

    assert upsert_bid(connection, bid) == "inserted"
    assert upsert_bid(connection, {**bid, "title": "Cloud Updated"}) == "updated"
    assert connection.execute("SELECT COUNT(*) FROM bids").fetchone()[0] == 1

    write_crawler_log(connection, source="SAM.gov", run_id="run_1", status="success", fetched_count=1, inserted_count=1, updated_count=0)
    assert connection.execute("SELECT COUNT(*) FROM crawler_logs").fetchone()[0] == 1
```

- [ ] **Step 8: Implement crawler SQLite storage**

Create `crawler/apsi_crawler/storage/sqlite.py`:

```py
from uuid import uuid4
from datetime import datetime, timezone


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def upsert_bid(connection, bid):
    existing = connection.execute("SELECT id FROM bids WHERE dedupe_key = ?", (bid["dedupe_key"],)).fetchone()
    if existing:
      connection.execute(
          "UPDATE bids SET title = ?, description = ?, last_seen_at = ?, updated_at = ? WHERE dedupe_key = ?",
          (bid["title"], bid["description"], bid["last_seen_at"], bid["updated_at"], bid["dedupe_key"]),
      )
      connection.commit()
      return "updated"

    connection.execute(
        """
        INSERT INTO bids (
          id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type,
          state_code, source_url, is_active, first_seen_at, last_seen_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            bid["id"], bid["source"], bid["source_bid_id"], bid["dedupe_key"], bid["title"],
            bid["description"], bid["issuer_name"], bid["issuer_type"], bid["state_code"],
            bid["source_url"], bid["is_active"], bid["first_seen_at"], bid["last_seen_at"],
            bid["created_at"], bid["updated_at"],
        ),
    )
    connection.commit()
    return "inserted"


def write_crawler_log(connection, source, run_id, status, fetched_count, inserted_count, updated_count):
    connection.execute(
        """
        INSERT INTO crawler_logs (
          id, source, run_id, status, started_at, fetched_count, inserted_count, updated_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (str(uuid4()), source, run_id, status, now_iso(), fetched_count, inserted_count, updated_count),
    )
    connection.commit()
```

- [ ] **Step 9: Add CLI and source registry**

Create:

- `crawler/apsi_crawler/config.py`
- `crawler/apsi_crawler/sources/registry.py`
- `crawler/apsi_crawler/cli.py`

The CLI should support:

```bash
python -m apsi_crawler.cli import-fixture --database ../frontend/data/apsi.sqlite --fixture tests/fixtures/sam_gov_opportunities.json
```

- [ ] **Step 10: Add scraper health API**

Create `frontend/src/server/crawler/logs-repository.ts` and `frontend/src/app/api/health/scrapers/route.ts`.

The route returns:

```json
{
  "sources": [
    {
      "source": "SAM.gov",
      "lastStatus": "success",
      "lastRunAt": "2026-05-19T00:00:00.000Z",
      "fetchedCount": 2,
      "insertedCount": 2,
      "updatedCount": 0
    }
  ]
}
```

- [ ] **Step 11: Verify crawler**

Run:

```bash
cd crawler
python -m pytest
cd ../frontend
npm test -- src/app/api/health src/server/crawler
npm run lint
npm run build
```

Expected: crawler tests, health API tests, lint, and build pass.

- [ ] **Step 12: Commit**

Run:

```bash
git add crawler frontend/src/server/crawler frontend/src/app/api/health
git commit -m "feat: add sam gov crawler foundation"
```

---

### Task 7: Full Integration And Browser Acceptance

**Files:**

- Modify only files needed to resolve integration failures.

- [ ] **Step 1: Run all automated verification**

Run:

```bash
cd frontend
npm test
npm run lint
npm run build
cd ../crawler
python -m pytest
```

Expected: all commands pass.

- [ ] **Step 2: Seed local DB and start dev server**

Run:

```bash
cd frontend
npm run db:migrate
npm run db:seed
npm run dev
```

Expected: app starts at `http://localhost:3000`.

- [ ] **Step 3: API acceptance**

Run with the dev server active:

```bash
curl -sS 'http://localhost:3000/api/bids?q=cloud' | rg 'Enterprise Cloud Migration Services'
COOKIE_JAR=$(mktemp)
curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST -H 'Content-Type: application/json' -d '{"bidId":"1"}' 'http://localhost:3000/api/saved-bids' | rg 'Enterprise Cloud Migration Services'
curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" 'http://localhost:3000/api/saved-bids' | rg '"savedBidIds":\\["1"\\]'
rm "$COOKIE_JAR"
```

Expected: bid search and saved-bids APIs return seeded DB data.

- [ ] **Step 4: Auth acceptance**

Use browser or curl:

- Register `buyer@example.com`.
- Confirm response sets `apsi_session`.
- Save a bid while anonymous, register, then confirm saved bid remains visible.
- Logout.
- Login again.
- Confirm saved bid remains associated with the account.

- [ ] **Step 5: Alerts acceptance**

Use browser:

- Open `/search`.
- Create a cloud alert.
- Toggle it off.
- Toggle it on.
- Delete it.
- Confirm empty state returns.
- Switch Chinese and English.

- [ ] **Step 6: Crawler fixture acceptance**

Run:

```bash
cd crawler
python -m apsi_crawler.cli import-fixture --database ../frontend/data/apsi.sqlite --fixture tests/fixtures/sam_gov_opportunities.json
curl -sS 'http://localhost:3000/api/health/scrapers' | rg 'SAM.gov'
```

Expected: health endpoint includes SAM.gov run status.

- [ ] **Step 7: Mobile sanity check**

Use browser automation at 390px width:

- `/`
- `/saved`
- `/search`
- `/login`
- `/register`

Expected: no horizontal overflow.

- [ ] **Step 8: Stop dev server and clean runtime files**

Run:

```bash
rm -f frontend/data/apsi.sqlite frontend/data/apsi.sqlite-shm frontend/data/apsi.sqlite-wal
git status --short
```

Expected: worktree only shows intentional source changes.

- [ ] **Step 9: Final review and commit**

Run final code review for the full implementation. Fix blocking findings, then:

```bash
git add .
git commit -m "test: verify data auth crawler alerts foundation"
```

If there are no source changes after verification, do not create an empty commit.
