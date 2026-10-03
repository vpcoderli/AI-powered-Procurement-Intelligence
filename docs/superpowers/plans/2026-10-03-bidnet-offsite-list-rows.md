# BidNet off-site list rows — implementation plan

Date: 2026-10-03. Found by the phase-3 live-run acceptance (`docs/operations/local-source-approval.md` §8): three approved BidNet sources — `bidnet_co_victor`, `bidnet_ny_milton_town`, `bidnet_nc_spruce_pine` — fail every run with `CrawlerPersistenceError: … Data too long for column 'id'`.

Root cause: the tenant's list page carries an agency announcement with a link titled "How to use Bidnet Direct" that points to an Outlook safelinks URL (`https://<x>.safelinks.protection.outlook.com/?url=…&data=…`, ~500 characters). The Scrapling sidecar's item selector returns it as a list item without a `source_bid_id`, so `_record_from_item` uses the URL as the id and the normalizer builds `id = "<source>:<url>"` (≈ 500 characters). The page's own reader (`list_adapter.page_reader`) reads no row there, so `run_paginated_list_extraction` takes the `unreadable_page` branch, which keeps sidecar rows, and the bid reaches the importer, where MySQL's `VARCHAR(191)` id rejects it and the whole run's transaction fails. Without that row the page should resolve as a verified empty list (the reader reads no listing row there; the controller's live check confirms it). The same row on a tenant that also lists real bids would fail that tenant's run too.

**Branch:** `fix/bidnet-offsite-list-rows` from local `main` (8897029). Merge back locally only (no push).

## Global constraints

- **Merge-clean against uncommitted work of another session.** The main checkout is on `codex/data-usability-20261001` (same base 8897029) with large uncommitted changes in `crawler/apsi_crawler/{list_extraction.py, cli.py, normalizers/*, enrichment.py, storage/sqlite.py, …}` and in most existing `crawler/tests/*.py`. Never read from or write to the main checkout; work only in this worktree. Keep every hunk of this change away from that work:
  - `crawler/apsi_crawler/list_extraction.py`: do not modify (or insert lines directly next to) main's lines 20–30 (imports), 210–260 (`_record_from_item`, `normalize_list_items`, `_host`), 430–510 (`_page_bids`, `_fetch_paginated_page`, the `def _raise_empty_first_page` line and its body), 585–615 (the `unreadable_page` block and the `new_bids` dedupe lines). New helpers go between `_list_date` and `resolve_pagination_request` (main ≈ L344–352); call-site changes go right after the `_page_bids(...)` call (main ≈ L570–573) and after `stats = _stats(...)` (main ≈ L643–650); the walk's docstring may change.
  - `crawler/apsi_crawler/cli.py`: only the verified-empty branch's `metadata["listExtraction"] = {…}` block (main ≈ L387–391).
  - `crawler/apsi_crawler/errors.py` may change (the other session did not touch it).
  - Do not edit any existing test file. New tests go in a new file `crawler/tests/test_list_offsite_rows.py` (copy small helpers into it rather than importing them from other test modules).
  - Docs: `CLAUDE.md` and `docs/operations/bid-lifecycle-and-crawl-budget.md` may change; do not edit `docs/architecture/crawler-enrichment-flow.md` or `docs/operations/source-discovery.md`.
