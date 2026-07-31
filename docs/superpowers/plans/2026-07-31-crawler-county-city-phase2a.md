# Phase 2a: County/City Expansion — BidNet + Bonfire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the crawler from 56 state/federal sources to include county/city jurisdictions via the BidNet and Bonfire platforms, adding the governance gate tightening and scheduler concurrency cap needed at scale.

**Architecture:** Three changes work together: (1) tighten the source-registry governance gate so bulk-registered county/city sources require explicit approval before crawling, (2) add a platform concurrency cap to the scheduler so hundreds of same-platform sources don't overwhelm a single target, (3) extract a platform-generic Bonfire spider from the existing Utah-specific one and wire it into the adapter registry. BidNet county/city sources need zero spider changes — just new `data_sources` rows. A source registration script handles bulk upserts from a JSON candidate file.

**Tech Stack:** TypeScript (Vitest), Python (pytest), SQLite + MySQL dual-dialect

## Global Constraints

- **Dual dialect rule:** Every database query must have both a Drizzle (SQLite) and a hand-written SQL (MySQL) branch. Services branch on `isMysqlDatabaseUrlConfigured()`.
- **Four-point column sync:** New DB columns require edits in `schema.ts`, `migrate.ts` CREATE TABLE block, `migrate.ts` addColumn helpers, and `mysql.ts` mysqlColumnMigrations array. *(No new columns in this plan — Phase 1 added them all.)*
- **Spider signature contract:** All platform spiders follow `def fetch_X_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_html=None)` (or `fixture_json=None` for JSON APIs). This is enforced by `test_every_registered_adapter_binds_the_fetch_task_calling_convention` in `test_adapter_registry.py`.
- **Governance preservation:** Registration scripts must NEVER overwrite `approval_status`, `legal_review_status`, `approved_for_ingestion`, or any `compliance_*` column.
- **Run `npm run build` before committing** any frontend change (vitest/lint do not typecheck).
- **TDD:** Write the failing test first, then the implementation.

---

### Task 1: Tighten Governance Gate for County/City Sources

Phase 1's `listCrawlableSources` treats `approval_status = NULL` as "never reviewed, allowed to crawl." This is correct for the 50 manually-vetted state sources, but county/city sources will be bulk-registered by discovery scripts and must require explicit `approval_status = 'approved'` before their first crawl.

**Files:**
- Modify: `frontend/src/server/crawler/source-registry.ts`
- Modify: `frontend/src/server/crawler/source-registry.test.ts`

**Interfaces:**
- Consumes: `dataSources` schema (unchanged), `CrawlableSource` interface (unchanged)
- Produces: `listCrawlableSources(db)` / `listCrawlableSourcesFromMysql(pool)` with tightened WHERE clause — county/city sources with `approval_status = NULL` are now excluded

- [ ] **Step 1: Write the failing test — SQLite branch**

Add to `source-registry.test.ts` inside the `listCrawlableSources` describe block:

```typescript
it("excludes county sources whose approval_status is NULL (bulk-registered, pending review)", () => {
  testDb.db
    .insert(dataSources)
    .values(sourceRow({
      id: "bidnet_co_denver",
      issuerType: "county",
      jurisdictionLevel: "county",
      approvedForIngestion: null,
      approvalStatus: null,
      legalReviewStatus: null,
    }))
    .run();

  expect(listCrawlableSources(testDb.db)).toHaveLength(0);
});

it("includes county sources with explicit approval_status = approved", () => {
  testDb.db
    .insert(dataSources)
    .values(sourceRow({
      id: "bidnet_co_denver",
      issuerType: "county",
      jurisdictionLevel: "county",
      approvedForIngestion: 1,
      approvalStatus: "approved",
      legalReviewStatus: "approved_public",
    }))
    .run();

  expect(listCrawlableSources(testDb.db)).toHaveLength(1);
  expect(listCrawlableSources(testDb.db)[0].id).toBe("bidnet_co_denver");
});

it("still allows state sources with NULL approval_status for backward compatibility", () => {
  testDb.db
    .insert(dataSources)
    .values(sourceRow({
      id: "sam_gov",
      issuerType: "federal",
      jurisdictionLevel: "federal",
      approvedForIngestion: null,
      approvalStatus: null,
      legalReviewStatus: null,
    }))
    .run();

  const sources = listCrawlableSources(testDb.db);
  expect(sources).toHaveLength(1);
  expect(sources[0].id).toBe("sam_gov");
});

it("still allows state sources with NULL jurisdiction_level and NULL approval for backward compat", () => {
  // Legacy rows from seed that have no jurisdiction_level yet
  testDb.db
    .insert(dataSources)
    .values(sourceRow({
      id: "legacy_state",
      issuerType: "state",
      jurisdictionLevel: null,
      approvedForIngestion: null,
      approvalStatus: null,
      legalReviewStatus: null,
    }))
    .run();

  expect(listCrawlableSources(testDb.db)).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/server/crawler/source-registry.test.ts`
Expected: first new test FAILS (county source with NULL approval currently passes the gate)

- [ ] **Step 3: Implement the governance gate tightening — SQLite**

In `source-registry.ts`, modify the `listCrawlableSources` WHERE clause. Replace the existing `approvalStatus` condition:

```typescript
or(isNull(dataSources.approvalStatus), eq(dataSources.approvalStatus, "approved")),
```

With a jurisdiction-aware condition:

```typescript
or(
  eq(dataSources.approvalStatus, "approved"),
  and(
    isNull(dataSources.approvalStatus),
    or(
      isNull(dataSources.jurisdictionLevel),
      inArray(dataSources.jurisdictionLevel, ["federal", "state"]),
    ),
  ),
),
```

This means: approved is always allowed; NULL approval is allowed only if `jurisdiction_level` is NULL (legacy rows), `"federal"`, or `"state"`.

