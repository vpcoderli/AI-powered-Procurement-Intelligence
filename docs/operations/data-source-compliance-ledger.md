# Data Source Compliance Ledger

## Purpose

APSi's crawler ingests bid data from ~50 state procurement portals plus SAM.gov. Before any source is used in production, it needs a recorded legal/compliance review: has someone checked the portal's Terms of Service (ToS) and robots.txt, and is there a documented basis for crawling it?

This document defines the compliance ledger: what fields exist, what "approved" requires, who signs off, and how the ledger is tracked. It also defines the automated robots.txt pre-check tool that feeds triage signal into the ledger.

**This tooling supports the legal review process. It does not replace it.** No script in this repository can determine whether crawling a given state portal is legally permissible. That determination requires a human (ideally with legal input) to read the portal's Terms of Service and robots.txt and record a decision. Everything described below exists to make that human review trackable, auditable, and repeatable — not to automate it away.

## Where the ledger lives

The ledger is the `data_sources` table (Drizzle schema: `frontend/src/server/db/schema.ts`, export `dataSources`), extended in this pass with compliance-specific columns:

| Column | Type | Meaning |
|---|---|---|
| `robots_txt_status` | text | Latest automated robots.txt scan result: `clear`, `disallow_all`, `disallow_crawled_paths`, `not_found`, `unreachable`, `unknown`. Set only by the automated scan tool, never by a human. |
| `robots_txt_checked_at` | text (ISO datetime) | When the automated scan last ran for this source. |
| `robots_txt_hash` | text | SHA-256 hash of the fetched robots.txt body, for change detection between scans. |
| `robots_txt_disallows_crawled_paths` | integer (boolean) | Whether the scan found a Disallow rule overlapping APSI's crawled paths. |
| `robots_txt_flag_reason` | text | Human-readable reason the scan flagged this source, if any. |
| `tos_reviewed` | integer (boolean) | **Human-entered.** Whether a person has read this source's Terms of Service (or confirmed none exists / none applies) and recorded a decision. |
| `tos_reviewed_at` | text (ISO datetime) | When the ToS review was last recorded. Auto-stamped when any compliance ledger field changes, unless explicitly provided. |
| `tos_url` | text | **Human-entered.** URL of the ToS document that was reviewed, if one exists. |
| `compliance_reviewer` | text | **Human-entered.** Name or identifier of the person who performed the review. |
| `legal_opinion_reference` | text | **Human-entered.** Reference/link to a legal opinion, ticket, or memo backing the decision, if one was produced. Not required for every source (see "Approval tiers" below), but required for any source flagged by the robots.txt scan or otherwise ambiguous. |
| `compliance_review_due_at` | text (ISO datetime) | **Human-entered.** Next scheduled re-review date (ToS terms and robots.txt can change). |
| `compliance_notes` | text | **Human-entered.** Free-text notes: caveats, rate-limit agreements, contact info for the portal owner, etc. |

These sit alongside the pre-existing governance columns on the same table (`approval_status`, `legal_review_status`, `approved_for_ingestion`, `source_owner`, `approval_notes`, `access_pattern`) and the audit trail table `source_approval_events`. The compliance ledger fields are a more specific, legally-focused layer on top of that existing governance layer — they do not replace it. `legal_review_status` (`approved_public` / `not_reviewed` / `restricted`) remains the coarse-grained gate used elsewhere in the product (e.g. default governance metadata in `frontend/src/lib/state-crawler-sources.ts`); the new fields make the *evidence* behind that status auditable.

Every write to a compliance ledger field through the Admin API goes through the same code path as the existing governance fields (`updateAdminDataSource` / `updateAdminDataSourceFromMysql` in `frontend/src/server/admin/data-sources-repository.ts`), gated behind `admin`-role access, and stamps `last_approval_reviewed_at`. There is currently no separate structured audit-event row per compliance-field change (unlike `source_approval_events` for approval status changes) — `compliance_notes` and `tos_reviewed_at` are the change record. If per-field audit history becomes necessary, extend `source_approval_events` or add a sibling `source_compliance_events` table following the same pattern, rather than inventing a new mechanism.

