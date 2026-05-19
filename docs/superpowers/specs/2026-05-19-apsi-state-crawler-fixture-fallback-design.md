# APSi State Crawler Fixture Fallback Design

## Goal

Make the local "Run crawler" flow reliably import usable CA/TX/NY/FL/IL state bid data even when public state portals reject, timeout, or return non-JSON responses.

## Chosen Approach

Use a conservative live-first fallback. The crawler still tries each real state portal first. If the live request or parser fails and fallback is enabled, the CLI replays a bundled demo fixture for that source, imports the normalized bids, and writes a success log with metadata that records:

- `fallback_fixture`: the fixture file path.
- `fallback_reason`: the original live error message.
- `fallback_source`: `bundled_demo_fixture`.

This keeps the local product demo and end-to-end data flow working while preserving enough operational context to understand that the run used fallback data.

## Alternatives Considered

1. Live-only hard failure: operationally honest, but leaves local demos with empty data whenever a state portal blocks automated access.
2. Fixture-only demo mode: very stable, but no longer exercises live adapters.
3. Live-first fallback: best current fit because it tests live adapters first and only falls back on failure.

## Scope

Included:

- A Python CLI flag to enable bundled fallback fixtures for `fetch-state`.
- Bundled fixture resolution for CA/TX/NY/FL JSON and IL HTML.
- Frontend state crawler runner support for passing the fallback flag.
- Tests for CLI fallback behavior and frontend runner arguments.

Not included:

- Replacing the state-specific live adapters with full browser automation.
- Adding larger production datasets.
- Changing SAM.gov behavior.

## Error Handling

If live fetch fails and a bundled fixture exists, the run succeeds with fallback metadata. If fallback is disabled, the current failure behavior remains unchanged. If fallback is enabled but the source has no bundled fixture, the original failure behavior remains unchanged.

## Testing

The implementation must prove:

- A live adapter failure can fall back to a bundled JSON fixture and import CA data.
- IL can fall back to bundled HTML and import a normalized BidBuy record.
- Existing failure logging still happens when fallback is not enabled.
- The frontend state runner passes the fallback flag when requested.
- Full Python crawler tests and frontend test/build checks pass.
