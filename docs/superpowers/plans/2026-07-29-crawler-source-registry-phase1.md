# 阶段 1：源目录数据化 + 50 州迁移 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把爬虫源目录从硬编码常量迁移到 `data_sources` 表，让 `cadence` 驱动调度，为后续 2000+ 郡县市源打好地基。

**Architecture:** `data_sources` 表成为源清单唯一真源；Node 侧新增查询层与纯函数调度器；Python 侧把「按源硬编码」的 registry 换成「按平台」的适配器注册表，源参数经 JSON 契约由 stdin 传入。41 个现有 spider 零改动——它们的 `fetch(source, query, limit, ...)` 签名保持不变，只是 `source` 对象改由任务 JSON 构造。

**Tech Stack:** TypeScript / Next.js 16.2.6 / Drizzle ORM / better-sqlite3 / mysql2 / Vitest；Python 3 stdlib + requests + pytest。

## Global Constraints

- **双 dialect 强制**：每个新增的数据库查询必须同时实现 SQLite（Drizzle）与 MySQL（手写 SQL）两条分支。MySQL 模式下 `@/server/db/client` 导出的 `db` 是抛 `MysqlRuntimeDatabaseGuardError` 的 Proxy，只写 Drizzle 分支会在运行时硬失败。命名约定：`foo(db, …)` / `fooFromMysql(pool, …)`。
- **新增数据库列必须四处同步**，漏任何一处都会在某条路径上缺列：
  1. `frontend/src/server/db/schema.ts` — Drizzle 表定义
  2. `frontend/src/server/db/migrate.ts` — 第一个 `sqlite.exec(\`…\`)` 块内的 `CREATE TABLE`（新建库 + MySQL DDL 生成源）
  3. `frontend/src/server/db/migrate.ts` — `addDataSourceColumn(…)` / `addBidColumn(…)`（已存在的 SQLite 库）
  4. `frontend/src/server/db/mysql.ts` — `mysqlColumnMigrations` 数组（已存在的 MySQL 库）
- **新表与新索引必须放在 `migrate.ts` 的第一个 `sqlite.exec()` 块内**。`mysql.ts` 用正则只提取第一个块，块外语句永远到不了 MySQL。
- 测试用 Vitest，`globals: false`——必须显式 `import { describe, it, expect } from "vitest"`。
- 前端测试从 `frontend/` 运行：`npx vitest run <path>`。爬虫测试从 `crawler/` 运行：`PYTHONPATH=. pytest <path>`。
- 数据库测试用 `createTestDatabase({ seed })`（`@/server/db/test-utils`），并在 `afterEach` 中 `await testDb.cleanup()`。
- `cadence` 合法值：`hourly`（1 小时）、`daily`（24 小时）、`weekly`（7 天）、`manual`（不参与自动调度）。非法值按 `daily` 处理。
- 失败阈值默认值：连续 3 轮空结果告警、连续 5 次失败降级 `needs_review`、退避上限 7 天。
- FIPS 州码为标准 2 位 GEOID，跳号 03/07/11/14/43/52 不用于州。

---

## File Structure

**新建：**

| 文件 | 职责 |
|---|---|
| `frontend/src/server/crawler/source-registry.ts` | 查 `data_sources` 取可抓取源，双 dialect |
| `frontend/src/server/crawler/source-registry.test.ts` | 上者测试 |
| `frontend/src/server/crawler/scheduler.ts` | cadence 到期判定、退避、排序，纯函数 |
| `frontend/src/server/crawler/scheduler.test.ts` | 上者测试 |
| `frontend/src/server/crawler/failure-classifier.ts` | 三类失败分类，纯函数 |
| `frontend/src/server/crawler/failure-classifier.test.ts` | 上者测试 |
| `frontend/src/server/crawler/source-health-repository.ts` | 写回 `last_success_at` / `consecutive_failures`，双 dialect |
| `frontend/src/server/crawler/source-health-repository.test.ts` | 上者测试 |
| `frontend/src/lib/state-fips.ts` | 50 州 FIPS 常量表 |
| `frontend/scripts/migrate-source-registry.ts` | 50 州 upsert 迁移脚本 |
| `frontend/scripts/migrate-source-registry.test.ts` | 上者测试 |
| `crawler/apsi_crawler/adapters/__init__.py` | 包入口 |
| `crawler/apsi_crawler/adapters/task.py` | `TaskSource`：由任务 JSON 构造的 source 对象 |
| `crawler/apsi_crawler/adapters/registry.py` | 适配器注册表与解析链 |
| `crawler/tests/test_adapter_task.py` | `TaskSource` 测试 |
| `crawler/tests/test_adapter_registry.py` | 解析链测试 |
| `crawler/tests/test_fetch_task_cli.py` | `fetch-task` 子命令测试 |
| `crawler/tests/test_contract_compatibility.py` | 跨语言契约测试 |
| `crawler/tests/fixtures/contracts/fetch_task_v1.json` | 共享契约样本（由 Node 测试生成，Python 测试消费） |

**修改：**

| 文件 | 改动 |
|---|---|
| `frontend/src/server/db/schema.ts` | `dataSources` + `bids` 加列 |
| `frontend/src/server/db/migrate.ts` | CREATE TABLE 加列 + `addDataSourceColumn` / `addBidColumn` |
| `frontend/src/server/db/mysql.ts` | `mysqlColumnMigrations` 加 7 项 |
| `frontend/src/server/crawler/state-runner.ts` | argv 拼装 → JSON 契约经 stdin |
| `frontend/src/server/crawler/configured-runner.ts` | 删 `CONFIGURED_CRAWLER_SOURCES`，改查表 |
| `frontend/src/lib/state-crawler-sources.ts` | 退役治理元数据，仅留州码↔名称 |
| `frontend/src/lib/state-crawler-sources.test.ts` | 「50 条」断言 → 适配器覆盖断言 |
| `crawler/apsi_crawler/cli.py` | 新增 `fetch-task`，删 fallback fixture 生产路径 |
| `crawler/apsi_crawler/sources/state_sources.py` | 删除（Task 12） |

---

## Task 1: 数据库 schema 扩展

**Files:**
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/src/server/db/mysql.ts`
- Test: `frontend/src/server/db/schema.test.ts`, `frontend/src/server/db/mysql.test.ts`

**Interfaces:**
- Produces: `dataSources.jurisdictionLevel` / `.jurisdictionName` / `.fipsCode` / `.fetchConfig`；`bids.jurisdictionLevel` / `.jurisdictionName` / `.fipsCode`。后续所有任务依赖这 7 列。

- [ ] **Step 1: 写失败的测试**

在 `frontend/src/server/db/schema.test.ts` 末尾追加：

```typescript
describe("jurisdiction columns", () => {
  it("exposes jurisdiction columns on data_sources and bids", async () => {
    const testDb = await createTestDatabase({ seed: false });
    try {
      const sourceColumns = testDb.db.$client
        .prepare("PRAGMA table_info(data_sources)")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(sourceColumns).toContain("jurisdiction_level");
      expect(sourceColumns).toContain("jurisdiction_name");
      expect(sourceColumns).toContain("fips_code");
      expect(sourceColumns).toContain("fetch_config");

      const bidColumns = testDb.db.$client
        .prepare("PRAGMA table_info(bids)")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(bidColumns).toContain("jurisdiction_level");
      expect(bidColumns).toContain("jurisdiction_name");
      expect(bidColumns).toContain("fips_code");
    } finally {
      await testDb.cleanup();
    }
  });
});
```

在 `frontend/src/server/db/mysql.test.ts` 末尾追加：

```typescript
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
```

在该文件顶部的 import 中加入 `mysqlColumnMigrationStatements`（若 `mysql.ts` 尚未导出该函数，本任务需一并导出；它应返回 `mysqlColumnMigrations` 映射出的 `ALTER TABLE <t> ADD COLUMN <c> <def>` 字符串数组）。

- [ ] **Step 2: 运行测试确认失败**

```bash
cd frontend && npx vitest run src/server/db/schema.test.ts src/server/db/mysql.test.ts
```

预期：FAIL，列不存在 / `mysqlColumnMigrationStatements` 未导出。

- [ ] **Step 3: 实现**

`schema.ts` 的 `dataSources` 定义中，在 `complianceNotes` 之后、`createdAt` 之前插入：

```typescript
  jurisdictionLevel: text("jurisdiction_level"),
  jurisdictionName: text("jurisdiction_name"),
  fipsCode: text("fips_code"),
  fetchConfig: text("fetch_config"),
```

`schema.ts` 的 `bids` 定义中，在 `createdAt` 之前插入：

```typescript
  jurisdictionLevel: text("jurisdiction_level"),
  jurisdictionName: text("jurisdiction_name"),
  fipsCode: text("fips_code"),
```

`migrate.ts` 第一个 `sqlite.exec()` 块内，`CREATE TABLE IF NOT EXISTS data_sources` 的 `compliance_notes TEXT,` 之后加：

```sql
      jurisdiction_level TEXT,
      jurisdiction_name TEXT,
      fips_code TEXT,
      fetch_config TEXT,
```

同一块内 `CREATE TABLE IF NOT EXISTS bids` 的 `created_at` 之前加：

```sql
      jurisdiction_level TEXT,
      jurisdiction_name TEXT,
      fips_code TEXT,
```

同块内追加索引（必须在第一个 exec 块内，否则不会到 MySQL）：

```sql
    CREATE INDEX IF NOT EXISTS idx_data_sources_jurisdiction ON data_sources(jurisdiction_level, state_code);
    CREATE INDEX IF NOT EXISTS idx_bids_fips_code ON bids(fips_code);
```

`migrate.ts` 底部，现有 `addDataSourceColumn(...)` 序列末尾追加：

```typescript
  addDataSourceColumn("jurisdiction_level", "TEXT");
  addDataSourceColumn("jurisdiction_name", "TEXT");
  addDataSourceColumn("fips_code", "TEXT");
  addDataSourceColumn("fetch_config", "TEXT");
```

在 `bids` 的 `addBidColumn(...)` 序列末尾追加：

```typescript
  addBidColumn("jurisdiction_level", "TEXT");
  addBidColumn("jurisdiction_name", "TEXT");
  addBidColumn("fips_code", "TEXT");
```

`mysql.ts` 的 `mysqlColumnMigrations` 数组末尾追加 7 项：

```typescript
  { tableName: "data_sources", columnName: "jurisdiction_level", definition: "VARCHAR(191)" },
  { tableName: "data_sources", columnName: "jurisdiction_name", definition: "LONGTEXT" },
  { tableName: "data_sources", columnName: "fips_code", definition: "VARCHAR(191)" },
  { tableName: "data_sources", columnName: "fetch_config", definition: "LONGTEXT" },
  { tableName: "bids", columnName: "jurisdiction_level", definition: "VARCHAR(191)" },
  { tableName: "bids", columnName: "jurisdiction_name", definition: "LONGTEXT" },
  { tableName: "bids", columnName: "fips_code", definition: "VARCHAR(191)" },
