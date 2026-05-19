# APSi Live State Procurement Adapters Design

## Goal

Replace the purely fixture-backed state source layer with a live adapter foundation that can fetch public state procurement opportunities in a controlled, testable way while keeping fixture imports available for offline development.

## Confirmed Direction

Use approach A: build the reusable live adapter foundation first, then implement one state as the first live reference adapter and keep the remaining states wired through explicit adapter configuration or unsupported-live stubs.

This avoids pretending all five state portals are equally simple. State procurement sites differ in public access, search forms, HTML structure, paging, and anti-automation behavior. A stable adapter contract, CLI, logging, and tests will make each later state source a small, verifiable increment.

## Current Context

The crawler already has:

- `Source` metadata for SAM.gov and five state sources.
- Fixture-backed imports for CA, TX, NY, FL, and IL.
- A shared state opportunity normalizer.
- SQLite bid upsert and crawler log writing.
- Tests that verify state fixture imports produce `issuer_type = "state"`, stable `state_code`, source labels, and dedupe keys.

The frontend/admin layer already reads `data_sources.is_enabled`, crawler logs, and imported bids. The missing piece is a live state fetch path equivalent to SAM.gov's live fetch path.

## Source Discovery Notes

Official/public source checks on May 19, 2026:

- California Cal eProcure exposes a public search page at `https://caleprocure.ca.gov/pages/search.aspx`.
- Texas Comptroller describes ESBD as the online system where state agencies post solicitations above $25,000 and says vendors can manually search it without logging in: `https://comptroller.texas.gov/purchasing/contact/outreach.php/1000`.
- New York State Contract Reporter describes itself as New York's official procurement activity site and supports browsing, filtering, and sorting contract opportunities: `https://www.nyscr.ny.gov/home/contracts`.
- Florida DEP points vendors to the MyFloridaMarketPlace Vendor Bid System main page for solicitations and notes DMS oversees MFMP: `https://floridadep.gov/waste/petroleum-restoration/content/competitive-procurement-system`.
- Illinois BidBuy has a public BidBuy portal with an "Open Bids" entry point and is described by the CPO-GS as the Procurement Bulletin for general services: `https://www.bidbuy.illinois.gov/bso/` and `https://cpo-general.illinois.gov/bidbuy.html`.

These checks identify official entry points, not stable APIs. The implementation must treat selectors and request shapes as adapter-specific details covered by tests.

## Scope

This stage will add:

1. A live adapter interface for state sources.
2. A fetch result model with normalized bids plus adapter metadata.
3. A state fetch CLI command: `fetch-state`.
4. Success and failure crawler logs for live state fetches.
5. A first live reference adapter for one state source.
6. Explicit unsupported-live behavior for state sources that are registered but not yet implemented.
7. Tests for adapter registration, CLI behavior, normalizing live payloads, and failure logging.

The first live reference adapter should prefer a source with a public endpoint that can be tested without credentials. If a stable JSON endpoint is not available, the reference adapter can parse a small, source-specific HTML response using deterministic selectors and recorded fixture HTML in tests.

## Non-Goals

This stage will not add:

- Browser automation with Playwright or Selenium for state portals.
- Login-based vendor workflows.
- CAPTCHA handling or bypass.
- Attachment downloading.
- Full live adapters for all five states in one pass.
- Production scheduling changes.
- Frontend UI redesign.

## Architecture

### Adapter Contract

Create a small state adapter contract that separates source metadata from live fetching:

- `source_id`: machine-stable ID such as `ca_caleprocure`.
- `fetch(options)`: returns raw or semi-structured records from the live source.
- `normalize(record, source)`: maps source-specific records to the shared APSi bid shape through the existing state normalizer where possible.

Adapters should return normalized bid dictionaries to the CLI. The CLI owns persistence and crawler logs, matching the existing SAM.gov and fixture import pattern.

### Registry

Extend the source registry with:

- `get_live_fetcher(source_id)`
- `supports_live_fetch(source_id)`
- clear `UnsupportedLiveSourceError` when a source is known but live fetch is not implemented

Fixture loading stays unchanged so tests and offline demos remain deterministic.

### CLI

Add:

```bash
python3 -m apsi_crawler.cli fetch-state \
  --database path/to/apsi.sqlite \
  --source ca_caleprocure \
  --limit 25
```

Optional flags:

- `--query` for keyword searches when the source supports it.
- `--limit` to cap imported records.
- `--fixture-html` or `--fixture-json` only for tests and local replay, not as the main production path.

The command writes crawler logs with `source = <source_id>` and metadata that includes `mode = "live"` and the requested limit/query.

### Reference Adapter

The first reference adapter will be chosen by implementation-time source inspection. Preference order:

1. Public JSON or simple HTTP endpoint.
2. Public HTML listing with stable links and fields.
3. Adapter skeleton only, if a site requires browser/session behavior.

The adapter must normalize at least:

- source opportunity ID
- title
- issuer/agency
- source URL
- published date when available
- deadline date when available
- description/category when available

## Error Handling

- Unknown source returns a clear CLI error and non-zero exit.
- Known source without live support raises `UnsupportedLiveSourceError`, writes a failure crawler log, and exits non-zero.
- HTTP errors raise a typed adapter error, write a failure crawler log, and preserve a concise error message.
- Empty live results are allowed and logged as success with `fetched_count = 0`.
- Malformed records are skipped only if the adapter can report skipped count; otherwise the fetch fails to avoid silent data loss.

## Testing

Python tests must cover:

- Live fetcher registry returns support status for implemented and unsupported state sources.
- `fetch-state` imports normalized bids for the reference adapter from recorded HTTP/HTML data.
- `fetch-state` writes success crawler logs with mode metadata.
- Unsupported live state source writes a failure crawler log and exits non-zero.
- HTTP failure writes a failure crawler log and exits non-zero.
- Existing fixture import tests continue to pass unchanged.

## Acceptance Criteria

- `cd crawler && python3 -m pytest` passes.
- Existing frontend tests/build remain unaffected unless a TypeScript runner is updated.
- A developer can run `fetch-state` locally for the implemented reference state.
- Fixture imports still work for all five existing state sources.
- Admin/source health can see live state fetch logs through the existing crawler log flow.
- At least one state source has a real live adapter path or a replayable public-response adapter tested through the live adapter interface.

## Remaining After This Stage

After this stage, remaining functional work will be:

1. Add live adapters for the other state portals one by one.
2. Add browser automation only for portals that cannot be reliably fetched with HTTP.
3. Add attachment/document extraction.
4. Add production scheduler configuration for state sources.
5. Add source-specific health thresholds and alerting.
6. Continue with real SMTP/email provider after state adapter coverage starts producing useful data.