- [ ] **Step 4: Implement the governance gate tightening — MySQL**

In the same file, modify `listCrawlableSourcesFromMysql`. Replace:

```sql
AND (approval_status IS NULL OR approval_status = 'approved')
```

With:

```sql
AND (
  approval_status = 'approved'
  OR (
    approval_status IS NULL
    AND (jurisdiction_level IS NULL OR jurisdiction_level IN ('federal', 'state'))
  )
)
```

- [ ] **Step 5: Add MySQL fake-pool test**

Add to the `listCrawlableSourcesFromMysql` describe block:

```typescript
it("captures the tightened governance gate in the MySQL query", async () => {
  let capturedSql = "";
  const pool = {
    query: async (sql: string) => {
      capturedSql = sql;
      return [[]] as [unknown[], unknown?];
    },
  };

  await listCrawlableSourcesFromMysql(pool);
  expect(capturedSql).toMatch(/approval_status = 'approved'/);
  expect(capturedSql).toMatch(/jurisdiction_level IS NULL OR jurisdiction_level IN/);
});
```

- [ ] **Step 6: Run all tests and build**

Run: `cd frontend && npx vitest run src/server/crawler/source-registry.test.ts && npm run build`
Expected: all tests PASS, build succeeds

- [ ] **Step 7: Commit**

```bash
git add frontend/src/server/crawler/source-registry.ts frontend/src/server/crawler/source-registry.test.ts
git commit -m "feat(crawler): tighten governance gate — county/city sources require explicit approval"
```

---

### Task 2: Platform Concurrency Cap in Scheduler

With hundreds of BidNet sources coming due simultaneously, the scheduler needs a per-platform cap to avoid overwhelming a single target.

**Files:**
- Modify: `frontend/src/server/crawler/scheduler.ts`
- Modify: `frontend/src/server/crawler/scheduler.test.ts`

**Interfaces:**
- Consumes: `CrawlableSource` (unchanged)
- Produces: `selectDueSources(sources, now, options?)` — new optional third parameter `{ platformConcurrencyCap?: number }`, default 10. Returns at most N sources per `providerFamily`.

- [ ] **Step 1: Write failing tests**

Add to `scheduler.test.ts`:

```typescript
it("caps each provider_family to the platform concurrency limit", () => {
  const sources = Array.from({ length: 15 }, (_, i) =>
    source({ id: `bidnet_${i}`, providerFamily: "bidnet" }),
  );
  const result = selectDueSources(sources, NOW);
  expect(result).toHaveLength(10);
  expect(result.every((s) => s.providerFamily === "bidnet")).toBe(true);
});

it("applies the cap independently per provider_family", () => {
  const bidnets = Array.from({ length: 12 }, (_, i) =>
    source({ id: `bidnet_${i}`, providerFamily: "bidnet" }),
  );
  const bonfires = Array.from({ length: 8 }, (_, i) =>
    source({ id: `bonfire_${i}`, providerFamily: "bonfire" }),
  );
  const result = selectDueSources([...bidnets, ...bonfires], NOW);
  const bidnetCount = result.filter((s) => s.providerFamily === "bidnet").length;
  const bonfireCount = result.filter((s) => s.providerFamily === "bonfire").length;
  expect(bidnetCount).toBe(10);
  expect(bonfireCount).toBe(8);
});

it("does not cap dedicated sources (null providerFamily)", () => {
  const dedicated = Array.from({ length: 15 }, (_, i) =>
    source({ id: `dedicated_${i}`, providerFamily: null }),
  );
  const result = selectDueSources(dedicated, NOW);
  expect(result).toHaveLength(15);
});

it("accepts a custom cap via options", () => {
  const sources = Array.from({ length: 20 }, (_, i) =>
    source({ id: `bidnet_${i}`, providerFamily: "bidnet" }),
  );
  const result = selectDueSources(sources, NOW, { platformConcurrencyCap: 5 });
  expect(result).toHaveLength(5);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/server/crawler/scheduler.test.ts`
Expected: FAIL — `selectDueSources` does not accept a third argument, and returns all 15 sources

- [ ] **Step 3: Implement the concurrency cap**

In `scheduler.ts`, add an options interface and modify `selectDueSources`:

```typescript
export interface SchedulerOptions {
  platformConcurrencyCap?: number;
}

const DEFAULT_PLATFORM_CONCURRENCY_CAP = 10;
```

At the end of `selectDueSources`, after the interleaved result is built, add a post-filter:

```typescript
export function selectDueSources(
  sources: CrawlableSource[],
  now: Date,
  options?: SchedulerOptions,
): CrawlableSource[] {
  // ... existing filter, sort, interleave code unchanged ...

  const interleaved = [...byLevel.keys()]
    .sort((a, b) => a - b)
    .flatMap((rank) => interleaveByProviderFamily(byLevel.get(rank)!));

  const cap = options?.platformConcurrencyCap ?? DEFAULT_PLATFORM_CONCURRENCY_CAP;
  const familyCounts = new Map<string, number>();
  return interleaved.filter((s) => {
    if (s.providerFamily === null) return true;
    const count = familyCounts.get(s.providerFamily) ?? 0;
    if (count >= cap) return false;
    familyCounts.set(s.providerFamily, count + 1);
    return true;
  });
}
```

- [ ] **Step 4: Run tests and build**

