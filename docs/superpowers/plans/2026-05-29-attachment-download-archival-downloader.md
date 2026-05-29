# Attachment Download Archival Downloader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download public bid attachments and detail pages into the local archive directory, then persist size, content type, checksum, fetched timestamp, and archive status without breaking existing crawler imports.

**Architecture:** Add a focused Python archive downloader module under `crawler/apsi_crawler/storage/`. The crawler CLI enriches normalized bids before SQLite upsert; SQLite storage remains responsible only for persistence and metadata preservation. Frontend attachment download already reads `storage_path`, so this phase only needs small Admin/read-model visibility updates if useful.

**Tech Stack:** Python 3 crawler package, `requests`, SQLite storage helpers, Vitest/pytest regression suites, existing Next.js Admin page.

---

### Task 1: Archive Downloader Module

**Files:**
- Create: `crawler/apsi_crawler/storage/archive.py`
- Test: `crawler/tests/test_archive_downloader.py`

- [x] **Step 1: Write failing tests**
  - Test public HTTP attachment download writes bytes under a deterministic `attachments/<source>/<bid-id>/attachment-1.ext` path.
  - Test metadata includes `original_url`, `storage_path`, `byte_size`, `content_type`, `checksum_sha256`, `fetched_at`, `archive_status="archived"`.
  - Test non-HTTP/local/login-ish URLs are not fetched and are marked `archive_status="unavailable"` or `"skipped"`.
  - Test HTTP errors do not raise out of the bid import flow; they mark `archive_status="failed"` and preserve the original URL.

- [x] **Step 2: Run RED**
  - `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_archive_downloader.py -q`
  - Expected: import/module not found or missing function failures.

- [x] **Step 3: Implement minimal downloader**
  - Add `archive_bid_documents(bid, archive_root, session=None, timeout=30, fetch_detail=False)`.
  - Use `requests.Session()` when no session is provided.
  - Use SHA-256 over response bytes.
  - Use content type from response headers; infer extension from URL/content type with a small mapping.
  - Never fetch non-HTTP(S), empty, `mailto:`, or URLs that look like login/session-only placeholders.
  - Return an enriched shallow copy of the bid.

- [x] **Step 4: Run GREEN**
  - `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_archive_downloader.py -q`
  - Expected: pass.

### Task 2: CLI Integration

**Files:**
- Modify: `crawler/apsi_crawler/cli.py`
- Test: `crawler/tests/test_state_live_cli.py`
- Test: `crawler/tests/test_cli.py`

- [x] **Step 1: Write failing integration tests**
  - Add archive columns to test DB helpers where needed.
  - For `fetch-state`, fake a live fetcher returning one attachment and monkeypatch downloader session to return bytes; assert `bid_attachments.storage_path`, `archive_status`, `checksum_sha256`, and `byte_size` are persisted.
  - Assert crawler log metadata records archive summary counts.
  - Add one failure case where the downloader marks a failed attachment but the crawler run still succeeds if bids are non-empty.

- [x] **Step 2: Run RED**
  - `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_live_cli.py::test_fetch_state_persists_archived_attachment_metadata -q`
  - Expected: missing archive metadata.

- [x] **Step 3: Implement CLI enrichment**
  - Add `--archive-documents` boolean flag to `fetch-state`, `fetch-sam-gov`, and `import-fixture`.
  - Add `--archive-dir` optional path; default to `frontend/data/attachments` when invoked from frontend, otherwise `data/attachments` relative to current working directory.
  - Before `_upsert_bids`, enrich each bid through `archive_bid_documents` when flag is set.
  - Add concise archive summary to crawler log metadata.

- [x] **Step 4: Run GREEN**
  - Targeted pytest for changed CLI tests.

### Task 3: Frontend Runner Wiring

**Files:**
- Modify: `frontend/src/server/crawler/state-runner.ts`
- Modify: `frontend/src/server/crawler/sam-gov-runner.ts`
- Test: `frontend/src/server/crawler/state-runner.test.ts`
- Test: `frontend/src/server/crawler/sam-gov-runner.test.ts`

- [x] **Step 1: Write failing tests**
  - Assert frontend runners pass `--archive-documents` by default.
  - Assert `CRAWLER_ATTACHMENT_DIR` or an explicit option becomes `--archive-dir`.

- [x] **Step 2: Run RED**
  - `npm test -- src/server/crawler/state-runner.test.ts src/server/crawler/sam-gov-runner.test.ts`

- [x] **Step 3: Implement runner args**
  - Add `archiveDocuments?: boolean` and `archiveDir?: string` options.
  - Default `archiveDocuments` to true for state/SAM runner execution.

- [x] **Step 4: Run GREEN**
  - Targeted runner tests pass.

### Task 4: Status Docs And Verification

**Files:**
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`

- [x] **Step 1: Update status**
  - Add completed phase notes and remaining work.

- [x] **Step 2: Run full verification**
  - `npm test`
  - `PYTHONPATH=crawler python3 -m pytest crawler/tests`
  - `npm run lint`
  - `npm run build`
  - `npm run db:migrate`
  - `npm audit --omit=dev --audit-level=high`
  - `git diff --check`

- [x] **Step 3: Commit**
  - `git add ...`
  - `git commit -m "feat: archive crawler documents locally"`
