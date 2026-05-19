# APSi Texas ESBD Adapter Design

## Goal

Add Texas ESBD as the second state live adapter in APSi, using the existing state adapter foundation with a stable local replay path and clear failure behavior for the public Texas SmartBuy ESBD web entry.

## Confirmed Direction

Use the HTTP/replay adapter approach.

Texas SmartBuy ESBD is a public procurement entry point, but the visible `https://www.txsmartbuy.gov/esbd` page is an HTML application rather than a documented JSON opportunities API. This stage will not claim full live HTML/JavaScript scraping. It will wire TX into the live adapter interface, support deterministic `--fixture-json` replay, normalize ESBD-style records, and fail clearly when a direct HTTP request does not return the expected JSON shape.

## Current Context

The crawler already has:

- `Source.live_fetcher` support.
- `get_live_fetcher` and `supports_live_fetch`.
- `fetch-state` CLI with optional `--fixture-json`.
- A CA reference adapter that supports HTTP JSON/replay responses, strict payload validation, and crawler log integration.
- Existing TX fixture import under `crawler/tests/fixtures/tx_esbd_opportunities.json`.
- TX source metadata with `id = "tx_esbd"`, `source_label = "Texas ESBD"`, and `state_code = "TX"`.

## Scope

This stage will add:

1. `crawler/apsi_crawler/spiders/tx_esbd.py`.
2. TX ESBD live fetcher registration in `state_sources.py`.
3. A recorded replay fixture for TX ESBD live adapter tests.
4. Unit tests for TX adapter normalization and error paths.
5. CLI replay coverage using `fetch-state --source tx_esbd --fixture-json ...`.
6. Updated unsupported-source expectations so TX is no longer treated as unsupported.

## Non-Goals

This stage will not add:

- Browser automation for Texas SmartBuy.
- HTML parsing of the ESBD single-page app.
- Attachment downloading.
- Award/no-solicitation parsing.
- Authentication or vendor account workflows.
- Production scheduler changes.

## Adapter Behavior

The TX adapter will follow the CA adapter shape:

- `fetch_tx_esbd_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_json=None)`
- If `fixture_json` is provided, read the JSON file and do not perform HTTP.
- If `fixture_json` is not provided, request `https://www.txsmartbuy.gov/esbd`.
- Non-200 responses raise `TxEsbdError`.
- Network exceptions are wrapped in `TxEsbdError`.
- Non-JSON responses raise `TxEsbdError("Texas ESBD response was not valid JSON")`.
- Payloads must contain an `opportunities` or `results` list, or be a top-level list.
- Unexpected payload shape raises `TxEsbdError("Texas ESBD response did not contain opportunities or results")`.
- Records without a source ID raise `TxEsbdError("Texas ESBD record is missing source id")`.

## Record Mapping

The adapter will preserve common replay and ESBD-style aliases:

- Source ID: `source_bid_id`, `solicitationId`, `solicitation_id`, `id`, `bid_id`
- Title: `title`, `name`, `solicitationTitle`
- Description: `description`, `summary`
- Category: `category`, `classItem`, `commodity`
- Published date: `published_date`, `postedDate`, `posted_date`
- Deadline date: `deadline_date`, `dueDate`, `due_date`, `response_deadline`
- Issuer: `issuer_name`, `agency`, `department`
- URL: `source_url`, `url`, `link`

The final bid shape continues through `normalize_state_opportunity`, so TX rows use:

- `source = "Texas ESBD"`
- `issuer_type = "state"`
- `state_code = "TX"`
- `dedupe_key = "tx_esbd:<source_bid_id>"`

## Testing

Tests must cover:

- Registry reports TX as live-supported.
- TX fixture replay normalizes one opportunity.
- TX adapter preserves normalized aliases.
- Unexpected payload shape raises a TX-specific error.
- Missing source ID raises a TX-specific error.
- HTTP failure raises a TX-specific error.
- Network exceptions are wrapped in a TX-specific error.
- `fetch-state --source tx_esbd --fixture-json ...` inserts a bid and writes a success crawler log.
- Another state without live support, such as NY, still writes an unsupported-source failure log.

## Acceptance Criteria

- `cd crawler && python3 -m pytest` passes.
- `cd frontend && npm test` passes.
- `cd frontend && npm run lint` passes.
- `cd frontend && npm run build` passes.
- A developer can run TX replay locally through `fetch-state`.
- TX no longer appears unsupported in the live registry.
- The implementation remains honest about the public ESBD HTML app: direct non-JSON HTTP responses fail clearly until browser/HTML support is added later.

## Remaining After This Stage

After this stage, remaining adapter work will be:

1. Add real browser/HTML handling for TX SmartBuy ESBD if no stable JSON endpoint is found.
2. Add NY Contract Reporter adapter.
3. Add FL MFMP adapter.
4. Add IL BidBuy adapter.
5. Add attachment/document extraction.
6. Continue toward real SMTP/email delivery and production scheduling.
