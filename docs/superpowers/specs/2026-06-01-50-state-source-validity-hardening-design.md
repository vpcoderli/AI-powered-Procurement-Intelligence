# 50-State Source Validity Hardening Design

## Goal

Make the 50-state crawler coverage defensible: every state source must carry trust metadata, every ingested state bid must avoid placeholder/known-bad public URLs, and the local risk check must prove that state data is non-empty, routable, and backed by a clear source-validity status.

## Current State

The system already has:

- 50 state crawler source definitions in `frontend/src/lib/state-crawler-sources.ts`.
- Matching Python state crawler definitions in `crawler/apsi_crawler/sources/state_sources.py`.
- Dedicated parser coverage for all 50 states, with 5 verified sources and 45 beta sources.
- Source governance metadata for ingestion approval, access pattern, legal review, and owner.
- `risk:check` validation for 50-state coverage, required bid content, bid detail route lookup, local attachment download routes, account tier separation, and source ingestion governance.

The remaining gap is that a user or operator cannot yet answer, in one place, whether a state result came from an official source, an approved public aggregator fallback, or a blocked/manual source; nor can `risk:check` fail on demo/placeholder URLs such as `https://sam.gov/opp/12345/sow.pdf`.

## Proposed Approach

Use an incremental “Evidence + Health Lite” approach.

This keeps daily development deterministic and avoids making normal tests depend on live government websites. External live URL checks can be added later as an operator-run command, but the default quality gate should be local, fast, and reliable.

## Architecture

### Source Trust Metadata

Extend state source metadata with source-validity fields:

- `sourceAuthority`: `official`, `official_aggregator`, or `public_aggregator`.
- `trustStatus`: `verified`, `beta`, `fallback`, `needs_review`, or `blocked`.
- `evidenceMode`: `direct_portal`, `api`, `aggregator_page`, or `fixture_fallback`.
- `validityNotes`: short operator-facing notes explaining the source choice.

These fields should be derived from the existing registry where possible so source state stays centralized. Verified CA/TX/NY/FL/IL remain high-trust. States that currently rely on BidNet or other public fallback pages are explicitly labeled as aggregator/fallback rather than silently treated as official.

### URL Validity Rules

Add a focused validator for stored bid source URLs and attachment URLs.

The validator should:

- Accept only `http://`, `https://`, and safe local API attachment routes where appropriate.
- Reject known demo placeholders: `sam.gov/opp/12345`, `/example`, `/placeholder`, `example.com`, `localhost` in persisted production-like bid data, and empty URLs.
- Reject raw external attachment links in risk-check context when a local archive/download route is expected.
- Return structured findings instead of booleans so `risk:check` and Admin UI can show exact reasons.

### Risk Checklist Extension

Extend `createRiskChecklistReport` with two deterministic checks:

- `source-validity-metadata`: all 50 state sources have source authority, trust status, evidence mode, and validity notes.
- `state-url-validity`: every active state bid has a non-placeholder source URL; every attachment either uses the safe local download route or has an explicit archived external note accepted by the attachment service.

This check should fail on the previously reported `https://sam.gov/opp/12345/sow.pdf` issue.

### Admin Visibility

Expose the new trust metadata through `AdminDataSource` so the Admin Data Sources view can distinguish:

- official verified portals,
- beta official portals,
- public aggregator fallback,
- blocked/restricted sources,
- sources requiring manual review.

The first development slice only needs API/data availability and tests. UI polish can follow as a separate phase if the API contract is proven.

## Data Flow

1. Source registry defines 50 state sources and trust metadata.
2. Crawler imports state bids into SQLite/MySQL as before.
3. Repository maps local/archived attachments to safe download routes.
4. Risk checklist reads active state bids, source metadata, and attachments.
5. Risk checklist fails if a required state is missing, content is empty, source governance is unsafe, trust metadata is incomplete, or URLs look like placeholders/known bad data.
6. Admin APIs expose source validity fields for operator review.

## Error Handling

URL validation should not throw for malformed input. It returns findings such as:

- `empty_url`
- `invalid_url`
- `placeholder_url`
- `unsafe_external_attachment`
- `missing_source_validity_metadata`

Risk reports should include bid IDs, attachment names, and state/source IDs where possible.

## Testing

Use TDD for each behavior:

- State source tests fail first until all 50 sources expose trust metadata.
- URL validator tests fail first for `https://sam.gov/opp/12345/sow.pdf`, `example.com`, empty URL, unsafe external attachment, and valid state portal URLs.
- Risk checklist tests fail first until the new checks appear and catch placeholder URLs.
- Admin data source repository tests fail first until source validity metadata is exposed in SQLite and MySQL paths.

Regression commands:

- `npm test -- src/lib/state-crawler-sources.test.ts src/server/source-validity/url-validity.test.ts src/server/risk/checklist.test.ts src/server/admin/data-sources-repository.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run risk:check`
- `git diff --check`

## Out of Scope For This Slice

- Live HTTP checks against all 50 government websites on every test run.
- Legal determination that every public aggregator source is production-approved.
- Full Admin UI redesign.
- Downloading every external attachment during the risk check.
- Guaranteeing that government portals will never remove or change external documents after ingestion.

## Acceptance Criteria

- All 50 state sources expose source-validity metadata.
- `risk:check` fails on demo/placeholder URLs and unsafe state attachment URLs.
- `risk:check` still passes for the seeded 50-state dataset after source URLs are valid.
- Admin data source API includes the new source-validity fields.
- Documentation states that local checks prove deterministic validity and that live portal health requires a separate operator-run validation.
