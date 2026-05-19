# APSi New York Contract Reporter Adapter Design

## Goal

Add New York State Contract Reporter as the next state live adapter in APSi, using the existing live adapter pattern with deterministic replay support and clear failure behavior for direct public-page HTTP requests.

## Confirmed Direction

Use the HTTP/replay adapter approach.

The New York State Contract Reporter provides a public contracts/opportunities entry point, but this stage will not assume a stable public JSON API. The adapter will support local `--fixture-json` replay for reliable import and testing. Direct HTTP requests to the public contracts page must fail clearly when the response is HTML or otherwise not the expected JSON shape.

## Current Context

The crawler already has:

- `Source.live_fetcher` support.
- `get_live_fetcher` and `supports_live_fetch`.
- `fetch-state` CLI with `--fixture-json`.
- CA and TX live adapters using HTTP JSON/replay contracts and strict validation.
- Existing NY fixture import under `crawler/tests/fixtures/ny_contract_reporter_opportunities.json`.
- NY source metadata with `id = "ny_contract_reporter"`, `source_label = "New York State Contract Reporter"`, and `state_code = "NY"`.

## Scope

This stage will add:

1. `crawler/apsi_crawler/spiders/ny_contract_reporter.py`.
2. NY live fetcher registration in `state_sources.py`.
3. A recorded replay fixture for NY live adapter tests.
4. Unit tests for NY adapter normalization and error paths.
5. CLI replay coverage using `fetch-state --source ny_contract_reporter --fixture-json ...`.
6. Updated unsupported-source expectations so FL or IL remains the unsupported live example.

## Non-Goals

This stage will not add:

- Browser automation for NYSCR.
- HTML parsing of NYSCR public pages.
- Login/subscriber workflows.
- Attachment/document downloading.
- Production scheduler changes.
- Changes to frontend UI.

## Adapter Behavior

The NY adapter will follow the CA/TX adapter shape:

- `fetch_ny_contract_reporter_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_json=None)`
- If `fixture_json` is provided, read the JSON file and do not perform HTTP.
- If `fixture_json` is not provided, request `https://www.nyscr.ny.gov/home/contracts`.
- Non-200 responses raise `NyContractReporterError`.
- Network exceptions are wrapped in `NyContractReporterError`.
- Non-JSON responses raise `NyContractReporterError("NY Contract Reporter response was not valid JSON")`.
- Payloads must contain an `opportunities` or `results` list, or be a top-level list.
- Unexpected payload shape raises `NyContractReporterError("NY Contract Reporter response did not contain opportunities or results")`.
- Non-object records raise `NyContractReporterError("NY Contract Reporter record was not an object")`.
- Records without a source ID raise `NyContractReporterError("NY Contract Reporter record is missing source id")`.

## Record Mapping

The adapter will preserve common replay and NYSCR-style aliases:

- Source ID: `source_bid_id`, `id`, `contractId`, `contract_id`, `ad_id`, `bid_id`
- Title: `title`, `name`, `contractTitle`
- Description: `description`, `summary`
- Category: `category`, `type`, `classification`
- Published date: `published_date`, `postedDate`, `posted_date`
- Deadline date: `deadline_date`, `dueDate`, `due_date`, `response_deadline`
- Issuer: `issuer_name`, `agency`, `department`
- URL: `source_url`, `url`, `link`

The final bid shape continues through `normalize_state_opportunity`, so NY rows use:

- `source = "New York State Contract Reporter"`
- `issuer_type = "state"`
- `state_code = "NY"`
- `dedupe_key = "ny_contract_reporter:<source_bid_id>"`

## Testing

Tests must cover:

- Registry reports NY as live-supported.
- NY fixture replay normalizes one opportunity.
- NY adapter preserves normalized aliases and alias precedence.
- Unexpected payload shape raises a NY-specific error.
- Non-object record raises a NY-specific error.
- Missing source ID raises a NY-specific error.
- HTTP failure raises a NY-specific error.
- Network exceptions are wrapped in a NY-specific error.
- Non-JSON responses raise a NY-specific error.
- `fetch-state --source ny_contract_reporter --fixture-json ...` inserts a bid and writes a success crawler log.
- A remaining state without live support, such as FL, still writes an unsupported-source failure log.

## Acceptance Criteria

- `cd crawler && python3 -m pytest` passes.
- `cd frontend && npm test` passes.
- `cd frontend && npm run lint` passes.
- `cd frontend && npm run build` passes.
- A developer can run NY replay locally through `fetch-state`.
- NY no longer appears unsupported in the live registry.
- The implementation remains honest about direct public-page HTTP behavior: non-JSON responses fail clearly until browser/HTML support is added later.

## Remaining After This Stage

After this stage, remaining adapter work will be:

1. Add FL MFMP adapter.
2. Add IL BidBuy adapter.
3. Add browser/HTML handling for portals that do not expose stable JSON.
4. Add attachment/document extraction.
5. Continue toward real SMTP/email delivery and production scheduling.
