# Jurisdiction Batch Run + Date Window Design

Date: 2026-08-21
Status: approved

## Requirement

Admin can batch-trigger crawler runs grouped by jurisdiction level (federal / state / county / city / special district), with a selectable data time window (all / last 7 / 30 / 90 days / custom from-to). The window filters fetched bids by published date.

Decisions made with the user:

- "时间周期" = **data time window** on bid published dates, not scheduling cadence.
- Execution = **frontend chunked batches + live per-source progress**, reusing the existing manual run route. No new queue infrastructure.

## Architecture

No new routes, no new tables. Three touch points:

1. **`/api/crawler/state/run`** (existing): drop the `issuerType === "state"` filter so county / city / special-district `data_sources` rows are runnable; add optional `postedFrom` / `postedTo` (`yyyy-mm-dd`) body fields, validated (format + `from <= to`), passed through `runCrawlerSourceOnce` → `buildCrawlTaskPayload` into the fetch-task JSON as a new optional `date_range: {from, to}` field. Governance semantics unchanged: unapproved sources still come back `blocked`.
2. **Python `fetch-task`**: after adapter fetch + normalization, filter bids by `published_date` within the window. Tolerant date parsing (`M/D/YYYY`, `MM/DD/YYYY`, ISO date, ISO datetime). **Fail-open**: bids with missing or unparseable published dates are KEPT (never silently dropped because we cannot parse a portal's format); the run payload reports `dateFilter: {from, to, kept, dropped, unparsed}` so the effect is fully transparent in the UI.
3. **SAM.gov**: the existing `/api/crawler/sam-gov/run` route already accepts `postedFrom`/`postedTo` natively (MM/dd/yyyy); the UI converts the same window and calls it for the federal-level entry.

## Admin UI (existing crawler section of /admin)

- Jurisdiction level filter chips with per-level source counts, plus a state dropdown filter.
- Source checkbox list with select-all-visible; one Run button for the selection.
- Time window select: all / last 7 / last 30 / last 90 days / custom from-to date inputs.
- Runner: chunks of 5 sources per request, sequential; per-source live status (success with fetched + filter counts / failure / blocked / locked / disabled) and an aggregate progress line.
- All new copy goes into the en/zh dictionaries (`i18n:check` gate).

## Testing

- Route: postedFrom/postedTo validation (bad format, from > to → 400), passthrough, county/city sources now resolvable.
- `buildCrawlTaskPayload` includes `date_range` when options carry a window.
- Python: date parser formats, inclusive window edges, from-only / to-only, fail-open for unparseable, `dateFilter` metadata counts; fetch-task contract guard tests updated for the new optional field.
- Admin UI: filter + selection + batch runner behavior; API helper params.
- No new route ⇒ the four structural coverage-test registries stay untouched.

## Out of scope

- Backfilling historical archives for state portals (portals only publish currently-open bids; the window filters what is fetched).
- Batch cadence editing, async queue infrastructure.