Run: `cd frontend && npx vitest run src/server/crawler/scheduler.test.ts && npm run build`
Expected: all tests PASS (including existing ones — the cap doesn't affect existing tests because they have fewer than 10 sources per family)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/server/crawler/scheduler.ts frontend/src/server/crawler/scheduler.test.ts
git commit -m "feat(crawler): add per-platform concurrency cap to scheduler"
```

---

### Task 3: Bonfire Platform Spider

Extract a generic Bonfire platform spider from the existing `ut_bonfire.py`. The new spider reads the tenant subdomain from `source.fetch_config["tenant"]` and works for any Bonfire-hosted entity. The existing `ut_bonfire.py` becomes a thin wrapper delegating to the platform spider.

**Files:**
- Create: `crawler/apsi_crawler/spiders/bonfire.py`
- Create: `crawler/tests/fixtures/bonfire_sample.json`
- Create: `crawler/tests/test_bonfire_spider.py`
- Modify: `crawler/apsi_crawler/spiders/ut_bonfire.py` (make it delegate)
- Modify: `crawler/apsi_crawler/adapters/registry.py` (register `"bonfire"`)

**Interfaces:**
- Consumes: `TaskSource` from `adapters/task.py` (reads `source.fetch_config["tenant"]`), `normalize_state_opportunity` from `normalizers/state_bids.py`
- Produces: `fetch_bonfire_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_json=None)` — returns list of normalized bid dicts

- [ ] **Step 1: Create the test fixture**

Create `crawler/tests/fixtures/bonfire_sample.json` — a minimal Bonfire API response with two projects. This is the same JSON shape as the existing `ut_bonfire_open_opportunities.json` but with different data to represent a non-Utah tenant:

```json
{
  "success": 1,
  "message": "Success",
  "payload": {
    "projects": {
      "300001": {
        "ProjectID": "300001",
        "PrivateProjectID": "abc123def456",
        "ReferenceID": "RFP-2026-042",
        "ProjectName": "Louisville Metro Road Resurfacing Program 2026",
        "DateClose": "2026-08-15 16:00:00",
        "DepartmentID": "20100"
      },
      "300002": {
        "ProjectID": "300002",
        "PrivateProjectID": "xyz789ghi012",
        "ReferenceID": "IFB-2026-088",
        "ProjectName": "Emergency Vehicle Fleet Maintenance Services",
        "DateClose": "2026-09-01 14:00:00",
        "DepartmentID": "20200"
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `crawler/tests/test_bonfire_spider.py`:

```python
from pathlib import Path

import pytest

from apsi_crawler.adapters.task import task_source_from_payload
from apsi_crawler.spiders.bonfire import BonfireError, fetch_bonfire_opportunities

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _make_source(tenant="louisvilleky", source_id="bonfire_ky_louisville"):
    return task_source_from_payload({
        "task_id": "t1",
        "source_id": source_id,
        "label": f"Louisville KY (Bonfire)",
        "state_code": "KY",
        "provider_family": "bonfire",
        "jurisdiction_level": "city",
        "fetch_config": {
            "tenant": tenant,
            "base_url": f"https://{tenant}.bonfirehub.com/portal/",
        },
    })


def test_parses_bonfire_fixture_into_normalized_bids():
    source = _make_source()
    bids = fetch_bonfire_opportunities(
        source,
        fixture_json=str(FIXTURES_DIR / "bonfire_sample.json"),
    )
    assert len(bids) == 2
    assert bids[0]["source_bid_id"] == "RFP-2026-042"
    assert bids[0]["title"] == "Louisville Metro Road Resurfacing Program 2026"
    assert "bonfirehub.com/opportunities/300001" in bids[0]["source_url"]
    assert bids[0]["state_code"] == "KY"


def test_respects_limit():
    source = _make_source()
    bids = fetch_bonfire_opportunities(
        source,
        limit=1,
        fixture_json=str(FIXTURES_DIR / "bonfire_sample.json"),
    )
    assert len(bids) == 1


def test_filters_by_query():
    source = _make_source()
    bids = fetch_bonfire_opportunities(
        source,
        query="road resurfacing",
        fixture_json=str(FIXTURES_DIR / "bonfire_sample.json"),
    )
    assert len(bids) == 1
    assert "Road Resurfacing" in bids[0]["title"]


def test_raises_when_tenant_is_missing():
    source = task_source_from_payload({
        "task_id": "t2",
        "source_id": "bonfire_ky_louisville",
        "label": "Louisville",
        "state_code": "KY",
        "provider_family": "bonfire",
        "fetch_config": {},
    })
    with pytest.raises(ValueError, match="fetch_config.tenant"):
        fetch_bonfire_opportunities(source, fixture_json=str(FIXTURES_DIR / "bonfire_sample.json"))


def test_raises_on_empty_response():
    source = _make_source()
    with pytest.raises(BonfireError, match="did not contain opportunities"):
        fetch_bonfire_opportunities(
            source,
            fixture_json=str(FIXTURES_DIR / "contracts" / "fetch_task_v1.json"),
        )
```

- [ ] **Step 3: Run to verify failure**

Run: `cd crawler && PYTHONPATH=. python3 -m pytest tests/test_bonfire_spider.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'apsi_crawler.spiders.bonfire'`

- [ ] **Step 4: Implement the Bonfire platform spider**

Create `crawler/apsi_crawler/spiders/bonfire.py`:

```python
import json

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


class BonfireError(Exception):
    pass


def _projects_from_payload(payload):
    projects = payload.get("payload", {}).get("projects", {}) if isinstance(payload, dict) else {}
    if isinstance(projects, dict):
        return list(projects.values())
    if isinstance(projects, list):
        return projects
    return []


def _record_from_project(project, tenant, source_label):
    source_bid_id = project.get("ReferenceID") or project.get("ProjectID")
    if not source_bid_id:
        raise BonfireError("Bonfire project is missing reference id")
    project_id = project.get("ProjectID")
    return {
        "source_bid_id": source_bid_id,
        "title": project.get("ProjectName"),
        "description": project.get("ProjectName"),
        "deadline_date": project.get("DateClose"),
        "issuer_name": source_label,
        "source_url": (
            f"https://{tenant}.bonfirehub.com/opportunities/{project_id}"
            if project_id
            else f"https://{tenant}.bonfirehub.com/portal/?tab=openOpportunities"
        ),
        "attachments": [],
    }


def _load_payload(tenant, fixture_json=None, session=None, timeout=30):
    if fixture_json:
        with open(fixture_json, encoding="utf-8") as f:
            return json.load(f)

    portal_url = f"https://{tenant}.bonfirehub.com/portal/?tab=openOpportunities"
    api_url = f"https://{tenant}.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData"

    client = session or requests.Session()
    close_client = session is None
    try:
        client.get(portal_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=timeout)
        response = client.get(
            api_url,
            headers={
                "Accept": "application/json, text/plain, */*",
                "Referer": portal_url,
                "User-Agent": "Mozilla/5.0",
            },
            timeout=timeout,
        )
        if response.status_code != 200:
            raise BonfireError(
                f"Bonfire {tenant} request failed with status {response.status_code}: {response.text}"
            )
        return response.json()
    except requests.RequestException as error:
        raise BonfireError(f"Bonfire {tenant} request failed: {error}") from error
    except ValueError as error:
        raise BonfireError(f"Bonfire {tenant} response was not valid JSON") from error
    finally:
        if close_client:
            client.close()


def fetch_bonfire_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_json=None):
    tenant = (source.fetch_config or {}).get("tenant")
    if not tenant:
        raise ValueError(f"Bonfire source {source.id} missing fetch_config.tenant")

    limit_count = int(limit)
    payload = _load_payload(tenant, fixture_json=fixture_json, session=session, timeout=timeout)
    records = [
        _record_from_project(project, tenant, source.source_label)
        for project in _projects_from_payload(payload)
    ]
    if not records:
        raise BonfireError(f"Bonfire {tenant} response did not contain opportunities")

    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(v) for v in record.values()).lower()
        ]

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd crawler && PYTHONPATH=. python3 -m pytest tests/test_bonfire_spider.py -v`
Expected: 5 passed

- [ ] **Step 6: Make ut_bonfire.py delegate to the platform spider**

Replace the body of `fetch_ut_bonfire_opportunities` in `ut_bonfire.py` to delegate:

```python
from apsi_crawler.spiders.bonfire import fetch_bonfire_opportunities as _bonfire_platform


def fetch_ut_bonfire_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_json=None,
):
    # Backward compat: if source.fetch_config has no tenant, inject "utah" so the
    # platform spider knows which subdomain to hit. This handles the dedicated
    # ut_bonfire source_id path where fetch_config may be empty.
    if not (source.fetch_config or {}).get("tenant"):
        from dataclasses import replace
        source = replace(source, fetch_config={**source.fetch_config, "tenant": "utah"})

    return _bonfire_platform(
        source,
        query=query,
        limit=limit,
        session=session,
        timeout=timeout,
        fixture_json=fixture_json,
    )
```

Remove the duplicated helper functions (`_projects_from_payload`, `_record_from_project`, `_load_payload`) and the `UtBonfireError` class from `ut_bonfire.py`. Keep only the imports, the constant URLs (for reference), and the wrapper function above.

- [ ] **Step 7: Verify existing ut_bonfire tests still pass**

Run: `cd crawler && PYTHONPATH=. python3 -m pytest tests/ -k "bonfire" -v`
Expected: all existing bonfire tests + 5 new tests pass

- [ ] **Step 8: Register bonfire in the adapter registry**

In `crawler/apsi_crawler/adapters/registry.py`, add the import and registry entry:

```python
from apsi_crawler.spiders.bonfire import fetch_bonfire_opportunities

PLATFORM_ADAPTERS = {
    "bidnet": fetch_bidnet_platform,
    "generic": fetch_generic_state_opportunities,
    "bonfire": fetch_bonfire_opportunities,  # Phase 2a
}
```

- [ ] **Step 9: Run full crawler test suite**

Run: `cd crawler && PYTHONPATH=. python3 -m pytest -v`
Expected: all 219+ tests pass (214 existing + 5 new)

- [ ] **Step 10: Commit**

```bash
git add crawler/apsi_crawler/spiders/bonfire.py crawler/tests/fixtures/bonfire_sample.json \
  crawler/tests/test_bonfire_spider.py crawler/apsi_crawler/spiders/ut_bonfire.py \
  crawler/apsi_crawler/adapters/registry.py
git commit -m "feat(crawler): add Bonfire platform spider and register in adapter registry"
```

---

### Task 4: Adapter Coverage Tests for New Platform

Extend the existing adapter coverage tests to verify the new `"bonfire"` platform family resolves correctly and passes the calling-convention check.

**Files:**
- Modify: `crawler/tests/test_adapter_coverage.py`
- Modify: `crawler/tests/test_adapter_registry.py`

**Interfaces:**
- Consumes: `registry.PLATFORM_ADAPTERS`, `resolve_adapter(source_id, provider_family)`
- Produces: test coverage only

- [ ] **Step 1: Update test_adapter_coverage.py**

Replace the `test_every_provider_family_used_by_migration_has_an_adapter` function to include `"bonfire"`:

```python
def test_every_provider_family_used_by_migration_has_an_adapter():
    for provider_family in ("bidnet", "generic", "bonfire"):
        assert provider_family in PLATFORM_ADAPTERS
```

- [ ] **Step 2: Add bonfire end-to-end wiring test**

In `test_adapter_registry.py`, add:

```python
def test_resolved_bonfire_adapter_fetches_and_normalizes_from_a_fixture():
    source = task_source_from_payload(
        {
            "task_id": "t1",
            "source_id": "bonfire_ky_louisville",
            "label": "Louisville KY (Bonfire)",
            "state_code": "KY",
            "provider_family": "bonfire",
            "jurisdiction_level": "city",
            "fetch_config": {
                "tenant": "louisvilleky",
                "base_url": "https://louisvilleky.bonfirehub.com/portal/",
            },
        }
    )

    adapter = resolve_adapter(source.id, "bonfire")
    bids = adapter(
        source,
        limit=5,
        fixture_json=str(FIXTURES_DIR / "bonfire_sample.json"),
    )

    assert len(bids) == 2
    assert bids[0]["source_bid_id"] == "RFP-2026-042"
    assert bids[0]["state_code"] == "KY"


def test_resolved_bonfire_adapter_raises_without_tenant():
    source = task_source_from_payload(
        {
            "task_id": "t3",
            "source_id": "bonfire_ky_louisville",
            "label": "Louisville",
            "state_code": "KY",
            "provider_family": "bonfire",
            "fetch_config": {},
        }
    )

    adapter = resolve_adapter(source.id, "bonfire")
    with pytest.raises(ValueError, match="fetch_config.tenant"):
        adapter(source, fixture_json=str(FIXTURES_DIR / "bonfire_sample.json"))
```

- [ ] **Step 3: Run all adapter tests**

Run: `cd crawler && PYTHONPATH=. python3 -m pytest tests/test_adapter_registry.py tests/test_adapter_coverage.py -v`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add crawler/tests/test_adapter_coverage.py crawler/tests/test_adapter_registry.py
git commit -m "test(crawler): extend adapter coverage tests for bonfire platform"
```

---

### Task 5: Source Registration Script

A script that reads a JSON file of candidate sources and upserts them into `data_sources`, dual-dialect. Governance columns are never overwritten.

**Files:**
- Create: `frontend/scripts/register-sources.ts`
- Create: `frontend/scripts/register-sources.test.ts`

**Interfaces:**
- Consumes: `dataSources` schema, `isMysqlDatabaseUrlConfigured()`, `resolveMysqlPool()`, `mysqlExecute()`, `createDatabase()`, `runMigrations()`
- Produces: `registerSources(db, candidates, now)` / `registerSourcesInMysql(pool, candidates, now)`, `SourceCandidate` type. CLI: `npx tsx scripts/register-sources.ts --file candidates.json [--dry-run]`

- [ ] **Step 1: Define the SourceCandidate type and write tests**

Create `frontend/scripts/register-sources.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { type SourceCandidate, registerSources, validateCandidate } from "./register-sources";

const NOW = "2026-07-31T00:00:00.000Z";

function candidate(overrides: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    id: "bidnet_co_denver",
    label: "Denver County (BidNet)",
    issuerType: "county",
    stateCode: "CO",
    baseUrl: "https://www.bidnetdirect.com/denver-county/solicitations/open-bids",
    jurisdictionLevel: "county",
    jurisdictionName: "Denver County",
    fipsCode: "08031",
    providerFamily: "bidnet",
    cadence: "daily",
    fetchConfig: { base_url: "https://www.bidnetdirect.com/denver-county/solicitations/open-bids" },
    ...overrides,
  };
}

describe("validateCandidate", () => {
  it("accepts a valid candidate", () => {
    expect(validateCandidate(candidate())).toEqual([]);
  });

  it("rejects a candidate missing id", () => {
    const errors = validateCandidate(candidate({ id: "" }));
    expect(errors).toContainEqual(expect.stringContaining("id"));
  });

  it("rejects a candidate with invalid jurisdiction_level", () => {
    const errors = validateCandidate(candidate({ jurisdictionLevel: "planet" }));
    expect(errors).toContainEqual(expect.stringContaining("jurisdictionLevel"));
  });
});

describe("registerSources", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("inserts new sources with approval_status = NULL", () => {
    const result = registerSources(testDb.db, [candidate()], NOW);
    expect(result.inserted).toBe(1);

    const rows = testDb.db.select().from(dataSources).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("bidnet_co_denver");
    expect(rows[0].approvalStatus).toBeNull();
    expect(rows[0].jurisdictionLevel).toBe("county");
    expect(rows[0].providerFamily).toBe("bidnet");
    expect(rows[0].cadence).toBe("daily");
  });

  it("updates non-governance fields on conflict", () => {
    registerSources(testDb.db, [candidate()], NOW);
    registerSources(testDb.db, [candidate({ label: "Denver Updated" })], NOW);

    const rows = testDb.db.select().from(dataSources).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Denver Updated");
  });

  it("never overwrites approval_status on upsert", () => {
    registerSources(testDb.db, [candidate()], NOW);

    // Simulate admin manually approving the source
    testDb.db.update(dataSources)
      .set({ approvalStatus: "approved" })
      .where(require("drizzle-orm").eq(dataSources.id, "bidnet_co_denver"))
      .run();

    registerSources(testDb.db, [candidate({ label: "Denver Updated" })], NOW);

    const rows = testDb.db.select().from(dataSources).all();
    expect(rows[0].approvalStatus).toBe("approved");
  });

  it("handles multiple candidates in one call", () => {
    const candidates = [
      candidate({ id: "bidnet_co_denver" }),
      candidate({ id: "bidnet_ca_la_county", stateCode: "CA", jurisdictionName: "Los Angeles County" }),
    ];
    const result = registerSources(testDb.db, candidates, NOW);
    expect(result.inserted).toBe(2);
  });

  it("skips invalid candidates and reports errors", () => {
    const candidates = [
      candidate({ id: "" }),
      candidate({ id: "bidnet_co_denver" }),
    ];
    const result = registerSources(testDb.db, candidates, NOW);
    expect(result.inserted).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run scripts/register-sources.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the registration script**

Create `frontend/scripts/register-sources.ts`:

```typescript
import { createDatabase, type AppDatabase } from "../src/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "../src/server/db/mysql";
import { mysqlExecute } from "../src/server/db/mysql-runtime";
import { runMigrations } from "../src/server/db/migrate";
import { dataSources } from "../src/server/db/schema";

export interface SourceCandidate {
  id: string;
  label: string;
  issuerType: string;
  stateCode: string;
  baseUrl: string;
  jurisdictionLevel: string;
  jurisdictionName: string;
  fipsCode: string;
  providerFamily: string | null;
  cadence: string;
  fetchConfig: Record<string, unknown>;
}

const VALID_JURISDICTION_LEVELS = new Set(["federal", "state", "county", "city", "special_district"]);
const VALID_CADENCES = new Set(["hourly", "daily", "weekly", "manual"]);

export function validateCandidate(c: SourceCandidate): string[] {
  const errors: string[] = [];
  if (!c.id?.trim()) errors.push("id is required");
  if (!c.label?.trim()) errors.push("label is required");
  if (!c.stateCode?.trim()) errors.push("stateCode is required");
  if (!VALID_JURISDICTION_LEVELS.has(c.jurisdictionLevel))
    errors.push(`jurisdictionLevel must be one of ${[...VALID_JURISDICTION_LEVELS].join(", ")}`);
  if (!VALID_CADENCES.has(c.cadence))
    errors.push(`cadence must be one of ${[...VALID_CADENCES].join(", ")}`);
  return errors;
}

interface RegisterResult {
  inserted: number;
  errors: Array<{ id: string; errors: string[] }>;
}

export function registerSources(db: AppDatabase, candidates: SourceCandidate[], now: string): RegisterResult {
  let inserted = 0;
  const errors: RegisterResult["errors"] = [];

  for (const c of candidates) {
    const validationErrors = validateCandidate(c);
    if (validationErrors.length > 0) {
      errors.push({ id: c.id || "(empty)", errors: validationErrors });
      continue;
    }

    db.insert(dataSources)
      .values({
        id: c.id,
        label: c.label,
        issuerType: c.issuerType,
        stateCode: c.stateCode,
        baseUrl: c.baseUrl,
        jurisdictionLevel: c.jurisdictionLevel,
        jurisdictionName: c.jurisdictionName,
        fipsCode: c.fipsCode,
        providerFamily: c.providerFamily,
        cadence: c.cadence,
        fetchConfig: JSON.stringify(c.fetchConfig),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: dataSources.id,
        set: {
          label: c.label,
          issuerType: c.issuerType,
          stateCode: c.stateCode,
          baseUrl: c.baseUrl,
          jurisdictionLevel: c.jurisdictionLevel,
          jurisdictionName: c.jurisdictionName,
          fipsCode: c.fipsCode,
          providerFamily: c.providerFamily,
          cadence: c.cadence,
          fetchConfig: JSON.stringify(c.fetchConfig),
          updatedAt: now,
        },
      })
      .run();

    inserted++;
  }

  return { inserted, errors };
}

export async function registerSourcesInMysql(
  pool: ReturnType<typeof resolveMysqlPool>,
  candidates: SourceCandidate[],
  now: string,
): Promise<RegisterResult> {
  let inserted = 0;
  const errors: RegisterResult["errors"] = [];

  for (const c of candidates) {
    const validationErrors = validateCandidate(c);
    if (validationErrors.length > 0) {
      errors.push({ id: c.id || "(empty)", errors: validationErrors });
      continue;
    }

    await mysqlExecute(
      pool,
      `INSERT INTO data_sources
         (id, label, issuer_type, state_code, base_url, jurisdiction_level, jurisdiction_name,
          fips_code, provider_family, cadence, fetch_config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         label = VALUES(label),
         issuer_type = VALUES(issuer_type),
         state_code = VALUES(state_code),
         base_url = VALUES(base_url),
         jurisdiction_level = VALUES(jurisdiction_level),
         jurisdiction_name = VALUES(jurisdiction_name),
         fips_code = VALUES(fips_code),
         provider_family = VALUES(provider_family),
         cadence = VALUES(cadence),
         fetch_config = VALUES(fetch_config),
         updated_at = VALUES(updated_at)`,
      [
        c.id, c.label, c.issuerType, c.stateCode, c.baseUrl,
        c.jurisdictionLevel, c.jurisdictionName, c.fipsCode,
        c.providerFamily, c.cadence, JSON.stringify(c.fetchConfig), now, now,
      ] as never[],
    );

    inserted++;
  }

  return { inserted, errors };
}

async function main() {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf("--file");
  if (fileIndex === -1 || !args[fileIndex + 1]) {
    console.error("Usage: npx tsx scripts/register-sources.ts --file candidates.json [--dry-run]");
    process.exitCode = 1;
    return;
  }

  const filePath = args[fileIndex + 1];
  const dryRun = args.includes("--dry-run");

  const { readFileSync } = await import("fs");
  const candidates: SourceCandidate[] = JSON.parse(readFileSync(filePath, "utf-8"));

  if (dryRun) {
    console.log(`Dry run: ${candidates.length} candidates`);
    for (const c of candidates) {
      const errors = validateCandidate(c);
      console.log(`  ${c.id}: ${errors.length === 0 ? "OK" : errors.join(", ")}`);
    }
    return;
  }

  const now = new Date().toISOString();

  if (isMysqlDatabaseUrlConfigured()) {
    const result = await registerSourcesInMysql(resolveMysqlPool(), candidates, now);
    await closeResolvedMysqlPool();
    console.log(`Registered ${result.inserted} sources (MySQL), ${result.errors.length} errors`);
  } else {
    const db = createDatabase();
    runMigrations(db);
    const result = registerSources(db, candidates, now);
    db.$client.close();
    console.log(`Registered ${result.inserted} sources (SQLite), ${result.errors.length} errors`);
  }
}

if (process.argv[1]?.endsWith("register-sources.ts")) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Add npm script to package.json**

In `frontend/package.json`, add to `"scripts"`:

```json
"source:register": "tsx scripts/register-sources.ts"
```

- [ ] **Step 5: Run tests and build**

Run: `cd frontend && npx vitest run scripts/register-sources.test.ts && npm run build`
Expected: all tests pass, build succeeds

- [ ] **Step 6: Commit**

```bash
git add frontend/scripts/register-sources.ts frontend/scripts/register-sources.test.ts frontend/package.json
git commit -m "feat(crawler): add source registration script for bulk county/city source upserts"
```

---

### Task 6: Register Initial BidNet County/City Sources

Create a seed file of 10 real BidNet Direct county/city sources to validate the full pipeline end-to-end. These are real entities discoverable on bidnetdirect.com.

**Files:**
- Create: `frontend/data/seed-sources/bidnet-counties-initial.json`
- Create: `frontend/scripts/register-sources-initial.test.ts`

**Interfaces:**
- Consumes: `registerSources` from Task 5, BidNet adapter (existing)
- Produces: 10 new `data_sources` rows for BidNet county/city entities

- [ ] **Step 1: Create the seed JSON**

Create `frontend/data/seed-sources/bidnet-counties-initial.json` with 10 real BidNet county/city sources. Use the URL pattern `https://www.bidnetdirect.com/{slug}/solicitations/open-bids`:

```json
[
  {
    "id": "bidnet_co_denver",
    "label": "Denver County, CO (BidNet)",
    "issuerType": "county",
    "stateCode": "CO",
    "baseUrl": "https://www.bidnetdirect.com/denver-county/solicitations/open-bids",
    "jurisdictionLevel": "county",
    "jurisdictionName": "Denver County",
    "fipsCode": "08031",
    "providerFamily": "bidnet",
    "cadence": "daily",
    "fetchConfig": {
      "base_url": "https://www.bidnetdirect.com/denver-county/solicitations/open-bids"
    }
  },
  {
    "id": "bidnet_co_boulder",
    "label": "Boulder County, CO (BidNet)",
    "issuerType": "county",
    "stateCode": "CO",
    "baseUrl": "https://www.bidnetdirect.com/boulder-county/solicitations/open-bids",
    "jurisdictionLevel": "county",
    "jurisdictionName": "Boulder County",
    "fipsCode": "08013",
    "providerFamily": "bidnet",
    "cadence": "daily",
    "fetchConfig": {
      "base_url": "https://www.bidnetdirect.com/boulder-county/solicitations/open-bids"
    }
  },
  {
    "id": "bidnet_co_jefferson",
    "label": "Jefferson County, CO (BidNet)",
    "issuerType": "county",
    "stateCode": "CO",
    "baseUrl": "https://www.bidnetdirect.com/jefferson-county-co/solicitations/open-bids",
    "jurisdictionLevel": "county",
    "jurisdictionName": "Jefferson County",
    "fipsCode": "08059",
    "providerFamily": "bidnet",
    "cadence": "daily",
    "fetchConfig": {
      "base_url": "https://www.bidnetdirect.com/jefferson-county-co/solicitations/open-bids"
    }
  },
  {
    "id": "bidnet_oh_cuyahoga",
    "label": "Cuyahoga County, OH (BidNet)",
    "issuerType": "county",
    "stateCode": "OH",
    "baseUrl": "https://www.bidnetdirect.com/cuyahoga-county/solicitations/open-bids",
    "jurisdictionLevel": "county",
    "jurisdictionName": "Cuyahoga County",
    "fipsCode": "39035",
    "providerFamily": "bidnet",
    "cadence": "daily",
    "fetchConfig": {
      "base_url": "https://www.bidnetdirect.com/cuyahoga-county/solicitations/open-bids"
    }
  },
  {
    "id": "bidnet_oh_franklin",
    "label": "Franklin County, OH (BidNet)",
    "issuerType": "county",
    "stateCode": "OH",
    "baseUrl": "https://www.bidnetdirect.com/franklin-county-oh/solicitations/open-bids",
    "jurisdictionLevel": "county",
    "jurisdictionName": "Franklin County",
    "fipsCode": "39049",
    "providerFamily": "bidnet",
    "cadence": "daily",
    "fetchConfig": {
      "base_url": "https://www.bidnetdirect.com/franklin-county-oh/solicitations/open-bids"
    }
  },
  {
    "id": "bidnet_mi_washtenaw",
    "label": "Washtenaw County, MI (BidNet)",
    "issuerType": "county",
    "stateCode": "MI",
    "baseUrl": "https://www.bidnetdirect.com/washtenaw-county/solicitations/open-bids",
    "jurisdictionLevel": "county",
    "jurisdictionName": "Washtenaw County",
    "fipsCode": "26161",
    "providerFamily": "bidnet",
    "cadence": "daily",
    "fetchConfig": {
      "base_url": "https://www.bidnetdirect.com/washtenaw-county/solicitations/open-bids"
    }
  },
  {
    "id": "bidnet_ny_erie",
    "label": "Erie County, NY (BidNet)",
    "issuerType": "county",
    "stateCode": "NY",
    "baseUrl": "https://www.bidnetdirect.com/erie-county/solicitations/open-bids",
    "jurisdictionLevel": "county",
    "jurisdictionName": "Erie County",
    "fipsCode": "36029",
    "providerFamily": "bidnet",
    "cadence": "daily",
    "fetchConfig": {
      "base_url": "https://www.bidnetdirect.com/erie-county/solicitations/open-bids"
    }
  },
  {
    "id": "bidnet_wy_laramie",
    "label": "Laramie County, WY (BidNet)",
    "issuerType": "county",
    "stateCode": "WY",
    "baseUrl": "https://www.bidnetdirect.com/laramie-county/solicitations/open-bids",
    "jurisdictionLevel": "county",
    "jurisdictionName": "Laramie County",
    "fipsCode": "56021",
    "providerFamily": "bidnet",
    "cadence": "daily",
    "fetchConfig": {
      "base_url": "https://www.bidnetdirect.com/laramie-county/solicitations/open-bids"
    }
  },
  {
    "id": "bidnet_co_city_aurora",
    "label": "City of Aurora, CO (BidNet)",
    "issuerType": "city",
    "stateCode": "CO",
    "baseUrl": "https://www.bidnetdirect.com/city-of-aurora/solicitations/open-bids",
    "jurisdictionLevel": "city",
    "jurisdictionName": "Aurora",
    "fipsCode": "0803455",
    "providerFamily": "bidnet",
    "cadence": "weekly",
    "fetchConfig": {
      "base_url": "https://www.bidnetdirect.com/city-of-aurora/solicitations/open-bids"
    }
  },
  {
    "id": "bidnet_oh_city_columbus",
    "label": "City of Columbus, OH (BidNet)",
    "issuerType": "city",
    "stateCode": "OH",
    "baseUrl": "https://www.bidnetdirect.com/city-of-columbus/solicitations/open-bids",
    "jurisdictionLevel": "city",
    "jurisdictionName": "Columbus",
    "fipsCode": "3918000",
    "providerFamily": "bidnet",
    "cadence": "weekly",
    "fetchConfig": {
      "base_url": "https://www.bidnetdirect.com/city-of-columbus/solicitations/open-bids"
    }
  }
]
```

- [ ] **Step 2: Write a test that registers them and verifies the pipeline**

Create `frontend/scripts/register-sources-initial.test.ts`:

```typescript
import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { type SourceCandidate, registerSources, validateCandidate } from "./register-sources";
import { listCrawlableSources } from "@/server/crawler/source-registry";

describe("initial BidNet county/city source registration", () => {
  let testDb: TestDatabase;
  let candidates: SourceCandidate[];

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    const jsonPath = path.join(__dirname, "../data/seed-sources/bidnet-counties-initial.json");
    candidates = JSON.parse(readFileSync(jsonPath, "utf-8"));
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("validates all 10 candidates without errors", () => {
    for (const c of candidates) {
      expect(validateCandidate(c)).toEqual([]);
    }
  });

  it("registers all 10 sources with correct metadata", () => {
    const result = registerSources(testDb.db, candidates, "2026-07-31T00:00:00.000Z");
    expect(result.inserted).toBe(10);
    expect(result.errors).toHaveLength(0);

    const rows = testDb.db.select().from(dataSources).all();
    expect(rows).toHaveLength(10);

    const counties = rows.filter((r) => r.jurisdictionLevel === "county");
    const cities = rows.filter((r) => r.jurisdictionLevel === "city");
    expect(counties).toHaveLength(8);
    expect(cities).toHaveLength(2);
  });

  it("newly registered county/city sources are NOT crawlable until approved (governance gate)", () => {
    registerSources(testDb.db, candidates, "2026-07-31T00:00:00.000Z");
    const crawlable = listCrawlableSources(testDb.db);
    expect(crawlable).toHaveLength(0);
  });

  it("becomes crawlable after admin approval", () => {
    registerSources(testDb.db, candidates, "2026-07-31T00:00:00.000Z");

    // Approve one source
    const { eq } = require("drizzle-orm");
    testDb.db.update(dataSources)
      .set({ approvalStatus: "approved", approvedForIngestion: 1 })
      .where(eq(dataSources.id, "bidnet_co_denver"))
      .run();

    const crawlable = listCrawlableSources(testDb.db);
    expect(crawlable).toHaveLength(1);
    expect(crawlable[0].id).toBe("bidnet_co_denver");
    expect(crawlable[0].providerFamily).toBe("bidnet");
    expect(crawlable[0].jurisdictionLevel).toBe("county");
    expect(crawlable[0].fetchConfig).toEqual({
      base_url: "https://www.bidnetdirect.com/denver-county/solicitations/open-bids",
    });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd frontend && npx vitest run scripts/register-sources-initial.test.ts`
Expected: all 4 tests pass

- [ ] **Step 4: Commit**

```bash
mkdir -p frontend/data/seed-sources
git add frontend/data/seed-sources/bidnet-counties-initial.json frontend/scripts/register-sources-initial.test.ts
git commit -m "feat(crawler): add initial 10 BidNet county/city seed sources with pipeline test"
```

---

### Task 7: Full Regression & Build Verification

Run all test suites, lint, and build to confirm nothing is broken.

**Files:** None (verification only)

- [ ] **Step 1: Run frontend vitest**

Run: `cd frontend && npx vitest run`
Expected: 300+ files, 1800+ tests, all pass

- [ ] **Step 2: Run crawler pytest**

Run: `cd crawler && PYTHONPATH=. python3 -m pytest -v`
Expected: 215+ tests, all pass

- [ ] **Step 3: Run lint**

Run: `cd frontend && npm run lint`
Expected: clean

- [ ] **Step 4: Run build**

Run: `cd frontend && npm run build`
Expected: exit 0

- [ ] **Step 5: Report results**

Print a summary table of all gate results.

---

## Deferred to Phase 2a+ (follow-up plan)

- **Source discovery script** (`scripts/discover-sources.ts`, spec §6.1) — automated enumeration of BidNet/Bonfire directory pages. Deferred because: (1) it requires live HTTP requests to third-party platforms, (2) the registration pipeline must be proven with manual seed data first, (3) discovery is valuable but not blocking — manual research can feed `register-sources.ts` today.
- **Admin UI filters** (spec §8.1) — jurisdiction/platform filter facets on the admin source health page. UI work, independent of backend plumbing.
- **Search page jurisdiction facet** (spec §8.2) — also UI-only, independent.
