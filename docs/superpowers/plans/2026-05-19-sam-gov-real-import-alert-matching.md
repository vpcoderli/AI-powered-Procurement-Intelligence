# SAM.gov Real Import and Alert Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real SAM.gov opportunity imports, a manual backend trigger, and metadata-only saved search alert matching.

**Architecture:** Keep the Python crawler responsible for external SAM.gov API access and SQLite upserts. Keep Next.js responsible for local manual triggering, token checks, and alert matching against the shared SQLite database. Reuse existing bid filtering semantics for matcher consistency.

**Tech Stack:** Python 3, requests, pytest, Next.js App Router, TypeScript, Drizzle ORM, Vitest, SQLite.

---

## File Structure

- Create `crawler/apsi_crawler/spiders/sam_gov_api.py`: SAM.gov public opportunities client, pagination, and normalized bid fetching.
- Modify `crawler/apsi_crawler/cli.py`: add `fetch-sam-gov` command, success logs, and failure logs.
- Modify `crawler/requirements.txt`: add `requests`.
- Create `crawler/tests/test_sam_gov_api.py`: API client tests with fake session responses.
- Modify `crawler/tests/test_cli.py`: CLI tests for real import success and failure.
- Modify `frontend/src/server/bids/service.ts`: expose a database-injected query helper for alert matching.
- Create `frontend/src/server/crawler/sam-gov-runner.ts`: build and execute the Python crawler command.
- Create `frontend/src/server/crawler/sam-gov-runner.test.ts`: runner unit tests.
- Create `frontend/src/app/api/crawler/sam-gov/run/route.ts`: manual run route.
- Create `frontend/src/app/api/crawler/sam-gov/run/route.test.ts`: route tests for token enforcement and success.
- Create `frontend/src/server/search-alerts/matcher.ts`: enabled alert matching and timestamp updates.
- Create `frontend/src/server/search-alerts/matcher.test.ts`: matcher tests.

## Task 1: Python SAM.gov API Client

**Files:**
- Create: `crawler/apsi_crawler/spiders/sam_gov_api.py`
- Test: `crawler/tests/test_sam_gov_api.py`

- [ ] **Step 1: Write failing tests**

```python
def test_fetch_sam_gov_opportunities_uses_documented_parameters():
    session = FakeSession([
        FakeResponse(200, {"totalRecords": 1, "opportunitiesData": [RAW_OPPORTUNITY]})
    ])

    bids = fetch_sam_gov_opportunities(
        api_key="secret",
        posted_from="05/01/2026",
        posted_to="05/19/2026",
        limit=100,
        max_records=100,
        session=session,
    )

    assert len(bids) == 1
    assert session.calls[0]["params"] == {
        "api_key": "secret",
        "postedFrom": "05/01/2026",
        "postedTo": "05/19/2026",
        "limit": 100,
        "offset": 0,
    }
```

- [ ] **Step 2: Run red test**

Run: `cd crawler && python3 -m pytest tests/test_sam_gov_api.py -v`

Expected: FAIL because `apsi_crawler.spiders.sam_gov_api` does not exist.

- [ ] **Step 3: Implement client**

```python
def fetch_sam_gov_opportunities(api_key, posted_from, posted_to, limit=100, max_records=None, session=None):
    if not api_key:
        raise SamGovApiError("SAM.gov API key is required")
    client = session or requests.Session()
    # GET https://api.sam.gov/opportunities/v2/search with api_key, postedFrom, postedTo, limit, offset
```

- [ ] **Step 4: Run green test**

Run: `cd crawler && python3 -m pytest tests/test_sam_gov_api.py -v`

Expected: PASS.

## Task 2: CLI Real Import

**Files:**
- Modify: `crawler/apsi_crawler/cli.py`
- Modify: `crawler/tests/test_cli.py`

- [ ] **Step 1: Write failing CLI tests**

```python
def test_fetch_sam_gov_writes_bids_and_crawler_log(tmp_path, monkeypatch):
    monkeypatch.setenv("SAM_API_KEY", "secret")
    monkeypatch.setattr("apsi_crawler.cli.fetch_sam_gov_opportunities", lambda **kwargs: [normalized_bid])

    exit_code = main(["fetch-sam-gov", "--database", str(database), "--posted-from", "05/01/2026", "--posted-to", "05/19/2026"])

    assert exit_code == 0
    assert crawler_logs_row["status"] == "success"
```

- [ ] **Step 2: Run red CLI tests**

Run: `cd crawler && python3 -m pytest tests/test_cli.py -v`

Expected: FAIL because `fetch-sam-gov` is unsupported.

- [ ] **Step 3: Implement CLI command**