## What "approved" requires

A source is considered **ledger-approved** for production crawling only when **all** of the following are true:

1. `tos_reviewed = true`, recorded by a named human reviewer (`compliance_reviewer` is set).
2. The most recent robots.txt scan (`robots_txt_status`) is not `disallow_all` or `disallow_crawled_paths` — or, if it is, there is an explicit `legal_opinion_reference` documenting why crawling proceeds anyway (e.g. a negotiated agreement, a public-records-law basis, or a determination that the disallowed path isn't actually crawled).
3. `compliance_review_due_at` is set to a real future re-review date (recommended: 12 months out, or sooner if the portal's ToS changes frequently or the source is high-risk).
4. For any source where `robots_txt_status` was ever `disallow_all`, `disallow_crawled_paths`, or `unreachable` at time of review, `legal_opinion_reference` is required, not optional.

A "clear" automated robots.txt scan result is a favorable signal, not a substitute for step 1. **Every source requires a recorded ToS review before first production crawl, regardless of what the robots.txt scan says.** robots.txt governs crawler behavior; it says nothing about the legal terms under which the site's data may be used, stored, or redistributed — that's what the ToS review is for.

## Who signs off

- **Data Ops / Source Ops** (see `docs/operations/source-health-check.md` for the parallel operational-health ownership model) is responsible for running the automated robots.txt pre-check and keeping `robots_txt_*` fields current.
- **A named human reviewer** (recorded in `compliance_reviewer`) is responsible for reading the ToS and recording the `tos_reviewed` decision. This does not need to be a lawyer for straightforward public-portal cases, but:
- **Legal / outside counsel** review and a `legal_opinion_reference` are required whenever: the robots.txt scan flagged the source, the ToS contains an anti-scraping/anti-automated-access clause, the portal requires a login or vendor account, or the source is otherwise ambiguous.
- **Product/Engineering leadership** signs off on the overall go/no-go to enable a source for production ingestion, referencing the ledger state at the time of the decision (this can be a launch checklist entry, not a new tool).

None of these roles are filled by this tooling. The tooling's job ends at "here is the current signal and the current recorded human decision, side by side, for every source."

## Automated robots.txt pre-check

`frontend/scripts/source-compliance-scan.ts` fetches `robots.txt` for each active state source's base URL, computes a SHA-256 hash of the body, and flags sources whose robots.txt:

- Disallows all paths (`Disallow: /` under an applicable user-agent block), or
- Disallows a path that overlaps with paths APSI is known to crawl (bid listings, search, procurement, opportunity, API paths — see `DEFAULT_CRAWLED_PATH_HINTS` in `frontend/src/server/source-validity/robots-compliance-scan.ts`).

This is a **triage signal, not a legal determination**:

- It does not parse or evaluate Terms of Service text at all.
- Its robots.txt parser is intentionally minimal (no `Allow` precedence resolution, simple substring path matching) — good enough to flag likely-restrictive sources for human attention, not good enough to be treated as a compliance engine.
- A "clear" result only means the scanner didn't find an obvious blanket or path-specific disallow rule. It does not mean the source is approved, and it does not stand in for the required ToS review.

### Running it

```bash
cd frontend
npm run source:compliance:scan -- --all --timeout-ms 10000 --report-only
npm run source:compliance:scan -- --source CA --report-only
npm run source:compliance:scan -- --all --persist
npm run source:compliance:ops   # persist + report-only alias for scheduled/operator runs
```

Options mirror `source:health:check` (see `docs/operations/source-health-check.md` for the parallel tool): `--source` (repeatable), `--timeout-ms`, `--persist`/`--write-snapshot`, `--report-only`, `--json`, `--help`.

`--persist` writes a snapshot row to `source_compliance_snapshots` (SQLite or MySQL, following the same runtime-detection pattern as `source_health_snapshots`). It does **not** write to the per-source `data_sources.robots_txt_*` columns automatically — that sync step is intentionally left as an explicit follow-up (see "Known gap" below) so that a robots.txt scan alone can never silently change a source's ledger state.

### Reading the ledger report

```bash
cd frontend
npm run source:compliance:report -- --format=markdown
npm run source:compliance:report -- --format=json --output reports/source-compliance.json
npm run source:compliance:report -- --format=csv --output reports/source-compliance.csv
```

`source-compliance-report.ts` reads the latest persisted `source_compliance_snapshots` row plus the current `data_sources` ledger fields and produces a combined per-source view: robots.txt status/flag reason from the last scan, alongside the human-entered ToS review fields. It does not call any public portal.

## Admin UI

The Admin Data Sources view (`frontend/src/app/admin/page.tsx`, `/admin` route, Data Sources section) shows a "Compliance ledger" panel per source alongside the existing governance/approval badges: robots.txt status badge, ToS-reviewed badge, flag reason (if any), reviewer, legal opinion reference, and next review due date. This reuses the existing table-row governance UI pattern rather than a new page. Updates to these fields go through `PATCH /api/admin/data-sources/[id]`, gated to `admin`-role users (the same gate as the existing approval-status fields, since compliance sign-off is at least as sensitive).

## Cadence

- **Before enabling any new source for production crawling**: run the robots.txt scan for that source, then require a human ToS review and `compliance_reviewer` entry before setting `approved_for_ingestion = true`.
- **Quarterly**: re-run `npm run source:compliance:ops` across all active sources to catch robots.txt changes (hash comparison via `robots_txt_hash` makes silent changes visible).
- **On `compliance_review_due_at` expiry**: re-review the ToS for that source; portals do change their terms.
- **Whenever a source is escalated from beta to production-critical, or a state portal switches to a login-required or vendor-account access pattern**: treat as a new source for compliance purposes and re-run the full review.

## Known gaps / explicit human follow-ups

1. **Actual legal review and ToS sign-off for each of the ~50 state sources (plus SAM.gov) is a real legal task outside the scope of what this code can determine.** As of this writing, none of the `tos_reviewed`, `compliance_reviewer`, or `legal_opinion_reference` fields have been populated for any source — the schema and tooling exist, but the review itself has not been performed. This is the single largest follow-up from this workstream and should be tracked as its own project, likely involving outside counsel, before the affected sources are relied upon commercially at scale.
2. **The robots.txt scan does not automatically write back to `data_sources.robots_txt_*`.** Today it only persists to `source_compliance_snapshots`. A follow-up (either a small script or an extension of `source-compliance-scan.ts`) should sync the latest per-source scan result onto the `data_sources` row so the Admin UI badge reflects the most recent scan without a human manually copying values. This was left as a deliberate gap rather than auto-writing during this pass, to avoid the scan tool silently mutating ledger state that a human should be reviewing.
3. **The robots.txt parser is intentionally minimal** and should not be extended into a general-purpose robots.txt compliance engine; if more precision is needed later (e.g. full `Allow`/`Disallow` precedence, wildcard/`$` support, crawl-delay handling), treat that as a separate scoped change, not a silent expansion of what this tool is trusted to decide.
4. **No per-field audit trail exists yet for compliance ledger changes** (unlike `source_approval_events` for approval-status changes). If regulatory or audit requirements demand a full history of who changed what and when on the compliance fields, add a `source_compliance_events` table mirroring `source_approval_events` rather than relying on `compliance_notes` free text.
5. **SAM.gov and other non-state-portal sources** (see `crawler/apsi_crawler/sources/registry.py` and the federal adapter) are in scope for the same ledger but were not specifically audited in this pass; confirm they're represented in `data_sources` with the same compliance fields before assuming full coverage.
