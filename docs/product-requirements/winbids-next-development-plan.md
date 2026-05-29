# WinBids Next Development Plan

Updated: 2026-05-30

## Recommendation

Continue with **Bid Admin/Data QA Correction + Publish Controls** as the next implementation phase.

Commercial packaging and credits foundation is now in place:

- Internal tiers stay compatible as `free`, `pro`, `business`, and `enterprise`.
- Product-facing plan labels now support Free, Pursuit Starter, Response Builder, planned Growth, and Enterprise.
- Credits have a foundation for included monthly credits, purchased credits, premium action costs, refunds, and future ledger events.
- Settings Billing/Usage can surface plan names, Growth as planned, and credit summaries.

The source registry, capability metadata, archive metadata columns, quality flag foundation, public attachment/detail downloader, and Admin Bid QA queue are now in place. The next risk is safe correction and publish control: operators can now find low-quality records, but they still need a controlled way to correct fields, preserve original crawler values, and suppress or publish records.

## Last Completed Phase

**Admin Bid QA Console Thin Slice** made quality issues actionable from `/admin`:

Completed locally:

- `bids` now stores review note, reviewed timestamp, and reviewer id.
- Admin QA repository computes quality score and summary counts from deadline, source confidence, quality flags, attachment archive status, and detail archive status.
- `/api/admin/bids/qa` lists QA records with filters for query, state, review status, and archive status.
- `/api/admin/bids/qa/[id]` lets admin/operator update review status; support remains read-only.
- `/admin` displays the Bid Data QA queue with quality score, archive issue count, review status, and quick Reviewed / Needs review actions.

## Previous Completed Phase

**Attachment Download Archival Downloader** turned state/SAM crawler output into evidence-ready bid records:

`Source Registry -> Connector Run -> Detail/Attachment Downloader -> Quality Flags -> Admin QA -> Search/Bid Detail Evidence`

Completed locally:

- Public HTTP(S) attachments and optional detail pages are downloaded into the configured local attachment archive.
- Archive metadata records local path, byte size, content type, SHA-256 checksum, fetched timestamp, status, and failure reason.
- Non-public, login-like, CAPTCHA/browser-required, and non-HTTP URLs are marked unavailable instead of being force-fetched.
- Fetch failures mark individual attachments failed without dropping otherwise non-empty crawler runs.
- Frontend SAM.gov/state runners default to archive downloads and bid detail surfaces archive status/failure notes.

## Phase Goal

Give operations users safe correction and publish controls:

`QA Queue -> Field Correction -> Original Value Preservation -> Publish / Suppress -> Evidence Links`

This phase should preserve the current crawler, archival, and QA queue behavior while allowing limited correction and display-state decisions without losing original crawler evidence.

## In Scope

- Correction workflow:
  - edit limited normalized fields: title, deadline, issuer, amount, category, source URL, and contact fields
  - preserve the original crawler value for every corrected field
  - record correction note, reviewer id, and timestamp
- Publish controls:
  - add display status such as `pending_qa`, `published`, and `suppressed`
  - keep public search/bid detail from showing suppressed records
  - allow admin/operator to publish or suppress from the QA row
- QA filters:
  - expand filtering by score range, source confidence, reviewer, reviewed date, and display status
- Guardrails:
  - preserve original crawler values where corrections are applied
  - keep ordinary search/bid detail pages stable while QA workflow is added

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
- Search/bid detail still works for existing records.
- `npm test`, `PYTHONPATH=crawler python3 -m pytest crawler/tests`, `npm run lint`, `npm run build`, `npm run db:migrate`, and `git diff --check` pass.

## Remaining Work After This Phase

1. Product 2 Qualification Upgrade: citations, Q&A, amendment refresh, evidence/artifact links, no-bid taxonomy.
2. Knowledge Station Lite as Product 0.9 workflow coaching.
3. Response Workspace Lite and Artifact Vault Lite.
4. Supply Chain and Quote Lite.
5. Deadline Notifications and Search Alerts UI.
6. Submission Guidance Completion.
7. Award Tracking and Learning Lite.
8. Production Billing / Worker Deployment Runbook.
9. Product 6 data capture only; full intelligence remains post-MVP.
