# All-source crawler data quality

The admin **Data quality → Source data quality** page (`/admin/quality`) includes every registered federal, state, county, city, township and special-district source. An additional unknown segment retains registrations with an unrecognized jurisdiction. Filter the source table by jurisdiction or platform, then open a source to inspect its run history. The existing 50-state risk report remains on the same page with its existing API contract.

`GET /api/admin/source-data-quality` is a read-only JSON entry point for admin, operator and support readers. It returns the segmented report in `report`. It does not crawl portals, alter source approval, clean historical records or write snapshots. No migration or new configuration is required.

## Evidence and counts

- **List execution** is the latest recorded list success/failure. Successful `detail_backfill` runs do not replace an earlier list failure; their results remain visible in stored body/backlog counts and explicitly labelled run-history entries. Locked, disabled, blocked and deferred attempts do not replace the last actual execution. `lastSuccessAt` remains execution evidence for scheduling; missing bodies do not create portal failure backoff.
- **List coverage** comes from the importer's `metadata.dataQuality` manifest. Unknown or malformed evidence stays unknown; quarantined candidate records prevent a complete-list claim.
- **Content usability** is recomputed from the manifest's reconciled accepted/valid-body counts. Execution success, `enriched`, or operation counts cannot establish usable content. Verified empty requires a tenant-confirmed empty open list and no incomplete/date-filtered scope.
- **Latest run bodies** reports effective valid bodies, newly observed bodies, retained bodies and analysis-ready records separately. Retained is a subset of total valid bodies. Newly observed is total minus retained, and does not imply a detail network request occurred.
- **Stored records** checks every active, unsuppressed record. Stable source-ID prefixes attribute records to their registered sources; a unique registered label supports historical records. Ambiguous/unregistered attribution is counted separately instead of mixed into a jurisdiction average.
- **Freshness** uses the selected body's verification evidence. A database update or reimport does not refresh it. Missing timestamps remain unknown. No uniform age SLA is assumed.
- **Body backlog** separates failure, retry deferral, budget deferral, disabled/unconfigured enrichment, restricted access and unknown outcomes. Never attempted is a subset, not an additional category. The age shown is when the oldest currently pending record was first observed; it is not a claim about when that record entered a retry queue. Earliest retry comes from `enrichment.outcome.next_retry_at`.
- **Attachments** counts discovered, archived and recorded verified files using stored archive/verification evidence. It does not perform a live file/portal recheck or prove the public attachment list is complete.

Historic runs without the new manifest remain unknown. Existing stored records can still supply body and attachment evidence. N/A means the evidence or timestamp is absent; zero is reported only when it is observed or explicitly accounted for.

## Database reads and validation

The report reads only the latest execution per registered source key. Active bids are scanned with a 250-record keyset page and incremental source totals. Attachment reads are limited to each active page. Counts are full scans, not samples.

SQLite reads run in a consistent read transaction. A MySQL pool leases one connection for a repeatable-read, read-only transaction across all pages and always releases it. A caller-owned query reader/connection is left under the caller's transaction control; the response marks `readConsistency: "per_query"`, and the admin page explains that concurrent changes can affect those observations.

Offline tests cover degraded/full/unknown/verified-empty content, every jurisdiction, original body verification times, backlog reasons, multi-page totals, attachments on later pages, MySQL JSON/numeric reads, and snapshot cleanup. They do not establish current portal availability or settle historical customer batches; those require the authorized, budgeted source/record verification described in the QA assurance plan.
