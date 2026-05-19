# APSi Admin Per-State Crawler Run Design

## Goal

Add row-level controls in the Admin data source table so an operator can run one supported state crawler at a time.

## Context

The Admin page already supports:

- Loading data sources and recent crawler logs.
- Enabling or disabling a source.
- Running all state crawlers through `runStateCrawlersNow()`.
- Calling `POST /api/crawler/state/run`, which already accepts a `sources` array and can run one or more state source ids.

The missing operator workflow is a direct action for a single state, such as rerunning only Illinois after a failed or stale import.

## Chosen Approach

Use row-level action buttons in the existing data source table.

Each supported state crawler row shows a compact Play icon button in a new `Run` column. Clicking the button calls the existing state crawler run API with:

```json
{ "sources": ["il_bidbuy"] }
```

The top-level "Run state crawlers" button remains unchanged and continues to run all supported state crawlers.

## Supported Rows

Show the row-level run button only for these source ids:

- `ca_caleprocure`
- `tx_esbd`
- `ny_contract_reporter`
- `fl_mfmp`
- `il_bidbuy`

Do not add a row-level SAM.gov button in this stage. SAM.gov has a separate route and API key requirement, so it should remain outside this state-only workflow.

## UI Behavior

- Add a new table column labeled `Run`.
- For supported state rows, show a small icon button with a Play icon.
- For unsupported rows, show `-`.
- While a row is running, disable only that row's run button and show the existing running text.
- Keep the bulk state run button disabled while the bulk run is active.
- A row run and bulk run should not be started at the same time from the UI. If any row is running, disable the bulk button; if bulk is running, disable row buttons.
- After a row run completes or fails, reload data sources and recent logs.

## API Client

Extend `runStateCrawlersNow` to accept an optional list of source ids:

```ts
runStateCrawlersNow(["il_bidbuy"])
```

When no ids are passed, keep the existing request:

```ts
fetch("/api/crawler/state/run", { method: "POST" })
```

When ids are passed, send JSON:

```ts
fetch("/api/crawler/state/run", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sources: ids }),
})
```

## Messages and Localization

Add English and Chinese strings for:

- Table column label: `Run`
- Row button label: `Run source`
- Row success message: `State crawler run completed for {source}.`
- Row failure message: `Unable to run state crawler for {source}.`

Bulk run messages remain as they are.

## Testing

Add or update unit tests for:

- Admin API client sends the existing no-body request for bulk state runs.
- Admin API client sends a JSON `sources` body for a selected state run.

Because the Admin page currently has no component test harness, rely on TypeScript build and manual browser verification for the page wiring. The UI logic should stay simple enough to be type-checked and visually inspected.

## Out of Scope

- SAM.gov row-level run button.
- Per-state query or limit input controls.
- Real-time streaming progress.
- A queue or cancel operation for running crawlers.