```

`jurisdiction_level` 与 `fips_code` 用 `VARCHAR(191)` 因为它们进索引；`LONGTEXT` 不能建索引。

若 `mysqlColumnMigrationStatements` 尚未存在，在 `mysql.ts` 中导出：

```typescript
export function mysqlColumnMigrationStatements() {
  return mysqlColumnMigrations.map(
    (migration) =>
      `ALTER TABLE ${migration.tableName} ADD COLUMN ${migration.columnName} ${migration.definition}`,
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd frontend && npx vitest run src/server/db/schema.test.ts src/server/db/mysql.test.ts
```

预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/server/db/schema.ts frontend/src/server/db/migrate.ts frontend/src/server/db/mysql.ts frontend/src/server/db/schema.test.ts frontend/src/server/db/mysql.test.ts
git commit -m "feat(db): add jurisdiction level, name, FIPS code and fetch config columns"
```

---

## Task 2: 州 FIPS 常量表

**Files:**
- Create: `frontend/src/lib/state-fips.ts`
- Test: `frontend/src/lib/state-fips.test.ts`

**Interfaces:**
- Produces: `STATE_FIPS: Record<string, string>`（州码大写 → 2 位 FIPS），`fipsForStateCode(stateCode: string): string | null`。Task 4 的迁移脚本消费。

- [ ] **Step 1: 写失败的测试**

创建 `frontend/src/lib/state-fips.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { STATE_FIPS, fipsForStateCode } from "./state-fips";

describe("state FIPS table", () => {
  it("covers all 50 states", () => {
    expect(Object.keys(STATE_FIPS)).toHaveLength(50);
  });

  it("maps known states to standard two-digit GEOIDs", () => {
    expect(STATE_FIPS.CA).toBe("06");
    expect(STATE_FIPS.TX).toBe("48");
    expect(STATE_FIPS.NY).toBe("36");
    expect(STATE_FIPS.WY).toBe("56");
  });

  it("uses two-digit zero-padded codes everywhere", () => {
    for (const code of Object.values(STATE_FIPS)) {
      expect(code).toMatch(/^\d{2}$/);
    }
  });

  it("never reuses a FIPS code across states", () => {
    expect(new Set(Object.values(STATE_FIPS)).size).toBe(50);
  });

  it("resolves case-insensitively and returns null for unknown codes", () => {
    expect(fipsForStateCode("ca")).toBe("06");
    expect(fipsForStateCode("US")).toBeNull();
    expect(fipsForStateCode("")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd frontend && npx vitest run src/lib/state-fips.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现**

创建 `frontend/src/lib/state-fips.ts`：

```typescript
/**
 * 标准 FIPS/GEOID 州码（2 位）。03/07/11/14/43/52 不用于州，故跳号。
 * 郡级 GEOID = 州码 + 3 位郡码（共 5 位），市/place 级 = 州码 + 5 位 place 码（共 7 位）。
 */
export const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06",
  CO: "08", CT: "09", DE: "10", FL: "12", GA: "13",
  HI: "15", ID: "16", IL: "17", IN: "18", IA: "19",
  KS: "20", KY: "21", LA: "22", ME: "23", MD: "24",
  MA: "25", MI: "26", MN: "27", MS: "28", MO: "29",
  MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34",
  NM: "35", NY: "36", NC: "37", ND: "38", OH: "39",
  OK: "40", OR: "41", PA: "42", RI: "44", SC: "45",
  SD: "46", TN: "47", TX: "48", UT: "49", VT: "50",
  VA: "51", WA: "53", WV: "54", WI: "55", WY: "56",
};

export function fipsForStateCode(stateCode: string): string | null {
  const normalized = stateCode.trim().toUpperCase();
  return STATE_FIPS[normalized] ?? null;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd frontend && npx vitest run src/lib/state-fips.test.ts
```

预期：PASS，5 个测试全绿。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/lib/state-fips.ts frontend/src/lib/state-fips.test.ts
git commit -m "feat(lib): add standard state FIPS GEOID table"
```

---

## Task 3: 源目录查询层

**Files:**
- Create: `frontend/src/server/crawler/source-registry.ts`
- Test: `frontend/src/server/crawler/source-registry.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `dataSources` 新列。
- Produces:
  - `interface CrawlableSource { id: string; label: string; issuerType: string; stateCode: string; baseUrl: string | null; cadence: string; providerFamily: string | null; jurisdictionLevel: string | null; jurisdictionName: string | null; fipsCode: string | null; fetchConfig: Record<string, unknown>; lastSuccessAt: string | null; consecutiveFailures: number; }`
  - `listCrawlableSources(db: AppDatabase): CrawlableSource[]`
  - `listCrawlableSourcesFromMysql(pool: MysqlSourceStore): Promise<CrawlableSource[]>`
  - `interface MysqlSourceStore { query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]> }`

  Task 5（调度器）与 Task 10（configured-runner）消费 `CrawlableSource`。

- [ ] **Step 1: 写失败的测试**

创建 `frontend/src/server/crawler/source-registry.test.ts`：

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { listCrawlableSources, listCrawlableSourcesFromMysql } from "./source-registry";

const NOW = "2026-07-29T00:00:00.000Z";

function sourceRow(overrides: Partial<typeof dataSources.$inferInsert> = {}) {
  return {
    id: "ca_caleprocure",
    label: "California Cal eProcure",
    issuerType: "state",
    stateCode: "CA",
    baseUrl: "https://caleprocure.ca.gov",
    isEnabled: 1,
    cadence: "daily",
    approvedForIngestion: 1,
    approvalStatus: "approved",
    legalReviewStatus: "approved_public",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("listCrawlableSources", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("returns approved and enabled sources", () => {
    testDb.db.insert(dataSources).values(sourceRow()).run();
    const sources = listCrawlableSources(testDb.db);
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe("ca_caleprocure");
    expect(sources[0].cadence).toBe("daily");
    expect(sources[0].consecutiveFailures).toBe(0);
  });

  it("excludes disabled sources", () => {
    testDb.db.insert(dataSources).values(sourceRow({ id: "off", isEnabled: 0 })).run();
    expect(listCrawlableSources(testDb.db)).toHaveLength(0);
  });

  it("excludes sources explicitly denied ingestion", () => {
    testDb.db.insert(dataSources).values(sourceRow({ id: "unapproved", approvedForIngestion: 0 })).run();
    expect(listCrawlableSources(testDb.db)).toHaveLength(0);
  });

  it("includes sources whose governance fields are unset, matching orchestrator semantics", () => {
    // orchestrator.ts blocks only on an EXPLICIT denial: approvedForIngestion === false,
    // a non-approved approvalStatus, or a restricted legalReviewStatus. NULL means
    // "never reviewed", not "denied" — SAM.gov and the seeded sources sit in this state,
    // and excluding them here would silently stop crawling them.
    testDb.db
      .insert(dataSources)
      .values(sourceRow({
        id: "sam_gov",
        issuerType: "federal",
        approvedForIngestion: null,
        approvalStatus: null,
        legalReviewStatus: null,
      }))
      .run();

    const sources = listCrawlableSources(testDb.db);
    expect(sources.map((source) => source.id)).toEqual(["sam_gov"]);
  });

  it("excludes sources whose approval status is not approved", () => {
    testDb.db.insert(dataSources).values(sourceRow({ id: "pending", approvalStatus: "needs_review" })).run();
    expect(listCrawlableSources(testDb.db)).toHaveLength(0);
  });

  it("excludes sources whose legal review has not approved ingestion", () => {
    testDb.db.insert(dataSources).values(sourceRow({ id: "restricted", legalReviewStatus: "restricted" })).run();
    expect(listCrawlableSources(testDb.db)).toHaveLength(0);
  });

  it("parses fetch_config JSON and defaults to an empty object", () => {
    testDb.db
      .insert(dataSources)
      .values(sourceRow({ id: "with_config", fetchConfig: '{"tenant":"acme"}' }))
      .run();
    testDb.db.insert(dataSources).values(sourceRow({ id: "no_config" })).run();

    const byId = new Map(listCrawlableSources(testDb.db).map((source) => [source.id, source]));
    expect(byId.get("with_config")?.fetchConfig).toEqual({ tenant: "acme" });
    expect(byId.get("no_config")?.fetchConfig).toEqual({});
  });

  it("treats malformed fetch_config as an empty object rather than throwing", () => {
    testDb.db.insert(dataSources).values(sourceRow({ id: "broken", fetchConfig: "{not json" })).run();
    expect(listCrawlableSources(testDb.db)[0].fetchConfig).toEqual({});
  });
});

describe("listCrawlableSourcesFromMysql", () => {
  it("maps MySQL rows onto CrawlableSource", async () => {
    const pool = {
      query: async () => [
        [
          {
            id: "tx_esbd",
            label: "Texas ESBD",
            issuerType: "state",
            stateCode: "TX",
            baseUrl: "https://www.txsmartbuy.com",
            cadence: "weekly",
            providerFamily: null,
            jurisdictionLevel: "state",
            jurisdictionName: "Texas",
            fipsCode: "48",
            fetchConfig: '{"tenant":"tx"}',
            lastSuccessAt: "2026-07-01T00:00:00.000Z",
            consecutiveFailures: 2,
          },
        ],
      ] as [unknown[], unknown?],
    };

    const sources = await listCrawlableSourcesFromMysql(pool);
    expect(sources).toHaveLength(1);
    expect(sources[0].fipsCode).toBe("48");
    expect(sources[0].fetchConfig).toEqual({ tenant: "tx" });
    expect(sources[0].consecutiveFailures).toBe(2);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd frontend && npx vitest run src/server/crawler/source-registry.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现**

创建 `frontend/src/server/crawler/source-registry.ts`：

```typescript
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlSelectMany } from "@/server/db/mysql-runtime";
import { dataSources } from "@/server/db/schema";

export interface CrawlableSource {
  id: string;
  label: string;
  issuerType: string;
  stateCode: string;
  baseUrl: string | null;
  cadence: string;
  providerFamily: string | null;
  jurisdictionLevel: string | null;
  jurisdictionName: string | null;
  fipsCode: string | null;
  fetchConfig: Record<string, unknown>;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

export interface MysqlSourceStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
}

/**
 * 治理门禁语义必须与 orchestrator.ts 的 blockedReasonFor 完全一致:
 * 只有 **显式拒绝** 才排除,NULL 表示"尚未审核"而非"拒绝"。
 *
 * 生产数据现状(2026-07-29):45 个 beta 州源是 approved_for_ingestion=0
 * (显式拒绝,本来就跑不了),5 个 verified 源是 1,另有 6 行三个字段全 NULL
 * ——其中包括 sam_gov。若把 NULL 当拒绝,SAM.gov 会被静默停掉。
 */
const LEGAL_REVIEW_ALLOWED = ["approved_public", "approved"];

function parseFetchConfig(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function listCrawlableSources(db: AppDatabase): CrawlableSource[] {
  const rows = db
    .select()
    .from(dataSources)
    .where(
      and(
        eq(dataSources.isEnabled, 1),
        or(isNull(dataSources.approvedForIngestion), eq(dataSources.approvedForIngestion, 1)),
        or(isNull(dataSources.approvalStatus), eq(dataSources.approvalStatus, "approved")),
        or(
          isNull(dataSources.legalReviewStatus),
          inArray(dataSources.legalReviewStatus, LEGAL_REVIEW_ALLOWED),
        ),
      ),
    )
    .all();

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    issuerType: row.issuerType,
    stateCode: row.stateCode,
    baseUrl: row.baseUrl ?? null,
    cadence: row.cadence,
    providerFamily: row.providerFamily ?? null,
    jurisdictionLevel: row.jurisdictionLevel ?? null,
    jurisdictionName: row.jurisdictionName ?? null,
    fipsCode: row.fipsCode ?? null,
    fetchConfig: parseFetchConfig(row.fetchConfig),
    lastSuccessAt: row.lastSuccessAt ?? null,
    consecutiveFailures: row.consecutiveFailures ?? 0,
  }));
}

interface MysqlSourceRow {
  id: string;
  label: string;
  issuerType: string;
  stateCode: string;
  baseUrl: string | null;
  cadence: string | null;
  providerFamily: string | null;
  jurisdictionLevel: string | null;
  jurisdictionName: string | null;
  fipsCode: string | null;
  fetchConfig: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number | string | null;
}

export async function listCrawlableSourcesFromMysql(
  pool: MysqlSourceStore,
): Promise<CrawlableSource[]> {
  const rows = await mysqlSelectMany<MysqlSourceRow>(
    pool,
    `
      SELECT
        id,
        label,
        issuer_type AS issuerType,
        state_code AS stateCode,
        base_url AS baseUrl,
        cadence,
        provider_family AS providerFamily,
        jurisdiction_level AS jurisdictionLevel,
        jurisdiction_name AS jurisdictionName,
        fips_code AS fipsCode,
        fetch_config AS fetchConfig,
        last_success_at AS lastSuccessAt,
        consecutive_failures AS consecutiveFailures
      FROM data_sources
      WHERE is_enabled = 1
        AND (approved_for_ingestion IS NULL OR approved_for_ingestion = 1)
        AND (approval_status IS NULL OR approval_status = 'approved')
        AND (legal_review_status IS NULL OR legal_review_status IN ('approved_public', 'approved'))
    `,
  );

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    issuerType: row.issuerType,
    stateCode: row.stateCode,
    baseUrl: row.baseUrl ?? null,
    cadence: row.cadence ?? "daily",
    providerFamily: row.providerFamily ?? null,
    jurisdictionLevel: row.jurisdictionLevel ?? null,
    jurisdictionName: row.jurisdictionName ?? null,
    fipsCode: row.fipsCode ?? null,
    fetchConfig: parseFetchConfig(row.fetchConfig),
    lastSuccessAt: row.lastSuccessAt ?? null,
    consecutiveFailures: Number(row.consecutiveFailures ?? 0),
  }));
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd frontend && npx vitest run src/server/crawler/source-registry.test.ts
```

预期：PASS，9 个测试全绿。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/server/crawler/source-registry.ts frontend/src/server/crawler/source-registry.test.ts
git commit -m "feat(crawler): read crawlable sources from data_sources with governance gating"
```

