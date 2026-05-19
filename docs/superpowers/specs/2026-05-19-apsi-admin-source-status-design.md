# APSi Admin Source Status Design

## Goal

Make the Admin data source table accurately show the latest crawler status and error reason for each source, including state sources whose seed data source ids differ from crawler runner ids.

## Context

The Admin page currently loads:

- Data source rows from `data_sources`.
- Recent crawler logs from `crawler_logs`.
- A per-source `latestLog` attached by `listAdminDataSources`.

The current matching only checks `latestLogsBySource.get(source.label)` and `latestLogsBySource.get(source.id)`. This works for `SAM.gov`, but not for seeded state rows such as:

- `Cal eProcure` / `cal_eprocure` vs crawler log `ca_caleprocure`
- `Texas SmartBuy` / `texas_smartbuy` vs crawler log `tx_esbd`
- `New York State Contract Reporter` / `new_york_state_contract_reporter` vs crawler log `ny_contract_reporter`
- `MyFloridaMarketPlace` / `myfloridamarketplace` vs crawler log `fl_mfmp`
- `Illinois Procurement Bulletin` / `illinois_procurement_bulletin` vs crawler log `il_bidbuy`

As a result, the recent log stream can show failures or successes while the table row still says `Not run`.

## Chosen Approach

Use Approach A: fix the server-side source-to-log mapping and improve row status display.

The Admin repository will map each data source row to its crawler log source id using state code:

- CA -> `ca_caleprocure`
- TX -> `tx_esbd`
- NY -> `ny_contract_reporter`
- FL -> `fl_mfmp`
- IL -> `il_bidbuy`

The repository will still fall back to label/id matching for existing behavior. The frontend will use `latestLog` as the single row status source.

## Data Flow

1. Admin page calls `/api/admin/data-sources`.
2. Repository loads all data source rows and crawler logs.
3. Repository builds `latestLogsBySource`.
4. For each data source row, repository resolves possible log keys:
   - mapped crawler source id by state code
   - data source label
   - data source id
5. The first matching latest log becomes `latestLog`.
6. Frontend row displays latest run time, status, counts, and a concise error reason if present.

## UI Behavior

In the data source table:

- Keep the current status badge.
- When `latestLog.errorMessage` exists, show a short error reason under the badge.
- Limit the inline error reason to avoid expanding the row too much.
- The detailed recent log list remains below the table.

Summary cards should automatically become more accurate because `healthySources` and `failingSources` already depend on `latestLog`.

## Testing

Add repository tests for `listAdminDataSources`:

- A state data source row with state code `TX` picks up a latest `tx_esbd` crawler log.
- A state row displays failure in summary when the mapped latest log failed.
- Existing direct matching for `SAM.gov` remains intact.

Add a focused frontend type/build verification for the inline error display. The Admin page does not currently have component tests, so rely on build plus browser inspection.

## Out of Scope

- Changing seed data source ids.
- Migrating existing `data_sources` ids.
- Adding a full log drawer or modal.
- Retry buttons beyond the row-level run buttons already implemented.
