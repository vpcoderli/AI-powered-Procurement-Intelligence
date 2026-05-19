# APSi Florida MFMP Adapter Design

## Goal

Add MyFloridaMarketPlace as the next state live adapter in APSi, using the existing state live adapter pattern with deterministic fixture replay and the MFMP public JSON search API.

## Confirmed Direction

Use the HTTP/replay adapter approach.

MyFloridaMarketPlace is a public procurement entry point whose browser app calls a public JSON API for bid search. This stage uses that API directly with `POST /mfmp/pub/search/bids`, supports local `--fixture-json` replay for reliable import and tests, and keeps browser automation or HTML parsing out of scope.

## Current Context

The crawler already has:

- `Source.live_fetcher` support.
- `get_live_fetcher` and `supports_live_fetch`.
- `fetch-state` CLI with `--fixture-json`.
- CA, TX, and NY live adapters using HTTP JSON/replay contracts and strict validation.
- Existing FL fixture import under `crawler/tests/fixtures/fl_mfmp_opportunities.json`.
- FL source metadata with `id = "fl_mfmp"`, `source_label = "MyFloridaMarketPlace"`, and `state_code = "FL"`.

## Scope

This stage will add:

1. `crawler/apsi_crawler/spiders/fl_mfmp.py`.
2. FL live fetcher registration in `state_sources.py`.
3. A recorded replay fixture for FL live adapter tests.
4. Unit tests for FL adapter normalization and error paths.
5. CLI replay coverage using `fetch-state --source fl_mfmp --fixture-json ...`.
6. Updated unsupported-source expectations so IL remains the unsupported live example.

## Non-Goals

This stage will not add:

- Browser automation for MFMP.
- HTML parsing of MFMP public pages.
- Vendor login or authenticated workflows.
- Attachment/document downloading.
- Production scheduler changes.
- Frontend UI changes.

## Adapter Behavior

The FL adapter will follow the CA/TX/NY adapter shape:

- `fetch_fl_mfmp_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_json=None)`
- If `fixture_json` is provided, read the JSON file and do not perform HTTP.
- If `fixture_json` is not provided, `POST` the public search form payload to `https://vendor.myfloridamarketplace.com/mfmp/pub/search/bids`.
- Non-200 responses raise `FlMfmpError`.
- Network exceptions are wrapped in `FlMfmpError`.
- Non-JSON responses raise `FlMfmpError("MyFloridaMarketPlace response was not valid JSON")`.
- Payloads must contain an `opportunities` or `results` list, or be a top-level list.
- Unexpected payload shape raises `FlMfmpError("MyFloridaMarketPlace response did not contain opportunities or results")`.
- Non-object records raise `FlMfmpError("MyFloridaMarketPlace record was not an object")`.
- Records without a source ID raise `FlMfmpError("MyFloridaMarketPlace record is missing source id")`.

## Record Mapping

The adapter will preserve common replay and MFMP-style aliases:

- Source ID: `source_bid_id`, `advertisementId`, `id`, `advertisement_id`, `adNumber`, `agencyAdNumber`, `bid_id`, `solicitation_id`
- Title: `title`, `uniqueName`, `name`, `advertisementTitle`, `solicitationTitle`
- Description: `description`, `summary`
- Category: `category`, `type`, `commodity`
- Published date: `published_date`, `publishDate`, `postedDate`, `posted_date`, `advertisementDate`, `openDate`
- Deadline date: `deadline_date`, `closeDate`, `dueDate`, `due_date`, `response_deadline`, `endDate`
- Issuer: `issuer_name`, `agency`, `organization`, `department`, `buyer`
- URL: `source_url`, `url`, `link`; if none is provided, construct `https://vendor.myfloridamarketplace.com/search/bids/detail/{source_bid_id}`.

The final bid shape continues through `normalize_state_opportunity`, so FL rows use:

- `source = "MyFloridaMarketPlace"`
- `issuer_type = "state"`
- `state_code = "FL"`
- `dedupe_key = "fl_mfmp:<source_bid_id>"`

## Testing

Tests must cover:

- Registry reports FL as live-supported.
- FL fixture replay normalizes one opportunity.
- FL adapter preserves normalized aliases and alias precedence.
- Unexpected payload shape raises an FL-specific error.
- Non-object record raises an FL-specific error.
- Missing source ID raises an FL-specific error.
- HTTP failure raises an FL-specific error.
- Network exceptions are wrapped in an FL-specific error.
- Non-JSON responses raise an FL-specific error.
- Adapter-level `fixture_json` replay does not require HTTP.
- `fetch-state --source fl_mfmp --fixture-json ...` inserts a bid and writes a success crawler log.
- IL still writes an unsupported-source failure log.

## Acceptance Criteria

- `cd crawler && python3 -m pytest` passes.
- `cd frontend && npm test` passes.
- `cd frontend && npm run lint` passes.
- `cd frontend && npm run build` passes.
- A developer can run FL replay locally through `fetch-state`.
- FL no longer appears unsupported in the live registry.
- IL remains unsupported until a later adapter stage.
- The implementation uses the public JSON API directly; browser/HTML parsing remains out of scope for later portal work.

## Remaining After This Stage

After this stage, remaining adapter work will be:

1. Add IL BidBuy adapter.
2. Add browser/HTML handling for portals that do not expose stable JSON.
3. Add attachment/document extraction.
4. Add real SMTP/email delivery.
5. Add production scheduling, health alerts, and retry policy.
