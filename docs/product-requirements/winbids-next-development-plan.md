# WinBids Next Development Plan

Updated: 2026-05-30

## Recommendation

Continue with **Admin QA Batch Filters + Correction History** as the next implementation phase.

Commercial packaging and credits foundation is now in place:

- Internal tiers stay compatible as `free`, `pro`, `business`, and `enterprise`.
- Product-facing plan labels now support Free, Pursuit Starter, Response Builder, planned Growth, and Enterprise.
- Credits have a foundation for included monthly credits, purchased credits, premium action costs, refunds, and future ledger events.
- Settings Billing/Usage can surface plan names, Growth as planned, and credit summaries.

The source registry, capability metadata, archive metadata columns, quality flag foundation, public attachment/detail downloader, Admin Bid QA queue, correction audit persistence, and publish/suppress controls are now in place. The next risk is operational scale: operators can fix one record, but they still need better filters, batch actions, visible correction history, and original-vs-corrected comparison.

## Last Completed Phase

**Bid Admin/Data QA Correction + Publish Controls** made single-record QA correction actionable:

Completed locally:

- `bids` now stores `display_status` and public search/detail filters out suppressed records.
- `bid_field_corrections` preserves original/corrected values, note, reviewer id, and correction timestamp.
- Admin QA repository/API/client support review updates, display status updates, and limited field corrections.
- `/admin` displays display status and correction counts, and lets admin/operator publish, suppress, or save title/deadline corrections.
- Support remains read-only.

## Previous Completed Phase

**Admin Bid QA Console Thin Slice** made quality issues actionable from `/admin`:

Completed locally:

- `bids` stores review note, reviewed timestamp, and reviewer id.
- Admin QA repository computes quality score and summary counts from deadline, source confidence, quality flags, attachment archive status, and detail archive status.
- `/api/admin/bids/qa` lists QA records with filters for query, state, review status, and archive status.
- `/api/admin/bids/qa/[id]` lets admin/operator update review status; support remains read-only.
- `/admin` displays the Bid Data QA queue with quality score, archive issue count, review status, and quick Reviewed / Needs review actions.

## Earlier Completed Phase

**Attachment Download Archival Downloader** turned state/SAM crawler output into evidence-ready bid records:

`Source Registry -> Connector Run -> Detail/Attachment Downloader -> Quality Flags -> Admin QA -> Search/Bid Detail Evidence`

Completed locally:

- Public HTTP(S) attachments and optional detail pages are downloaded into the configured local attachment archive.
- Archive metadata records local path, byte size, content type, SHA-256 checksum, fetched timestamp, status, and failure reason.
- Non-public, login-like, CAPTCHA/browser-required, and non-HTTP URLs are marked unavailable instead of being force-fetched.
- Fetch failures mark individual attachments failed without dropping otherwise non-empty crawler runs.
- Frontend SAM.gov/state runners default to archive downloads and bid detail surfaces archive status/failure notes.

## Phase Goal

Make Admin QA efficient for operational review:

`QA Queue -> Rich Filters -> Batch Action -> Correction History -> Original/Corrected Comparison`

This phase should preserve the current crawler, archival, correction, and publish/suppress behavior while making the QA queue usable when crawler volume grows across 50 states.

## In Scope

- QA filters:
  - expand filtering by score range, source confidence, reviewer, reviewed date, and display status
- Batch actions:
  - allow selected rows to be marked reviewed, moved to needs review, published, or suppressed
- Correction visibility:
  - show original-vs-corrected values for corrected fields
  - expose correction history per bid with note/reviewer/time
- Guardrails:
  - keep support read-only
  - keep ordinary search/bid detail pages stable while QA workflow expands

## Out Of Scope

- Login-only portal automation or CAPTCHA bypass.
- Full OCR/document parsing.
- Product 2 citation UI.
- Production object storage migration.
- Broad redesign of public search/bid detail pages.

## Acceptance Criteria

- Existing 50-state crawler and archive tests remain green.
- Admin users can identify bids with failed/unavailable archive artifacts.
- Operator/admin users can correct limited fields without changing source ingestion code.
- Corrections preserve original crawler values and audit metadata.
- Suppressed records are hidden from ordinary bid search/detail surfaces.
- Operator/admin users can filter by display status, score range, reviewer, reviewed date, and source confidence.
- Operator/admin users can perform batch review/publish/suppress on selected rows.
- Admin QA exposes correction history and original-vs-corrected values.
- Search/bid detail still works for existing records.
- `npm test`, `PYTHONPATH=crawler python3 -m pytest crawler/tests`, `npm run lint`, `npm run build`, `npm run db:migrate`, and `git diff --check` pass.

## Remaining Work After This Phase

1. 50-state crawler hardening: promote beta adapters, add source quality monitoring, and document Source Registry / Connector Engine / Normalization QA responsibilities.
2. Product 2 Qualification Upgrade: citations, Q&A, amendment refresh, evidence/artifact links, no-bid taxonomy.
3. Search Alerts Full UI: per-alert CRUD, digest settings, pause/resume, notification history.
4. Production Billing / Worker Deployment Runbook: production credentials, webhook rotation, scheduled worker deployment.
5. UI/UE production polish: migrate the demo visual direction into real `/search`, `/bids/[id]`, `/admin`, and settings workflows.
6. Knowledge Station Lite as Product 0.9 workflow coaching.
7. Response Workspace Lite and Artifact Vault Lite.
8. Supply Chain and Quote Lite.
9. Deadline Notifications, Award Tracking, and Win/Loss Learning Lite.
10. Real credit consumption, advanced usage metrics, enterprise custom rules, and production AI layer.