---

## Task 4: cadence 调度纯函数

**Files:**
- Create: `frontend/src/server/crawler/scheduler.ts`
- Test: `frontend/src/server/crawler/scheduler.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `CrawlableSource`。
- Produces:
  - `CADENCE_INTERVAL_MS: Record<"hourly" | "daily" | "weekly", number>`
  - `cadenceIntervalMs(cadence: string): number | null`（`manual` 与非法值的处理见实现）
  - `nextDueAt(source: CrawlableSource): string | null`
  - `selectDueSources(sources: CrawlableSource[], now: Date): CrawlableSource[]`

  Task 10 的 configured-runner 消费 `selectDueSources`。

- [ ] **Step 1: 写失败的测试**

创建 `frontend/src/server/crawler/scheduler.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import type { CrawlableSource } from "./source-registry";
import { cadenceIntervalMs, nextDueAt, selectDueSources } from "./scheduler";

const NOW = new Date("2026-07-29T12:00:00.000Z");

function source(overrides: Partial<CrawlableSource> = {}): CrawlableSource {
  return {
    id: "src",
    label: "Source",
    issuerType: "state",
    stateCode: "CA",
    baseUrl: "https://example.gov",
    cadence: "daily",
    providerFamily: null,
    jurisdictionLevel: "state",
    jurisdictionName: "California",
    fipsCode: "06",
    fetchConfig: {},
    lastSuccessAt: null,
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe("cadenceIntervalMs", () => {
  it("maps known cadences to their intervals", () => {
    expect(cadenceIntervalMs("hourly")).toBe(60 * 60 * 1000);
    expect(cadenceIntervalMs("daily")).toBe(24 * 60 * 60 * 1000);
    expect(cadenceIntervalMs("weekly")).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("returns null for manual so it never auto-schedules", () => {
    expect(cadenceIntervalMs("manual")).toBeNull();
  });

  it("falls back to daily for unknown values", () => {
    expect(cadenceIntervalMs("fortnightly")).toBe(24 * 60 * 60 * 1000);
    expect(cadenceIntervalMs("")).toBe(24 * 60 * 60 * 1000);
  });
});

describe("nextDueAt", () => {
  it("returns null for a source that never succeeded (due immediately)", () => {
    expect(nextDueAt(source({ lastSuccessAt: null }))).toBeNull();
  });

  it("adds the cadence interval to the last success", () => {
    expect(nextDueAt(source({ lastSuccessAt: "2026-07-28T12:00:00.000Z" }))).toBe(
      "2026-07-29T12:00:00.000Z",
    );
  });

  it("doubles the interval per consecutive failure", () => {
    expect(
      nextDueAt(source({ lastSuccessAt: "2026-07-28T12:00:00.000Z", consecutiveFailures: 2 })),
    ).toBe("2026-08-01T12:00:00.000Z");
  });

  it("caps backoff at seven days", () => {
    expect(
      nextDueAt(source({ lastSuccessAt: "2026-07-28T12:00:00.000Z", consecutiveFailures: 20 })),
    ).toBe("2026-08-04T12:00:00.000Z");
  });
});

describe("selectDueSources", () => {
  it("includes sources that never succeeded", () => {
    expect(selectDueSources([source({ lastSuccessAt: null })], NOW)).toHaveLength(1);
  });

  it("excludes sources whose next run is in the future", () => {
    const notYet = source({ lastSuccessAt: "2026-07-29T06:00:00.000Z" });
    expect(selectDueSources([notYet], NOW)).toHaveLength(0);
  });

  it("excludes manual sources entirely", () => {
    const manual = source({ cadence: "manual", lastSuccessAt: null });
    expect(selectDueSources([manual], NOW)).toHaveLength(0);
  });

  it("orders state-level sources before county and city", () => {
    const city = source({ id: "city", jurisdictionLevel: "city" });
    const county = source({ id: "county", jurisdictionLevel: "county" });
    const state = source({ id: "state", jurisdictionLevel: "state" });
    const ordered = selectDueSources([city, county, state], NOW).map((s) => s.id);
    expect(ordered).toEqual(["state", "county", "city"]);
  });

  it("interleaves sources of the same provider family", () => {
    const sources = [
      source({ id: "bidnet_1", providerFamily: "bidnet" }),
      source({ id: "bidnet_2", providerFamily: "bidnet" }),
      source({ id: "bidnet_3", providerFamily: "bidnet" }),
      source({ id: "bonfire_1", providerFamily: "bonfire" }),
    ];
    const ordered = selectDueSources(sources, NOW).map((s) => s.providerFamily);
    expect(ordered[0]).not.toBe(ordered[1]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd frontend && npx vitest run src/server/crawler/scheduler.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现**

创建 `frontend/src/server/crawler/scheduler.ts`：

```typescript
import type { CrawlableSource } from "./source-registry";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const CADENCE_INTERVAL_MS = {
  hourly: HOUR_MS,
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
} as const;

/** 退避上限：连续失败再多也不会超过 7 天才重试一次。 */
const MAX_BACKOFF_MS = 7 * DAY_MS;

const JURISDICTION_ORDER = ["federal", "state", "county", "city", "special_district"];

export function cadenceIntervalMs(cadence: string): number | null {
  if (cadence === "manual") return null;
  return CADENCE_INTERVAL_MS[cadence as keyof typeof CADENCE_INTERVAL_MS] ?? CADENCE_INTERVAL_MS.daily;
}

export function nextDueAt(source: CrawlableSource): string | null {
  if (!source.lastSuccessAt) return null;
  const interval = cadenceIntervalMs(source.cadence);
  if (interval === null) return null;

  const failures = Math.max(0, source.consecutiveFailures);
  // 2^failures 会在 failures 很大时溢出，先夹到 10（1024 倍）再取 min。
  const factor = 2 ** Math.min(failures, 10);
  const effective = Math.min(interval * factor, MAX_BACKOFF_MS);

  return new Date(new Date(source.lastSuccessAt).getTime() + effective).toISOString();
}

function jurisdictionRank(level: string | null) {
  const index = JURISDICTION_ORDER.indexOf(level ?? "");
  return index === -1 ? JURISDICTION_ORDER.length : index;
}

/** 同 provider_family 的源轮转交错，避免连续打同一个平台。 */
function interleaveByProviderFamily(sources: CrawlableSource[]): CrawlableSource[] {
  const groups = new Map<string, CrawlableSource[]>();
  for (const source of sources) {
    const key = source.providerFamily ?? `__self__:${source.id}`;
    const group = groups.get(key);
    if (group) group.push(source);
    else groups.set(key, [source]);
  }

  const result: CrawlableSource[] = [];
  const lists = [...groups.values()];
  let placed = true;
  while (placed) {
    placed = false;
    for (const list of lists) {
      const next = list.shift();
      if (next) {
        result.push(next);
        placed = true;
      }
    }
  }

  return result;
}

export function selectDueSources(sources: CrawlableSource[], now: Date): CrawlableSource[] {
  const nowMs = now.getTime();

  const due = sources.filter((source) => {
    if (cadenceIntervalMs(source.cadence) === null) return false;
    const dueAt = nextDueAt(source);
    return dueAt === null || nowMs >= new Date(dueAt).getTime();
  });

  const sorted = [...due].sort((left, right) => {
    const rankDelta = jurisdictionRank(left.jurisdictionLevel) - jurisdictionRank(right.jurisdictionLevel);
    if (rankDelta !== 0) return rankDelta;

    const leftDue = nextDueAt(left);
    const rightDue = nextDueAt(right);
    if (leftDue === null && rightDue !== null) return -1;
    if (leftDue !== null && rightDue === null) return 1;
    if (leftDue !== null && rightDue !== null && leftDue !== rightDue) {
      return leftDue < rightDue ? -1 : 1;
    }
    return left.id.localeCompare(right.id);
  });

  // 分层交错：同一 jurisdiction level 内部才打散，保持州级优先的整体顺序。
  const byLevel = new Map<number, CrawlableSource[]>();
  for (const source of sorted) {
    const rank = jurisdictionRank(source.jurisdictionLevel);
    const bucket = byLevel.get(rank);
    if (bucket) bucket.push(source);
    else byLevel.set(rank, [source]);
  }

  return [...byLevel.keys()]
    .sort((a, b) => a - b)
    .flatMap((rank) => interleaveByProviderFamily(byLevel.get(rank)!));
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd frontend && npx vitest run src/server/crawler/scheduler.test.ts
```

预期：PASS，12 个测试全绿。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/server/crawler/scheduler.ts frontend/src/server/crawler/scheduler.test.ts
git commit -m "feat(crawler): add cadence-driven scheduler with failure backoff"
```

---

## Task 5: 失败分类器

**Files:**
- Create: `frontend/src/server/crawler/failure-classifier.ts`
- Test: `frontend/src/server/crawler/failure-classifier.test.ts`

**Interfaces:**
- Produces:
  - `type CrawlerFailureKind = "network" | "parse" | "empty" | "unknown"`
  - `classifyCrawlerFailure(input: { errorCode?: string | null; errorMessage?: string | null; fetchedCount?: number | null }): CrawlerFailureKind`
  - `shouldRetry(kind: CrawlerFailureKind): boolean`
  - `shouldFlagForReview(kind: CrawlerFailureKind): boolean`
  - `degradeThresholdFor(kind: CrawlerFailureKind): number`

  Task 11 的写回层消费。

- [ ] **Step 1: 写失败的测试**

创建 `frontend/src/server/crawler/failure-classifier.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import {
  classifyCrawlerFailure,
  degradeThresholdFor,
  shouldFlagForReview,
  shouldRetry,
} from "./failure-classifier";

describe("classifyCrawlerFailure", () => {
  it("classifies timeouts and connection errors as network failures", () => {
    expect(classifyCrawlerFailure({ errorCode: "Timeout" })).toBe("network");
    expect(classifyCrawlerFailure({ errorCode: "ConnectionError" })).toBe("network");
    expect(classifyCrawlerFailure({ errorCode: "HTTPError", errorMessage: "503 Service Unavailable" })).toBe(
      "network",
    );
  });

  it("classifies the crawler's empty-result error as empty", () => {
    expect(classifyCrawlerFailure({ errorCode: "EmptyCrawlerResultError" })).toBe("empty");
  });

  it("classifies a successful run that returned zero records as empty", () => {
    expect(classifyCrawlerFailure({ fetchedCount: 0 })).toBe("empty");
  });

  it("classifies HTML extraction errors as parse failures", () => {
    expect(classifyCrawlerFailure({ errorCode: "HtmlPageError" })).toBe("parse");
    expect(classifyCrawlerFailure({ errorCode: "StateBidNormalizationError" })).toBe("parse");
  });

  it("falls back to unknown", () => {
    expect(classifyCrawlerFailure({ errorCode: "SomethingElse" })).toBe("unknown");
    expect(classifyCrawlerFailure({})).toBe("unknown");
  });
});

describe("retry and review policy", () => {
  it("retries only network failures", () => {
    expect(shouldRetry("network")).toBe(true);
    expect(shouldRetry("parse")).toBe(false);
    expect(shouldRetry("empty")).toBe(false);
    expect(shouldRetry("unknown")).toBe(false);
  });

  it("flags parse failures for review immediately", () => {
    expect(shouldFlagForReview("parse")).toBe(true);
    expect(shouldFlagForReview("network")).toBe(false);
  });

  it("degrades silent-empty sources after three rounds and others after five", () => {
    expect(degradeThresholdFor("empty")).toBe(3);
    expect(degradeThresholdFor("network")).toBe(5);
    expect(degradeThresholdFor("unknown")).toBe(5);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd frontend && npx vitest run src/server/crawler/failure-classifier.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现**

创建 `frontend/src/server/crawler/failure-classifier.ts`：

```typescript
export type CrawlerFailureKind = "network" | "parse" | "empty" | "unknown";

export interface CrawlerFailureInput {
  errorCode?: string | null;
  errorMessage?: string | null;
  fetchedCount?: number | null;
}

/** Python 侧抛出的异常类名，见 crawler/apsi_crawler/。 */
const NETWORK_ERROR_CODES = new Set([
  "Timeout",
  "ConnectTimeout",
  "ReadTimeout",
  "ConnectionError",
  "SSLError",
  "TooManyRedirects",
]);

const PARSE_ERROR_CODES = new Set([
  "HtmlPageError",
  "StateBidNormalizationError",
  "BidNormalizationError",
  "JSONDecodeError",
  "KeyError",
]);

const EMPTY_ERROR_CODES = new Set(["EmptyCrawlerResultError"]);

function isServerSideHttpError(code: string | null | undefined, message: string | null | undefined) {
  if (code !== "HTTPError") return false;
  return /\b(5\d{2}|429)\b/.test(message ?? "");
}

export function classifyCrawlerFailure(input: CrawlerFailureInput): CrawlerFailureKind {
  const code = input.errorCode ?? null;

  if (code && EMPTY_ERROR_CODES.has(code)) return "empty";
  if (code && NETWORK_ERROR_CODES.has(code)) return "network";
  if (isServerSideHttpError(code, input.errorMessage)) return "network";
  if (code && PARSE_ERROR_CODES.has(code)) return "parse";
  if (!code && (input.fetchedCount ?? null) === 0) return "empty";

  return "unknown";
}

/** 解析失败是平台改版信号,重试无意义;空结果重试同样无意义。 */
export function shouldRetry(kind: CrawlerFailureKind): boolean {
  return kind === "network";
}

export function shouldFlagForReview(kind: CrawlerFailureKind): boolean {
  return kind === "parse";
}

/** 连续空结果比网络抖动更可疑——三轮就该有人看,网络类给到五次。 */
const EMPTY_DEGRADE_THRESHOLD = 3;
const DEFAULT_DEGRADE_THRESHOLD = 5;

export function degradeThresholdFor(kind: CrawlerFailureKind): number {
  return kind === "empty" ? EMPTY_DEGRADE_THRESHOLD : DEFAULT_DEGRADE_THRESHOLD;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd frontend && npx vitest run src/server/crawler/failure-classifier.test.ts
```

预期：PASS，8 个测试全绿。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/server/crawler/failure-classifier.ts frontend/src/server/crawler/failure-classifier.test.ts
git commit -m "feat(crawler): classify crawler failures into network, parse and empty"
```

---

## Task 6: Python TaskSource

**Files:**
- Create: `crawler/apsi_crawler/adapters/__init__.py`
- Create: `crawler/apsi_crawler/adapters/task.py`
- Test: `crawler/tests/test_adapter_task.py`

**Interfaces:**
- Produces: `TaskSource` dataclass 与 `task_source_from_payload(payload: dict) -> TaskSource`。字段覆盖现有 fetcher 与 normalizer 读取的全部属性：`id`、`name`、`source_label`、`jurisdiction`、`state_code`、`base_url`、`adapter_kind`、`maturity`、`capabilities`、`source_authority`、`trust_status`、`evidence_mode`、`validity_notes`。Task 7、8 消费。

- [ ] **Step 1: 写失败的测试**

创建 `crawler/tests/test_adapter_task.py`：

```python
import pytest

from apsi_crawler.adapters.task import TaskSource, task_source_from_payload
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


def test_builds_source_from_minimal_payload():
    source = task_source_from_payload(
        {
            "source_id": "ga_fulton_county",
            "label": "Fulton County",
            "state_code": "GA",
            "fetch_config": {"base_url": "https://fultoncountyga.bonfirehub.com"},
        }
    )

    assert source.id == "ga_fulton_county"
    assert source.source_label == "Fulton County"
    assert source.state_code == "GA"
    assert source.base_url == "https://fultoncountyga.bonfirehub.com"


def test_defaults_jurisdiction_and_validity_fields():
    source = task_source_from_payload(
        {"source_id": "x", "label": "X", "state_code": "CA", "fetch_config": {}}
    )

    assert source.jurisdiction == "state"
    assert source.adapter_kind == "platform"
    assert source.capabilities == ()
    assert source.trust_status == "beta"
    assert source.evidence_mode == "direct_portal"


def test_requires_source_id_and_label():
    with pytest.raises(ValueError):
        task_source_from_payload({"label": "X", "state_code": "CA", "fetch_config": {}})
    with pytest.raises(ValueError):
        task_source_from_payload({"source_id": "x", "state_code": "CA", "fetch_config": {}})


def test_is_accepted_by_the_existing_normalizer():
    source = TaskSource(
        id="ca_caleprocure",
        name="California Cal eProcure",
        source_label="California Cal eProcure",
        jurisdiction="state",
        state_code="CA",
        base_url="https://caleprocure.ca.gov",
    )

    normalized = normalize_state_opportunity(
        {"source_bid_id": "SB-1", "title": "Road Repair"}, source
    )

    assert normalized["id"] == "ca_caleprocure:SB-1"
    assert normalized["dedupe_key"] == "ca_caleprocure:SB-1"
    assert normalized["state_code"] == "CA"
    assert normalized["source"] == "California Cal eProcure"
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd crawler && PYTHONPATH=. pytest tests/test_adapter_task.py -v
```

预期：FAIL，`ModuleNotFoundError: apsi_crawler.adapters`。

- [ ] **Step 3: 实现**

创建 `crawler/apsi_crawler/adapters/__init__.py`（空文件）：

```python
```

创建 `crawler/apsi_crawler/adapters/task.py`：

```python
"""由任务 JSON 构造的 source 对象。

现有 41 个 spider 的签名统一为 fetch(source, query=, limit=, ...),且只读取
source 的 id / source_label / base_url / state_code 等属性。TaskSource 提供
同样的属性集,因此 spider 无需任何改动即可接受它。
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class TaskSource:
    id: str
    name: str
    source_label: str
    jurisdiction: str
    state_code: str
    base_url: str = ""
    adapter_kind: str = "platform"
    maturity: str = "beta"
    capabilities: tuple = ()
    source_authority: str = "official"
    trust_status: str = "beta"
    evidence_mode: str = "direct_portal"
    validity_notes: str = ""
    fetch_config: dict = field(default_factory=dict)


def task_source_from_payload(payload):
    source_id = (payload.get("source_id") or "").strip()
    if not source_id:
        raise ValueError("Task payload is missing source_id")

    label = (payload.get("label") or "").strip()
    if not label:
        raise ValueError(f"Task payload for {source_id} is missing label")

    fetch_config = payload.get("fetch_config") or {}
    if not isinstance(fetch_config, dict):
        raise ValueError(f"Task payload for {source_id} has a non-object fetch_config")

    return TaskSource(
        id=source_id,
        name=label,
        source_label=label,
        jurisdiction=payload.get("jurisdiction_level") or "state",
        state_code=(payload.get("state_code") or "").strip(),
        base_url=fetch_config.get("base_url") or payload.get("base_url") or "",
        capabilities=tuple(payload.get("capabilities") or ()),
        fetch_config=fetch_config,
    )
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd crawler && PYTHONPATH=. pytest tests/test_adapter_task.py -v
```

预期：PASS，4 个测试全绿。

- [ ] **Step 5: 提交**

```bash
git add crawler/apsi_crawler/adapters/__init__.py crawler/apsi_crawler/adapters/task.py crawler/tests/test_adapter_task.py
git commit -m "feat(crawler): add TaskSource built from task payload"
```

---

## Task 7: Python 适配器注册表与解析链

**Files:**
- Create: `crawler/apsi_crawler/adapters/registry.py`
- Test: `crawler/tests/test_adapter_registry.py`

**Interfaces:**
- Consumes: Task 6 的 `TaskSource`。
- Produces: `PLATFORM_ADAPTERS: dict`、`DEDICATED_ADAPTERS: dict`、`AdapterNotFoundError`、`resolve_adapter(source_id: str, provider_family: str | None)`。Task 8 消费。

- [ ] **Step 1: 写失败的测试**

创建 `crawler/tests/test_adapter_registry.py`：

```python
import pytest

from apsi_crawler.adapters import registry
from apsi_crawler.adapters.registry import AdapterNotFoundError, resolve_adapter


def test_dedicated_adapter_wins_over_platform_adapter(monkeypatch):
    def dedicated(source, **kwargs):
        return ["dedicated"]

    def platform(source, **kwargs):
        return ["platform"]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "ca_caleprocure", dedicated)
    monkeypatch.setitem(registry.PLATFORM_ADAPTERS, "bidnet", platform)

    assert resolve_adapter("ca_caleprocure", "bidnet") is dedicated


def test_falls_back_to_platform_adapter(monkeypatch):
    def platform(source, **kwargs):
        return ["platform"]

    monkeypatch.setitem(registry.PLATFORM_ADAPTERS, "bidnet", platform)

    assert resolve_adapter("al_state_procurement", "bidnet") is platform


def test_raises_when_neither_matches():
    with pytest.raises(AdapterNotFoundError) as excinfo:
        resolve_adapter("unknown_source", "unknown_platform")

    assert "unknown_source" in str(excinfo.value)
    assert "unknown_platform" in str(excinfo.value)


def test_raises_when_provider_family_is_absent_and_no_dedicated_adapter():
    with pytest.raises(AdapterNotFoundError):
        resolve_adapter("orphan_source", None)


def test_bidnet_platform_adapter_is_registered():
    assert "bidnet" in registry.PLATFORM_ADAPTERS


def test_verified_state_sources_have_dedicated_adapters():
    for source_id in ("ca_caleprocure", "tx_esbd", "ny_contract_reporter", "fl_mfmp", "il_bidbuy"):
        assert source_id in registry.DEDICATED_ADAPTERS
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd crawler && PYTHONPATH=. pytest tests/test_adapter_registry.py -v
```

预期：FAIL，`ModuleNotFoundError: apsi_crawler.adapters.registry`。

- [ ] **Step 3: 实现**

创建 `crawler/apsi_crawler/adapters/registry.py`：

```python
"""适配器注册表。

解析顺序:先查 source_id 的专用适配器,再按 provider_family 取平台适配器,
都未命中则显式抛错。绝不静默跳过——2000 源规模下静默跳过会让你无法
察觉哪些源没有在运行。
"""

from apsi_crawler.spiders.ca_caleprocure import fetch_ca_caleprocure_opportunities
from apsi_crawler.spiders.co_bidnet import fetch_bidnet_opportunities
from apsi_crawler.spiders.fl_mfmp import fetch_fl_mfmp_opportunities
from apsi_crawler.spiders.generic_state import fetch_generic_state_opportunities
from apsi_crawler.spiders.il_bidbuy import fetch_il_bidbuy_opportunities
from apsi_crawler.spiders.ny_contract_reporter import fetch_ny_contract_reporter_opportunities
from apsi_crawler.spiders.tx_esbd import fetch_tx_esbd_opportunities


class AdapterNotFoundError(Exception):
    pass


# 商业平台:一个适配器服务 N 个租户。阶段 3 在此追加 bonfire / ionwave 等。
PLATFORM_ADAPTERS = {
    "bidnet": fetch_bidnet_opportunities,
    "generic": fetch_generic_state_opportunities,
}

# 自建门户:一源一适配器,仅大型行政区值得。
DEDICATED_ADAPTERS = {
    "ca_caleprocure": fetch_ca_caleprocure_opportunities,
    "tx_esbd": fetch_tx_esbd_opportunities,
    "ny_contract_reporter": fetch_ny_contract_reporter_opportunities,
    "fl_mfmp": fetch_fl_mfmp_opportunities,
    "il_bidbuy": fetch_il_bidbuy_opportunities,
}


def resolve_adapter(source_id, provider_family):
    dedicated = DEDICATED_ADAPTERS.get(source_id)
    if dedicated is not None:
        return dedicated

    if provider_family:
        platform = PLATFORM_ADAPTERS.get(provider_family)
        if platform is not None:
            return platform

    raise AdapterNotFoundError(
        f"No adapter for source_id={source_id!r} provider_family={provider_family!r}"
    )
```

`co_bidnet.py` 确实导出 `fetch_bidnet_opportunities`（已验证，定义在该文件第 49 行；`fetch_co_bidnet_opportunities` 是它的科罗拉多专用包装）。平台适配器取通用的那个，不要取 `fetch_co_bidnet_opportunities`。

- [ ] **Step 4: 运行测试确认通过**

```bash
cd crawler && PYTHONPATH=. pytest tests/test_adapter_registry.py -v
```

预期：PASS，6 个测试全绿。

- [ ] **Step 5: 提交**

```bash
git add crawler/apsi_crawler/adapters/registry.py crawler/tests/test_adapter_registry.py
git commit -m "feat(crawler): add platform-first adapter registry with explicit resolution failure"
```

---

## Task 8: Python `fetch-task` 子命令

**Files:**
- Modify: `crawler/apsi_crawler/cli.py`
- Test: `crawler/tests/test_fetch_task_cli.py`

**Interfaces:**
- Consumes: Task 6 的 `task_source_from_payload`、Task 7 的 `resolve_adapter`。
- Produces: CLI 子命令 `fetch-task`（从 stdin 读 JSON，向 stdout 输出结果 JSON）。Task 9 的 Node 侧消费其输出格式。

任务契约（输入）与结果契约（输出）：

```json
{ "task_id": "tsk_1", "source_id": "ca_caleprocure", "label": "California Cal eProcure",
  "state_code": "CA", "provider_family": null, "jurisdiction_level": "state",
  "fetch_config": { "base_url": "https://caleprocure.ca.gov" }, "limit": 25, "query": null }
```

```json
{ "taskId": "tsk_1", "source": "ca_caleprocure", "runId": "...", "status": "success",
  "startedAt": "...", "finishedAt": "...", "durationMs": 12, "metadata": {},
  "bids": [], "errorCode": null, "errorMessage": null, "errorStack": null }
```

**注意大小写不对称，这是有意的：** 输入契约用 snake_case（新定义，与 Python 侧惯例一致），输出结果用 camelCase（必须沿用现有 `_json_run_payload` 的键名，因为 `mysql-json-importer.ts` 的 `CrawlerJsonRunPayload` 已经按 camelCase 消费）。写测试断言时不要把两者搞混。

- [ ] **Step 1: 写失败的测试**

创建 `crawler/tests/test_fetch_task_cli.py`：

```python
import io
import json

from apsi_crawler import cli
from apsi_crawler.adapters import registry


def _run(payload, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    exit_code = cli.main(["fetch-task"])
    return exit_code, json.loads(capsys.readouterr().out)


def test_emits_success_payload_with_bids(monkeypatch, capsys):
    def adapter(source, query=None, limit=25, **kwargs):
        return [{"id": f"{source.id}:1", "title": "Road Repair", "source": source.source_label}]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "test_source", adapter)

    exit_code, result = _run(
        {
            "task_id": "tsk_1",
            "source_id": "test_source",
            "label": "Test Source",
            "state_code": "CA",
            "fetch_config": {"base_url": "https://example.gov"},
            "limit": 5,
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 0
    assert result["status"] == "success"
    assert result["taskId"] == "tsk_1"
    assert result["source"] == "test_source"
    assert len(result["bids"]) == 1


def test_empty_result_is_a_failure_not_a_success(monkeypatch, capsys):
    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "empty_source", lambda source, **kwargs: [])

    exit_code, result = _run(
        {
            "task_id": "tsk_2",
            "source_id": "empty_source",
            "label": "Empty Source",
            "state_code": "CA",
            "fetch_config": {},
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 1
    assert result["status"] == "failure"
    assert result["errorCode"] == "EmptyCrawlerResultError"


def test_missing_adapter_reports_adapter_not_found(monkeypatch, capsys):
    exit_code, result = _run(
        {
            "task_id": "tsk_3",
            "source_id": "no_such_source",
            "label": "No Such",
            "state_code": "CA",
            "provider_family": "no_such_platform",
            "fetch_config": {},
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 1
    assert result["status"] == "failure"
    assert result["errorCode"] == "AdapterNotFoundError"


def test_adapter_exception_is_reported_with_its_class_name(monkeypatch, capsys):
    def boom(source, **kwargs):
        raise TimeoutError("read timed out")

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "slow_source", boom)

    exit_code, result = _run(
        {
            "task_id": "tsk_4",
            "source_id": "slow_source",
            "label": "Slow",
            "state_code": "CA",
            "fetch_config": {},
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 1
    assert result["errorCode"] == "TimeoutError"
    assert "read timed out" in result["errorMessage"]
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd crawler && PYTHONPATH=. pytest tests/test_fetch_task_cli.py -v
```

预期：FAIL，`fetch-task` 不是合法子命令。

- [ ] **Step 3: 实现**

在 `crawler/apsi_crawler/cli.py` 顶部 import 区加入：

```python
import sys

from apsi_crawler.adapters.registry import AdapterNotFoundError, resolve_adapter
from apsi_crawler.adapters.task import task_source_from_payload
```

在 `fetch_state` 函数之后加入新函数：

```python
def fetch_task(payload):
    """执行单个抓取任务。输入为任务 JSON,输出结果 JSON 到 stdout。

    与 fetch_state 的区别:源信息全部来自 payload,不查硬编码 registry;
    不做 fixture 回退——空结果就是失败,这样 last_success_at 才是真信号。
    """
    started_at = now_iso()
    started = perf_counter()
    run_id = str(uuid4())
    task_id = payload.get("task_id")
    source_id = payload.get("source_id")
    limit = int(payload.get("limit") or 25)
    query = payload.get("query")
    metadata = {"mode": "live", "query": query, "limit": limit, "task_id": task_id}

    try:
        source = task_source_from_payload(payload)
        adapter = resolve_adapter(source.id, payload.get("provider_family"))
        metadata["adapter"] = getattr(adapter, "__name__", "unknown")

        bids = adapter(source, query=query, limit=limit)
        _require_non_empty_bids(bids, source.id)

        finished_at = now_iso()
        duration_ms = int((perf_counter() - started) * 1000)
        result = _json_run_payload(
            source=source.id,
            run_id=run_id,
            status="success",
            started_at=started_at,
            finished_at=finished_at,
            duration_ms=duration_ms,
            metadata=metadata,
            bids=bids,
        )
        result["taskId"] = task_id
        _print_json_payload(result)
        return 0
    except Exception as error:
        finished_at = now_iso()
        duration_ms = int((perf_counter() - started) * 1000)
        result = _json_run_payload(
            source=source_id,
            run_id=run_id,
            status="failure",
            started_at=started_at,
            finished_at=finished_at,
            duration_ms=duration_ms,
            metadata=metadata,
            bids=[],
            error_code=type(error).__name__,
            error_message=str(error),
            error_stack=traceback.format_exc(),
        )
        result["taskId"] = task_id
        _print_json_payload(result)
        return 1
```

在 `build_parser()` 中，`validate_state_live_parser` 之前加入：

```python
    subparsers.add_parser("fetch-task")
```

在 `main()` 中，`if args.command == "validate-state-live":` 之前加入：

```python
    if args.command == "fetch-task":
        return fetch_task(json.load(sys.stdin))
```

`_json_run_payload` 已经接受 `error_code` / `error_message` / `error_stack` 三个关键字参数（已验证，`cli.py` 第 137 行起），并把它们输出为 `errorCode` / `errorMessage` / `errorStack`。无需改动该函数。

- [ ] **Step 4: 运行测试确认通过**

```bash
cd crawler && PYTHONPATH=. pytest tests/test_fetch_task_cli.py -v
```

预期：PASS，4 个测试全绿。再跑全量确认无回归：

```bash
cd crawler && PYTHONPATH=. pytest -q
```

- [ ] **Step 5: 提交**

```bash
git add crawler/apsi_crawler/cli.py crawler/tests/test_fetch_task_cli.py
git commit -m "feat(crawler): add fetch-task subcommand driven by a JSON task contract"
```

---

## Task 9: Node 侧改用 JSON 契约调用

**Files:**
- Modify: `frontend/src/server/crawler/state-runner.ts`
- Test: `frontend/src/server/crawler/state-runner.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `CrawlableSource`、Task 8 的 `fetch-task` 契约。
- Produces:
  - `interface CrawlTaskPayload { task_id: string; source_id: string; label: string; state_code: string; provider_family: string | null; jurisdiction_level: string | null; fetch_config: Record<string, unknown>; limit: number; query: string | null }`
  - `buildCrawlTaskPayload(source: CrawlableSource, options: { taskId: string; limit?: number; query?: string | null }): CrawlTaskPayload`
  - `runCrawlTask(source: CrawlableSource, options): Promise<StateCrawlerRunResult & { fetchedCount: number; errorCode: string | null }>`

  Task 10 消费 `runCrawlTask`。

- [ ] **Step 1: 写失败的测试**

在 `frontend/src/server/crawler/state-runner.test.ts` 追加：

```typescript
import { describe, expect, it } from "vitest";
import { buildCrawlTaskPayload } from "./state-runner";
import type { CrawlableSource } from "./source-registry";

function source(overrides: Partial<CrawlableSource> = {}): CrawlableSource {
  return {
    id: "ca_caleprocure",
    label: "California Cal eProcure",
    issuerType: "state",
    stateCode: "CA",
    baseUrl: "https://caleprocure.ca.gov",
    cadence: "daily",
    providerFamily: null,
    jurisdictionLevel: "state",
    jurisdictionName: "California",
    fipsCode: "06",
    fetchConfig: { base_url: "https://caleprocure.ca.gov" },
    lastSuccessAt: null,
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe("buildCrawlTaskPayload", () => {
  it("carries source identity and fetch config into the contract", () => {
    const payload = buildCrawlTaskPayload(source(), { taskId: "tsk_1" });
    expect(payload).toEqual({
      task_id: "tsk_1",
      source_id: "ca_caleprocure",
      label: "California Cal eProcure",
      state_code: "CA",
      provider_family: null,
      jurisdiction_level: "state",
      fetch_config: { base_url: "https://caleprocure.ca.gov" },
      limit: 25,
      query: null,
    });
  });

  it("defaults fetch_config.base_url from the source base URL when absent", () => {
    const payload = buildCrawlTaskPayload(source({ fetchConfig: {} }), { taskId: "tsk_2" });
    expect(payload.fetch_config).toEqual({ base_url: "https://caleprocure.ca.gov" });
  });

  it("honours explicit limit and query", () => {
    const payload = buildCrawlTaskPayload(source(), { taskId: "tsk_3", limit: 5, query: "road" });
    expect(payload.limit).toBe(5);
    expect(payload.query).toBe("road");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd frontend && npx vitest run src/server/crawler/state-runner.test.ts
```

预期：FAIL，`buildCrawlTaskPayload` 未导出。

- [ ] **Step 3: 实现**

在 `frontend/src/server/crawler/state-runner.ts` 中新增（保留现有 `runStateCrawler` 不动，Task 10 完成后再删）：

```typescript
import type { CrawlableSource } from "./source-registry";

export interface CrawlTaskPayload {
  task_id: string;
  source_id: string;
  label: string;
  state_code: string;
  provider_family: string | null;
  jurisdiction_level: string | null;
  fetch_config: Record<string, unknown>;
  limit: number;
  query: string | null;
}

export interface CrawlTaskOptions {
  taskId: string;
  limit?: number;
  query?: string | null;
}

export function buildCrawlTaskPayload(
  source: CrawlableSource,
  options: CrawlTaskOptions,
): CrawlTaskPayload {
  const fetchConfig = { ...source.fetchConfig };
  if (!fetchConfig.base_url && source.baseUrl) {
    fetchConfig.base_url = source.baseUrl;
  }

  return {
    task_id: options.taskId,
    source_id: source.id,
    label: source.label,
    state_code: source.stateCode,
    provider_family: source.providerFamily,
    jurisdiction_level: source.jurisdictionLevel,
    fetch_config: fetchConfig,
    limit: options.limit ?? 25,
    query: options.query ?? null,
  };
}

export interface CrawlTaskResult {
  ok: boolean;
  source: string;
  status: "success" | "failure";
  stdout: string;
  stderr: string;
  fetchedCount: number;
  errorCode: string | null;
}

export async function runCrawlTask(
  source: CrawlableSource,
  options: CrawlTaskOptions,
): Promise<CrawlTaskResult> {
  const payload = buildCrawlTaskPayload(source, options);

  return new Promise((resolve) => {
    const child = execFile(
      "python3",
      ["-m", "apsi_crawler.cli", "fetch-task"],
      { cwd: crawlerDirectory(), env: process.env },
      (error, stdout, stderr) => {
        // Python 侧 _json_run_payload 输出 camelCase 键,不是 snake_case。
        let parsed: { status?: string; bids?: unknown[]; errorCode?: string | null } = {};
        try {
          parsed = JSON.parse(String(stdout ?? ""));
        } catch {
          parsed = {};
        }

        const ok = !error && parsed.status === "success";
        resolve({
          ok,
          source: source.id,
          status: ok ? "success" : "failure",
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          fetchedCount: Array.isArray(parsed.bids) ? parsed.bids.length : 0,
          errorCode: parsed.errorCode ?? null,
        });
      },
    );

    child.stdin?.end(JSON.stringify(payload));
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd frontend && npx vitest run src/server/crawler/state-runner.test.ts
```

预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/server/crawler/state-runner.ts frontend/src/server/crawler/state-runner.test.ts
git commit -m "feat(crawler): call the Python crawler through a JSON task contract"
```

---

## Task 10: 跨语言契约测试

**Files:**
- Create: `frontend/src/server/crawler/contract-fixture.test.ts`
- Create: `crawler/tests/fixtures/contracts/fetch_task_v1.json`
- Create: `crawler/tests/test_contract_compatibility.py`

**Interfaces:**
- Consumes: Task 9 的 `buildCrawlTaskPayload`、Task 6 的 `task_source_from_payload`。
- Produces: 共享契约样本文件。两侧测试读写同一份文件，任一侧改字段而另一侧未跟进即失败。

- [ ] **Step 1: 写失败的测试**

创建 `frontend/src/server/crawler/contract-fixture.test.ts`：

```typescript
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCrawlTaskPayload } from "./state-runner";
import type { CrawlableSource } from "./source-registry";

const CONTRACT_PATH = path.resolve(
  process.cwd(),
  "..",
  "crawler",
  "tests",
  "fixtures",
  "contracts",
  "fetch_task_v1.json",
);

const SOURCE: CrawlableSource = {
  id: "ca_caleprocure",
  label: "California Cal eProcure",
  issuerType: "state",
  stateCode: "CA",
  baseUrl: "https://caleprocure.ca.gov",
  cadence: "daily",
  providerFamily: null,
  jurisdictionLevel: "state",
  jurisdictionName: "California",
  fipsCode: "06",
  fetchConfig: { base_url: "https://caleprocure.ca.gov" },
  lastSuccessAt: null,
  consecutiveFailures: 0,
};

describe("fetch-task contract fixture", () => {
  it("matches the sample the Python side consumes", () => {
    const payload = buildCrawlTaskPayload(SOURCE, { taskId: "tsk_contract_1" });
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;

    if (process.env.UPDATE_CONTRACT_FIXTURE === "1") {
      mkdirSync(path.dirname(CONTRACT_PATH), { recursive: true });
      writeFileSync(CONTRACT_PATH, serialized, "utf8");
    }

    expect(readFileSync(CONTRACT_PATH, "utf8")).toBe(serialized);
  });
});
```

创建 `crawler/tests/test_contract_compatibility.py`：

```python
import json
from pathlib import Path

from apsi_crawler.adapters.task import task_source_from_payload

CONTRACT_PATH = Path(__file__).parent / "fixtures" / "contracts" / "fetch_task_v1.json"


def test_python_can_consume_the_node_generated_contract():
    payload = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    source = task_source_from_payload(payload)

    assert source.id == payload["source_id"]
    assert source.source_label == payload["label"]
    assert source.state_code == payload["state_code"]
    assert source.base_url == payload["fetch_config"]["base_url"]


def test_contract_carries_every_field_the_worker_needs():
    payload = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    for key in (
        "task_id",
        "source_id",
        "label",
        "state_code",
        "provider_family",
        "jurisdiction_level",
        "fetch_config",
        "limit",
        "query",
    ):
        assert key in payload, f"contract fixture is missing {key}"
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd frontend && npx vitest run src/server/crawler/contract-fixture.test.ts
```

预期：FAIL，fixture 文件不存在。

- [ ] **Step 3: 生成 fixture**

```bash
cd frontend && UPDATE_CONTRACT_FIXTURE=1 npx vitest run src/server/crawler/contract-fixture.test.ts
```

该命令会写出 `crawler/tests/fixtures/contracts/fetch_task_v1.json`。检查其内容应为：

```json
{
  "task_id": "tsk_contract_1",
  "source_id": "ca_caleprocure",
  "label": "California Cal eProcure",
  "state_code": "CA",
  "provider_family": null,
  "jurisdiction_level": "state",
  "fetch_config": {
    "base_url": "https://caleprocure.ca.gov"
  },
  "limit": 25,
  "query": null
}
```

- [ ] **Step 4: 两侧测试都通过**

```bash
cd frontend && npx vitest run src/server/crawler/contract-fixture.test.ts
cd ../crawler && PYTHONPATH=. pytest tests/test_contract_compatibility.py -v
```

预期：两侧均 PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/server/crawler/contract-fixture.test.ts crawler/tests/fixtures/contracts/fetch_task_v1.json crawler/tests/test_contract_compatibility.py
git commit -m "test(crawler): pin the Node-Python fetch-task contract with a shared fixture"
```

---

## Task 11: 源健康写回层

**Files:**
- Create: `frontend/src/server/crawler/source-health-repository.ts`
- Test: `frontend/src/server/crawler/source-health-repository.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `CrawlerFailureKind` / `shouldFlagForReview`。
- Produces:
  - `recordSourceSuccess(db: AppDatabase, sourceId: string, at: string): void`
  - `recordSourceSuccessInMysql(pool: MysqlHealthStore, sourceId: string, at: string): Promise<void>`
  - `recordSourceFailure(db: AppDatabase, input: SourceFailureInput): void`
  - `recordSourceFailureInMysql(pool: MysqlHealthStore, input: SourceFailureInput): Promise<void>`
  - `interface SourceFailureInput { sourceId: string; at: string; kind: CrawlerFailureKind }`
  - `interface MysqlHealthStore { execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]> }`

  Task 12 消费。

- [ ] **Step 1: 写失败的测试**

创建 `frontend/src/server/crawler/source-health-repository.test.ts`：

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { recordSourceFailure, recordSourceSuccess } from "./source-health-repository";

const NOW = "2026-07-29T00:00:00.000Z";
const LATER = "2026-07-30T00:00:00.000Z";

describe("source health repository", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db
      .insert(dataSources)
      .values({
        id: "src",
        label: "Source",
        issuerType: "state",
        stateCode: "CA",
        isEnabled: 1,
        cadence: "daily",
        consecutiveFailures: 3,
        approvalStatus: "approved",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  function read() {
    return testDb.db.select().from(dataSources).where(eq(dataSources.id, "src")).get();
  }

  it("resets the failure counter on success", () => {
    recordSourceSuccess(testDb.db, "src", LATER);
    const row = read();
    expect(row?.lastSuccessAt).toBe(LATER);
    expect(row?.consecutiveFailures).toBe(0);
  });

  it("increments the failure counter on failure", () => {
    recordSourceFailure(testDb.db, { sourceId: "src", at: LATER, kind: "network" });
    const row = read();
    expect(row?.lastFailureAt).toBe(LATER);
    expect(row?.consecutiveFailures).toBe(4);
    expect(row?.approvalStatus).toBe("approved");
  });

  it("degrades the source to needs_review once the threshold is crossed", () => {
    recordSourceFailure(testDb.db, { sourceId: "src", at: LATER, kind: "network" });
    recordSourceFailure(testDb.db, { sourceId: "src", at: LATER, kind: "network" });
    const row = read();
    expect(row?.consecutiveFailures).toBe(5);
    expect(row?.approvalStatus).toBe("needs_review");
  });

  it("degrades immediately on a parse failure regardless of the counter", () => {
    recordSourceFailure(testDb.db, { sourceId: "src", at: LATER, kind: "parse" });
    expect(read()?.approvalStatus).toBe("needs_review");
  });

  it("degrades silent-empty sources at the lower three-round threshold", () => {
    // 起始计数为 3,一次空结果即达到 empty 的阈值。
    recordSourceFailure(testDb.db, { sourceId: "src", at: LATER, kind: "empty" });
    const row = read();
    expect(row?.consecutiveFailures).toBe(4);
    expect(row?.approvalStatus).toBe("needs_review");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd frontend && npx vitest run src/server/crawler/source-health-repository.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现**

创建 `frontend/src/server/crawler/source-health-repository.ts`：

```typescript
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute } from "@/server/db/mysql-runtime";
import { dataSources } from "@/server/db/schema";
import { degradeThresholdFor, shouldFlagForReview, type CrawlerFailureKind } from "./failure-classifier";

export interface SourceFailureInput {
  sourceId: string;
  at: string;
  kind: CrawlerFailureKind;
}

export interface MysqlHealthStore {
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

export function recordSourceSuccess(db: AppDatabase, sourceId: string, at: string): void {
  db.update(dataSources)
    .set({ lastSuccessAt: at, consecutiveFailures: 0, updatedAt: at })
    .where(eq(dataSources.id, sourceId))
    .run();
}

export async function recordSourceSuccessInMysql(
  pool: MysqlHealthStore,
  sourceId: string,
  at: string,
): Promise<void> {
  await mysqlExecute(
    pool,
    `UPDATE data_sources
     SET last_success_at = ?, consecutive_failures = 0, updated_at = ?
     WHERE id = ?`,
    [at, at, sourceId] as never[],
  );
}

export function recordSourceFailure(db: AppDatabase, input: SourceFailureInput): void {
  const current = db
    .select({ consecutiveFailures: dataSources.consecutiveFailures })
    .from(dataSources)
    .where(eq(dataSources.id, input.sourceId))
    .get();

  const failures = (current?.consecutiveFailures ?? 0) + 1;
  const degrade = shouldFlagForReview(input.kind) || failures >= degradeThresholdFor(input.kind);

  db.update(dataSources)
    .set({
      lastFailureAt: input.at,
      consecutiveFailures: failures,
      updatedAt: input.at,
      ...(degrade ? { approvalStatus: "needs_review" } : {}),
    })
    .where(eq(dataSources.id, input.sourceId))
    .run();
}

export async function recordSourceFailureInMysql(
  pool: MysqlHealthStore,
  input: SourceFailureInput,
): Promise<void> {
  // 解析失败立即降级;否则达到该失败类型的阈值才降级。
  // 用 CASE 表达式一条语句完成,避免读改写竞态。
  const forceDegrade = shouldFlagForReview(input.kind) ? 1 : 0;

  await mysqlExecute(
    pool,
    `UPDATE data_sources
     SET last_failure_at = ?,
         consecutive_failures = consecutive_failures + 1,
         approval_status = CASE
           WHEN ? = 1 THEN 'needs_review'
           WHEN consecutive_failures + 1 >= ? THEN 'needs_review'
           ELSE approval_status
         END,
         updated_at = ?
     WHERE id = ?`,
    [input.at, forceDegrade, degradeThresholdFor(input.kind), input.at, input.sourceId] as never[],
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd frontend && npx vitest run src/server/crawler/source-health-repository.test.ts
```

预期：PASS，5 个测试全绿。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/server/crawler/source-health-repository.ts frontend/src/server/crawler/source-health-repository.test.ts
git commit -m "feat(crawler): persist source health and degrade failing sources to needs_review"
```

---

## Task 12: configured-runner 接入查表与调度

**Files:**
- Modify: `frontend/src/server/crawler/configured-runner.ts`
- Test: `frontend/src/server/crawler/configured-runner.test.ts`

**Interfaces:**
- Consumes: Task 3 `listCrawlableSources`、Task 4 `selectDueSources`、Task 9 `runCrawlTask`、Task 11 写回层。
- Produces: `runConfiguredCrawlerSourcesOnce` 改为查表驱动；`CONFIGURED_CRAWLER_SOURCES` 常量删除。

- [ ] **Step 1: 写失败的测试**

在 `frontend/src/server/crawler/configured-runner.test.ts` 追加：

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { runConfiguredCrawlerSourcesOnce } from "./configured-runner";

const NOW = "2026-07-29T12:00:00.000Z";

describe("runConfiguredCrawlerSourcesOnce reads sources from the database", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  function insertSource(id: string, overrides: Record<string, unknown> = {}) {
    testDb.db
      .insert(dataSources)
      .values({
        id,
        label: id,
        issuerType: "state",
        stateCode: "CA",
        baseUrl: "https://example.gov",
        isEnabled: 1,
        cadence: "daily",
        approvedForIngestion: 1,
        approvalStatus: "approved",
        legalReviewStatus: "approved_public",
        jurisdictionLevel: "state",
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
      })
      .run();
  }

  it("runs only sources that are due", async () => {
    insertSource("due_source", { lastSuccessAt: null });
    insertSource("not_due_source", { lastSuccessAt: NOW });

    const attempted: string[] = [];
    const results = await runConfiguredCrawlerSourcesOnce({
      database: testDb.db,
      owner: "test",
      now: new Date(NOW),
      matcher: async () => ({ matched: 0, matches: [] }) as never,
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
      runCrawlerSourceOnce: (async (_db, options) => {
        attempted.push(options.source);
        return { ok: true, source: options.source, status: "success" };
      }) as never,
    });

    expect(attempted).toEqual(["due_source"]);
    expect(results).toHaveLength(1);
  });

  it("skips sources that governance has not approved", async () => {
    insertSource("blocked_source", { approvalStatus: "needs_review", lastSuccessAt: null });

    const attempted: string[] = [];
    await runConfiguredCrawlerSourcesOnce({
      database: testDb.db,
      owner: "test",
      now: new Date(NOW),
      matcher: async () => ({ matched: 0, matches: [] }) as never,
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
      runCrawlerSourceOnce: (async (_db, options) => {
        attempted.push(options.source);
        return { ok: true, source: options.source, status: "success" };
      }) as never,
    });

    expect(attempted).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd frontend && npx vitest run src/server/crawler/configured-runner.test.ts
```

预期：FAIL，`now` 选项不被接受 / 仍在跑常量清单。

- [ ] **Step 3: 实现**

改写 `frontend/src/server/crawler/configured-runner.ts`：删除 `CONFIGURED_CRAWLER_SOURCES` 常量与 `STATE_CRAWLER_SOURCES` import，改为：

```typescript
import { listCrawlableSources, listCrawlableSourcesFromMysql, type CrawlableSource } from "./source-registry";
import { selectDueSources } from "./scheduler";
import { runCrawlTask } from "./state-runner";
import { runSamGovCrawler } from "./sam-gov-runner";

export interface RunConfiguredCrawlerSourcesOnceOptions {
  database: AppDatabase;
  mysql?: MysqlCrawlerLockStore;
  owner: string;
  now?: Date;
  matcher?: CrawlerMatcher;
  notifier?: CrawlerNotifier;
  stateRunnerOptions?: { limit?: number; query?: string | null };
  runCrawlerSourceOnce?: ConfiguredRunner;
}

export async function runConfiguredCrawlerSourcesOnce(
  options: RunConfiguredCrawlerSourcesOnceOptions,
) {
  const now = options.now ?? new Date();
  const matcher = options.matcher ?? (
    options.mysql
      ? (() => matchEnabledSearchAlertsFromMysql(options.mysql!))
      : (() => matchEnabledSearchAlerts(options.database))
  );
  const notifier =
    options.notifier ?? (
      options.mysql
        ? (({ alertMatching }) => sendMatchedAlertNotificationsFromMysql(options.mysql!, alertMatching))
        : (({ alertMatching }) => sendMatchedAlertNotifications(options.database, alertMatching))
    );
  const runCrawlerSourceOnce = options.runCrawlerSourceOnce ?? defaultRunCrawlerSourceOnce;

  // MysqlCrawlerLockStore 同时声明了 query 与 execute,结构上是 MysqlSourceStore
  // 的超集,可直接传入——不要加 `as never` 之类的类型逃逸。
  const allSources: CrawlableSource[] = options.mysql
    ? await listCrawlableSourcesFromMysql(options.mysql)
    : listCrawlableSources(options.database);

  const dueSources = selectDueSources(allSources, now);
  const results: RunCrawlerSourceOnceResult[] = [];

  for (const source of dueSources) {
    const isSamGov = source.id === "sam_gov" || source.issuerType === "federal";

    results.push(
      await runCrawlerSourceOnce(options.database, {
        mysql: options.mysql,
        source: source.id,
        owner: options.owner,
        runner: isSamGov
          ? runSamGovCrawler
          : () =>
              runCrawlTask(source, {
                taskId: `tsk_${source.id}_${now.getTime()}`,
                limit: options.stateRunnerOptions?.limit,
                query: options.stateRunnerOptions?.query ?? null,
              }),
        matcher,
        notifier,
      }),
    );
  }

  return results;
}
```

`parseStateCrawlerLimit` 保持不变，继续由 `run-crawler-once.ts` 与 `crawler-worker.ts` 使用。

- [ ] **Step 4: 运行测试确认通过**

```bash
cd frontend && npx vitest run src/server/crawler/configured-runner.test.ts
```

预期：PASS。再跑爬虫域全量：

```bash
cd frontend && npx vitest run src/server/crawler/
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/server/crawler/configured-runner.ts frontend/src/server/crawler/configured-runner.test.ts
git commit -m "feat(crawler): drive crawl runs from data_sources and cadence scheduling"
```

---

## Task 13: 50 州迁移脚本

**Files:**
- Create: `frontend/scripts/migrate-source-registry.ts`
- Test: `frontend/scripts/migrate-source-registry.test.ts`
- Modify: `frontend/package.json`（新增 npm script）

**Interfaces:**
- Consumes: Task 2 的 `fipsForStateCode`、`STATE_CRAWLER_SOURCE_DEFINITIONS`（尚未删除）。
- Produces: `buildSourceRegistryRows(): SourceRegistryRow[]`、`upsertSourceRegistry(db: AppDatabase, rows: SourceRegistryRow[], now: string): void`。

- [ ] **Step 1: 写失败的测试**

创建 `frontend/scripts/migrate-source-registry.test.ts`：

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../src/server/db/test-utils";
import { dataSources } from "../src/server/db/schema";
import { buildSourceRegistryRows, upsertSourceRegistry } from "./migrate-source-registry";

const NOW = "2026-07-29T00:00:00.000Z";

describe("buildSourceRegistryRows", () => {
  it("produces one row per state source with a FIPS code", () => {
    const rows = buildSourceRegistryRows();
    expect(rows).toHaveLength(50);
    for (const row of rows) {
      expect(row.jurisdictionLevel).toBe("state");
      expect(row.fipsCode).toMatch(/^\d{2}$/);
      expect(JSON.parse(row.fetchConfig).base_url).toBeTruthy();
    }
  });

  it("maps California to FIPS 06", () => {
    const california = buildSourceRegistryRows().find((row) => row.id === "ca_caleprocure");
    expect(california?.fipsCode).toBe("06");
  });
});

describe("upsertSourceRegistry", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("inserts rows on first run", () => {
    upsertSourceRegistry(testDb.db, buildSourceRegistryRows(), NOW);
    const rows = testDb.db.select().from(dataSources).all();
    expect(rows).toHaveLength(50);
  });

  it("is idempotent across repeated runs", () => {
    const rows = buildSourceRegistryRows();
    upsertSourceRegistry(testDb.db, rows, NOW);
    upsertSourceRegistry(testDb.db, rows, NOW);
    expect(testDb.db.select().from(dataSources).all()).toHaveLength(50);
  });

  it("never overwrites human governance sign-off", () => {
    const rows = buildSourceRegistryRows();
    upsertSourceRegistry(testDb.db, rows, NOW);

    testDb.db
      .update(dataSources)
      .set({ approvalStatus: "approved", legalReviewStatus: "approved_public", complianceReviewer: "legal@apsi" })
      .where(eq(dataSources.id, "ca_caleprocure"))
      .run();

    upsertSourceRegistry(testDb.db, rows, "2026-08-01T00:00:00.000Z");

    const row = testDb.db.select().from(dataSources).where(eq(dataSources.id, "ca_caleprocure")).get();
    expect(row?.approvalStatus).toBe("approved");
    expect(row?.legalReviewStatus).toBe("approved_public");
    expect(row?.complianceReviewer).toBe("legal@apsi");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd frontend && npx vitest run scripts/migrate-source-registry.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现**

创建 `frontend/scripts/migrate-source-registry.ts`：

```typescript
import { createDatabase, type AppDatabase } from "../src/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "../src/server/db/mysql";
import { mysqlExecute } from "../src/server/db/mysql-runtime";
import { runMigrations } from "../src/server/db/migrate";
import { dataSources } from "../src/server/db/schema";
import { fipsForStateCode } from "../src/lib/state-fips";
import { STATE_CRAWLER_SOURCE_DEFINITIONS } from "../src/lib/state-crawler-sources";

export interface SourceRegistryRow {
  id: string;
  label: string;
  issuerType: string;
  stateCode: string;
  baseUrl: string;
  jurisdictionLevel: string;
  jurisdictionName: string;
  fipsCode: string;
  fetchConfig: string;
  providerFamily: string | null;
}

/** BidNet Direct 托管的州源,provider_family 归入 bidnet 共享适配器。 */
const BIDNET_HOSTED = /bidnetdirect\.com/i;

/** 有专用适配器的源不设 provider_family——解析链会优先命中 DEDICATED_ADAPTERS。 */
const DEDICATED_SOURCE_IDS = new Set([
  "ca_caleprocure",
  "tx_esbd",
  "ny_contract_reporter",
  "fl_mfmp",
  "il_bidbuy",
]);

function providerFamilyFor(id: string, baseUrl: string): string | null {
  if (DEDICATED_SOURCE_IDS.has(id)) return null;
  if (BIDNET_HOSTED.test(baseUrl)) return "bidnet";
  return "generic";
}

export function buildSourceRegistryRows(): SourceRegistryRow[] {
  return STATE_CRAWLER_SOURCE_DEFINITIONS.map((source) => {
    const fips = fipsForStateCode(source.stateCode);
    if (!fips) {
      throw new Error(`No FIPS code for state ${source.stateCode} (source ${source.id})`);
    }

    return {
      id: source.id,
      label: source.label,
      issuerType: "state",
      stateCode: source.stateCode,
      baseUrl: source.baseUrl,
      jurisdictionLevel: "state",
      jurisdictionName: source.label,
      fipsCode: fips,
      fetchConfig: JSON.stringify({ base_url: source.baseUrl }),
      providerFamily: providerFamilyFor(source.id, source.baseUrl),
    };
  });
}

/**
 * upsert 而非 insert:表中已有 seed 写入的行。
 * 只更新机器可推导的字段;approval_status / legal_review_status / compliance_* 由人工签核,绝不覆盖。
 */
export function upsertSourceRegistry(db: AppDatabase, rows: SourceRegistryRow[], now: string): void {
  for (const row of rows) {
    db.insert(dataSources)
      .values({
        id: row.id,
        label: row.label,
        issuerType: row.issuerType,
        stateCode: row.stateCode,
        baseUrl: row.baseUrl,
        jurisdictionLevel: row.jurisdictionLevel,
        jurisdictionName: row.jurisdictionName,
        fipsCode: row.fipsCode,
        fetchConfig: row.fetchConfig,
        providerFamily: row.providerFamily,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: dataSources.id,
        set: {
          label: row.label,
          issuerType: row.issuerType,
          stateCode: row.stateCode,
          baseUrl: row.baseUrl,
          jurisdictionLevel: row.jurisdictionLevel,
          jurisdictionName: row.jurisdictionName,
          fipsCode: row.fipsCode,
          fetchConfig: row.fetchConfig,
          providerFamily: row.providerFamily,
          updatedAt: now,
        },
      })
      .run();
  }
}

export async function upsertSourceRegistryInMysql(
  pool: ReturnType<typeof resolveMysqlPool>,
  rows: SourceRegistryRow[],
  now: string,
): Promise<void> {
  for (const row of rows) {
    await mysqlExecute(
      pool,
      `INSERT INTO data_sources
         (id, label, issuer_type, state_code, base_url, jurisdiction_level, jurisdiction_name,
          fips_code, fetch_config, provider_family, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         label = VALUES(label),
         issuer_type = VALUES(issuer_type),
         state_code = VALUES(state_code),
         base_url = VALUES(base_url),
         jurisdiction_level = VALUES(jurisdiction_level),
         jurisdiction_name = VALUES(jurisdiction_name),
         fips_code = VALUES(fips_code),
         fetch_config = VALUES(fetch_config),
         provider_family = VALUES(provider_family),
         updated_at = VALUES(updated_at)`,
      [
        row.id, row.label, row.issuerType, row.stateCode, row.baseUrl,
        row.jurisdictionLevel, row.jurisdictionName, row.fipsCode,
        row.fetchConfig, row.providerFamily, now, now,
      ] as never[],
    );
  }
}

async function main() {
  const now = new Date().toISOString();
  const rows = buildSourceRegistryRows();

  if (isMysqlDatabaseUrlConfigured()) {
    await upsertSourceRegistryInMysql(resolveMysqlPool(), rows, now);
    await closeResolvedMysqlPool();
  } else {
    const db = createDatabase();
    runMigrations(db);
    upsertSourceRegistry(db, rows, now);
    db.$client.close();
  }

  console.log(`Source registry migrated: ${rows.length} sources upserted`);
}

if (process.argv[1]?.endsWith("migrate-source-registry.ts")) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
```

在 `frontend/package.json` 的 `scripts` 中，`db:seed` 之后加入：

```json
    "db:migrate-source-registry": "tsx scripts/migrate-source-registry.ts",
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd frontend && npx vitest run scripts/migrate-source-registry.test.ts
```

预期：PASS，5 个测试全绿。然后对本地 SQLite 实跑一次：

```bash
cd frontend && DATABASE_URL= MYSQL_DATABASE_URL= npm run db:migrate-source-registry
```

预期输出：`Source registry migrated: 50 sources upserted`。

- [ ] **Step 5: 提交**

```bash
git add frontend/scripts/migrate-source-registry.ts frontend/scripts/migrate-source-registry.test.ts frontend/package.json
git commit -m "feat(db): migrate the 50 state sources into the data_sources registry"
```

---

## Task 14: 退役旧 registry

**Files:**
- Modify: `frontend/src/lib/state-crawler-sources.ts`
- Modify: `frontend/src/lib/state-crawler-sources.test.ts`
- Delete: `crawler/apsi_crawler/sources/state_sources.py`
- Modify: `crawler/apsi_crawler/sources/registry.py`
- Modify: `crawler/apsi_crawler/cli.py`

**Interfaces:**
- Consumes: Task 13 已把 50 州写入表。
- Produces: `state-crawler-sources.ts` 仅保留 `STATE_CRAWLER_SOURCE_DEFINITIONS`（州码↔名称↔baseUrl，供迁移脚本与 UI 使用）；治理元数据映射全部删除。

**前置条件：** 本任务必须在 Task 13 实跑成功、且 Task 12 的查表路径验证通过之后执行。删除动作放在验证之后。

- [ ] **Step 1: 改造断言**

把 `frontend/src/lib/state-crawler-sources.test.ts` 中依赖治理元数据的测试删除，替换整个文件为：

```typescript
import { describe, expect, it } from "vitest";
import {
  STATE_CRAWLER_SOURCE_DEFINITIONS,
  STATE_CRAWLER_SOURCE_IDS_BY_STATE,
  stateCrawlerSourceIdForAdminSource,
} from "./state-crawler-sources";

describe("state crawler source definitions", () => {
  it("lists all 50 states", () => {
    expect(STATE_CRAWLER_SOURCE_DEFINITIONS).toHaveLength(50);
  });

  it("maps seeded admin state sources to crawler source ids", () => {
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: "CA" })).toBe("ca_caleprocure");
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: "TX" })).toBe("tx_esbd");
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: "WA" })).toBe("wa_state_procurement");
  });

  it("keeps source ids unique", () => {
    const ids = STATE_CRAWLER_SOURCE_DEFINITIONS.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("indexes every definition by its state code", () => {
    expect(Object.keys(STATE_CRAWLER_SOURCE_IDS_BY_STATE)).toHaveLength(50);
  });
});
```

新增 `crawler/tests/test_adapter_coverage.py` —— 用适配器覆盖断言替代原来的「50 条一致」断言：

```python
from apsi_crawler.adapters.registry import DEDICATED_ADAPTERS, PLATFORM_ADAPTERS, resolve_adapter


def test_every_provider_family_used_by_migration_has_an_adapter():
    # migrate-source-registry.ts 只会写出这两个 provider_family。
    for provider_family in ("bidnet", "generic"):
        assert provider_family in PLATFORM_ADAPTERS


def test_dedicated_sources_resolve_without_a_provider_family():
    for source_id in DEDICATED_ADAPTERS:
        assert resolve_adapter(source_id, None) is DEDICATED_ADAPTERS[source_id]
```

- [ ] **Step 2: 运行测试确认当前状态**

```bash
cd frontend && npx vitest run src/lib/state-crawler-sources.test.ts
cd ../crawler && PYTHONPATH=. pytest tests/test_adapter_coverage.py -v
```

预期：前端 FAIL（旧文件仍导出被删的符号或断言不符），Python PASS。

- [ ] **Step 3: 执行退役**

`frontend/src/lib/state-crawler-sources.ts`：保留文件顶部的 `StateCrawlerSourceDefinition` 类型、`STATE_CRAWLER_SOURCE_DEFINITIONS` 数组（50 条）、`STATE_CRAWLER_SOURCE_IDS_BY_STATE`、`stateCrawlerSourceIdForAdminSource`。删除以下内容：

- 所有治理/有效性类型别名（`SourceApprovalStatus`、`SourceAccessPattern`、`SourceLegalReviewStatus`、`SourceAuthority`、`SourceTrustStatus`、`SourceEvidenceMode`、`SourceGovernanceMetadata`、`SourceValidityMetadata`、`CrawlerAdapterKind`、`CrawlerMaturity`、`CrawlerCapability`）
- 按源的 `adapterKind` / `maturity` / `capabilities` 元数据映射对象
- `STATE_CRAWLER_SOURCES` 及 `StateCrawlerSourceMetadata`

对每个被删除的导出，先运行以下命令确认没有残留引用，有则一并改为从 `data_sources` 读取：

```bash
cd frontend && grep -rn "STATE_CRAWLER_SOURCES\|StateCrawlerSourceMetadata\|SourceGovernanceMetadata\|SourceValidityMetadata" src scripts | grep -v "\.test\."
```

Python 侧：

```bash
cd crawler && git rm apsi_crawler/sources/state_sources.py
```

`crawler/apsi_crawler/sources/registry.py` 中删除 `from apsi_crawler.sources.state_sources import STATE_SOURCES` 与 `**STATE_SOURCES`，`SOURCES` 只保留 `{"sam_gov": SAM_GOV_SOURCE}`。

`crawler/apsi_crawler/cli.py` 中删除 `fetch-state` 子命令及 `fetch_state` 函数、`STATE_FALLBACK_FIXTURES`、`STATE_FALLBACK_FETCHERS`、`_fallback_fixture_for_source`，以及所有对 `apsi_crawler.spiders.*` 的直接 import（这些现在由 `adapters/registry.py` 持有）。`import-fixture`、`fetch-sam-gov`、`validate-state-live`、`fetch-task` 保留。

- [ ] **Step 4: 全量测试**

```bash
cd frontend && npm run lint && npx vitest run
cd ../crawler && PYTHONPATH=. pytest -q
```

预期：两侧全绿。若 `validate-state-live` 因依赖 `STATE_SOURCES` 而失败，将其 `BETA_DEDICATED_STATE_SOURCES` 改为从 `DEDICATED_ADAPTERS` 的键推导。

- [ ] **Step 5: 提交**

```bash
git add -A frontend/src/lib crawler/apsi_crawler crawler/tests
git commit -m "refactor(crawler): retire hardcoded source registries in favour of data_sources"
```

---

## Task 15: 端到端验证

**Files:** 无新增或修改，仅执行验证命令。

本阶段不新增任何 `src/app/api/**/route.ts`，因此无需改动 `mysql-route-coverage.test.ts`。若实现过程中确实新增了 API 路由（例如手动触发某个源的调试端点），必须在该测试的 `SERVICE_LEVEL_MYSQL_ROUTES` 中登记并写明理由，否则测试会失败。

**Interfaces:**
- Consumes: 全部前序任务。

- [ ] **Step 1: SQLite 路径端到端**

```bash
cd frontend
DATABASE_URL= MYSQL_DATABASE_URL= npm run db:migrate
DATABASE_URL= MYSQL_DATABASE_URL= npm run db:migrate-source-registry
DATABASE_URL= MYSQL_DATABASE_URL= STATE_CRAWLER_LIMIT=3 npm run crawler:once
```

预期：输出 JSON 数组，每个元素含 `source` 与 `status`。由于 fixture 回退已删除且多数源已 8 周未跑，出现 `failure` 是**预期结果**，不是本阶段的缺陷——验收看的是失败是否被正确分类与记录。

- [ ] **Step 2: 核对失败分类与健康写回**

```bash
cd frontend && DATABASE_URL= MYSQL_DATABASE_URL= npx tsx -e "
import { createDatabase } from './src/server/db/client';
import { dataSources } from './src/server/db/schema';
const db = createDatabase();
const rows = db.select().from(dataSources).all();
console.table(rows.map(r => ({ id: r.id, ok: r.lastSuccessAt, fail: r.lastFailureAt, n: r.consecutiveFailures, status: r.approvalStatus })).slice(0, 20));
db.\$client.close();
"
```

预期：成功的源 `lastSuccessAt` 有值且 `consecutiveFailures = 0`；失败的源 `consecutiveFailures ≥ 1`；解析失败的源 `approvalStatus = needs_review`。

- [ ] **Step 3: MySQL 路径端到端**

先确保 MySQL 在运行（`bash start-mysql.sh --no-dev`），然后：

```bash
cd frontend
npm run db:mysql:migrate
npm run db:migrate-source-registry
npm run db:mysql:smoke
STATE_CRAWLER_LIMIT=3 npm run crawler:once
```

预期：`db:mysql:migrate` 报告新增列已应用；smoke 通过；`crawler:once` 与 SQLite 路径行为一致。

- [ ] **Step 4: 全量质量门禁**

```bash
cd frontend && npm run lint && npx vitest run && npm run build
cd ../crawler && PYTHONPATH=. pytest -q
```

预期：全绿。`npm run build` 同时执行类型检查。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "chore(crawler): verify phase 1 source registry migration end to end"
```

---

## 验收对照

| Spec 验收项 | 覆盖任务 |
|---|---|
| `data_sources` 为唯一真源，旧 registry 已删除 | Task 12, 13, 14 |
| `cadence` 生效，改表即改频率无需改代码 | Task 4, 12 |
| 三类失败正确分类，`consecutive_failures` 触发退避与降级 | Task 5, 11 |
| 新增源仅需插一行数据 | Task 6, 7, 8, 9 |
| 全部测试通过，含跨语言契约测试 | Task 10, 15 |
| SQLite 与 MySQL 双路径验证 | Task 3, 11, 13, 15 |