Add parser args: `--database`, `--api-key`, `--posted-from`, `--posted-to`, `--limit`, and `--max-records`. Read missing `--api-key` from `SAM_API_KEY`. On exceptions, write a failure `crawler_logs` row and return `1`.

- [ ] **Step 4: Run green crawler tests**

Run: `cd crawler && python3 -m pytest`

Expected: PASS.

## Task 3: Database-Injected Bid Query Helper

**Files:**
- Modify: `frontend/src/server/bids/service.ts`
- Modify: `frontend/src/server/bids/service.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it("queries bids from an injected database", async () => {
  const response = await queryBidsFromDatabase(testDb.db, { q: "cloud" }, { referenceDate });
  expect(response.bids.map((bid) => bid.title)).toContain("Cloud Migration Services");
});
```

- [ ] **Step 2: Run red test**

Run: `cd frontend && npm test -- src/server/bids/service.test.ts`

Expected: FAIL because `queryBidsFromDatabase` is not exported.

- [ ] **Step 3: Implement helper**

Move current filter logic behind `queryBidsFromDatabase(db, query, options)` and make `queryBids` call it with the singleton `db`.

- [ ] **Step 4: Run green test**

Run: `cd frontend && npm test -- src/server/bids/service.test.ts`

Expected: PASS.

## Task 4: Frontend SAM.gov Runner and Manual Route

**Files:**
- Create: `frontend/src/server/crawler/sam-gov-runner.ts`
- Create: `frontend/src/server/crawler/sam-gov-runner.test.ts`
- Create: `frontend/src/app/api/crawler/sam-gov/run/route.ts`
- Create: `frontend/src/app/api/crawler/sam-gov/run/route.test.ts`

- [ ] **Step 1: Write failing runner and route tests**

```ts
it("requires crawler token when configured", async () => {
  vi.stubEnv("CRAWLER_RUN_TOKEN", "local-token");
  const response = await POST(new Request("http://localhost/api/crawler/sam-gov/run"));
  expect(response.status).toBe(401);
});
```

- [ ] **Step 2: Run red tests**

Run: `cd frontend && npm test -- src/server/crawler/sam-gov-runner.test.ts src/app/api/crawler/sam-gov/run/route.test.ts`

Expected: FAIL because files do not exist.

- [ ] **Step 3: Implement runner and route**

The route calls `runSamGovCrawler()`. The runner uses `execFile` with `python3 -m apsi_crawler.cli fetch-sam-gov`, `cwd` set to the repo `crawler` directory, and `SAM_API_KEY` inherited from the process environment.

- [ ] **Step 4: Run green tests**

Run: `cd frontend && npm test -- src/server/crawler/sam-gov-runner.test.ts src/app/api/crawler/sam-gov/run/route.test.ts`

Expected: PASS.

## Task 5: Search Alert Matcher

**Files:**
- Create: `frontend/src/server/search-alerts/matcher.ts`
- Create: `frontend/src/server/search-alerts/matcher.test.ts`

- [ ] **Step 1: Write failing matcher tests**

```ts
it("updates lastMatchedAt for enabled alerts with matching bids", async () => {
  const result = await matchEnabledSearchAlerts(testDb.db, { referenceDate, matchedAt });
  expect(result).toEqual({ evaluatedAlerts: 1, matchedAlerts: 1, updatedAlerts: 1 });
});
```

- [ ] **Step 2: Run red test**

Run: `cd frontend && npm test -- src/server/search-alerts/matcher.test.ts`

Expected: FAIL because matcher does not exist.

- [ ] **Step 3: Implement matcher**

Select enabled alerts, parse each stored query through existing service behavior, call `queryBidsFromDatabase`, and update `lastMatchedAt` plus `updatedAt` for alerts where `total > 0`.

- [ ] **Step 4: Run green test**

Run: `cd frontend && npm test -- src/server/search-alerts/matcher.test.ts`

Expected: PASS.

## Task 6: Full Verification and Commit

- [ ] **Step 1: Run crawler tests**

Run: `cd crawler && python3 -m pytest`

Expected: all tests PASS.

- [ ] **Step 2: Run frontend tests**

Run: `cd frontend && npm test`

Expected: all tests PASS.

- [ ] **Step 3: Run lint**

Run: `cd frontend && npm run lint`

Expected: PASS.

- [ ] **Step 4: Run build**

Run: `cd frontend && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crawler frontend docs/superpowers/plans/2026-05-19-sam-gov-real-import-alert-matching.md
git commit -m "feat: add sam gov import and alert matching"
```

## Self-Review

- Spec coverage: The plan covers real SAM.gov fetch, CLI import, manual backend route, alert matching, tests, and verification.
- Placeholder scan: No planned task depends on undefined future work.
- Type consistency: Route, runner, and matcher names are stable across tasks.