- Python stdlib + `requests` only. Run the crawler suite from `crawler/` with `/Users/sakya/workspace/AI-powered-Procurement-Intelligence/services/scrapling-extractor/.venv/bin/python -m pytest -q` (Python 3.12; baseline on main: 855 passed).
- Tests are offline. Use the fixtures already in `crawler/tests/fixtures/` (`bidnet_erie_no_open_bids.html`, `bidnet_denver_open_bids_2026_09_24.html`, `bidnet_denver_closed_bids_2026_09_24.html`). Off-site URLs in tests are synthetic: no real e-mail address, tenant id or token (real safelinks URLs carry the recipient's address in `data=`).
- Commits: explicit pathspecs; never stage `.DS_Store`, `ops-evidence/`, `data/`, `frontend/data/`; **no `Co-Authored-By` trailer**.

## Task 1 — discard off-site rows the page's reader never read

Files: `crawler/apsi_crawler/list_extraction.py`, `crawler/apsi_crawler/errors.py`, `crawler/apsi_crawler/cli.py`, new `crawler/tests/test_list_offsite_rows.py`, `CLAUDE.md`, `docs/operations/bid-lifecycle-and-crawl-budget.md`.

1. In `run_paginated_list_extraction`, right after each page's `_page_bids(...)` call and before the empty-first-page check, drop every row that both
   - was not read by that page's own reader — its `source_bid_id` is not among the `source_bid_id`s of `reading.records` — and
   - links to a different site than the fetched page: compare the host of the row's `source_url` with the host of that page's `final_url`, both lower-cased with one leading `www.` removed; the same site means equal, or either host is a subdomain of the other (`a.example.com` vs `example.com`). A row whose `source_url` has no parseable host is never dropped.

   A reader-read row is never dropped, wherever it links. Sidecar-only rows on the portal's own site keep today's behaviour (kept; they still block `complete`). Adapter mode is unaffected in practice (its rows are the reader's own). The single-page `run_list_extraction` is unchanged.
2. Dropped rows never reach `bids`, `seen_ids`, the per-page coverage comparison (`page_ids`) or the unique-count check. Count them over the whole walk; when the count is above zero the returned `metadata.listExtraction` stats carry `"discarded_offsite_rows": <count>` — the key is absent when nothing was dropped, so every existing exact-dict assertion stays valid.
3. Page 1 with no rows left after the drop and no reader rows goes through the existing `_raise_empty_first_page` exactly as today (a verified empty list, or `ListPageReadError` for a positive printed total / an unreadable page). `VerifiedEmptyListError` gains an attribute `discarded_offsite_rows` (constructor keyword, default `0`; `as_metadata()` unchanged); the walker sets it on the error raised by `_raise_empty_first_page` (catch and re-raise at the call site — do not change `_raise_empty_first_page`). In `fetch_task`'s verified-empty branch, `metadata["listExtraction"]` gains `"discarded_offsite_rows": <count>` only when the count is above zero.
4. Add a bullet to the walk's docstring (near "every page's row ids exactly match …") saying what is discarded and why it cannot hide a real listing row the reader missed: the unique-count check against page 1's printed total and the empty-first-page rules (positive printed total ⇒ never empty; visible "no open bids" copy + tenant confirmation required) still guard `complete` and the empty state.
5. Tests in the new file (each must fail on main where it exercises new behaviour — confirm RED before the fix):
   - Erie empty page + scrapling-mode extractor returning one item: no `source_bid_id`, a synthetic safelinks-shaped URL longer than 191 characters, title "How to use Bidnet Direct" → `VerifiedEmptyListError` with `tenant_confirmed is True`, `method == "scrapling"`, pagination `complete is True`, `discarded_offsite_rows == 1`.
   - A consistent two-page Denver closed walk (rewrite both pages' printed total to the walk's unique count, as the existing pagination tests do) whose page-1 sidecar items are the real rows plus one off-site item → the off-site row is not in `bids`, `complete is True`, stats `discarded_offsite_rows == 1`.
   - The same walk with no off-site item → stats have no `discarded_offsite_rows` key.
   - A sidecar item carrying a reader-read `source_bid_id` but an off-site URL is kept.
   - A sidecar-only item on the portal's site written without `www.` (`https://bidnetdirect.com/...` against a page at `https://www.bidnetdirect.com/...`) is kept, and the walk stays incomplete as today.
   - The host comparison: equal hosts, `www.` variants and subdomains count as the same site; a different registrable site does not; an empty/unparseable URL is never dropped.
   - CLI level: `fetch_task` on a verified-empty page with one off-site sidecar item answers `status == "success"`, `bids == []`, `metadata.emptyState.verified is True`, `metadata.listExtraction.discarded_offsite_rows == 1`, `metadata.pagination.complete is True`. Follow how the existing CLI tests stub the list adapter, extractor and environment (`crawler/tests/test_fetch_task_cli.py`, read-only reference).
6. Docs: in `CLAUDE.md`'s "List extraction & local-source approval" paragraph, where the verified empty state is defined ("yields zero parsed rows on both the sidecar and the adapter parser"), say that sidecar rows the page's own reader never read and that link off the portal's site are discarded first and counted in `metadata.listExtraction.discarded_offsite_rows`; mention the discard in the "Paged BidNet lists" paragraph's `complete` description only if a sentence there becomes inaccurate. In `docs/operations/bid-lifecycle-and-crawl-budget.md` (Chinese), add one sentence next to the `unreadable_page` row saying such off-site rows are discarded before that check and where the count shows up.

## Out of scope (follow-up for the data-usability work)

A single over-long id still fails a whole MySQL run. The importer-side defence — quarantine a row whose `id`/`source_bid_id`/`dedupe_key` exceeds the column width instead of failing the transaction — belongs to the semantic gate of the other session's uncommitted data-usability work (`frontend/src/server/crawler/data-quality.ts`, `crawler/apsi_crawler/data_quality.py`) and is reported to the user rather than implemented here.

## Task 2 — phase-3 live-run record (controller)

Add `## 阶段 3 首轮实测（2026-09-29 – 2026-10-03）` to `docs/operations/local-source-approval.md`: approval counts, acceptance results, the WAF challenge and its pause/resume, the off-site row failure and this fix, and what was not verified.

## Controller steps

1. Task 1 via implementer → task review → fix loop.
2. Task 2 written by the controller (it holds the run's numbers).
3. Final review, full crawler suite; verify the merge stays clean against the other session's uncommitted diff (apply that diff on top of the branch in a scratch worktree with `git apply --3way --check`); a live `fetch-task` for the three sources (one request each, spaced) through the fixed CLI and the running sidecar, no persistence.
4. Fast-forward local `main`; no push.
