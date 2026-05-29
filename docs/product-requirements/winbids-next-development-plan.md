# WinBids Next Development Plan

Updated: 2026-05-29

## Recommendation

Continue with **Bid Admin/Data QA Console Expansion** as the next implementation phase.

Commercial packaging and credits foundation is now in place:

- Internal tiers stay compatible as `free`, `pro`, `business`, and `enterprise`.
- Product-facing plan labels now support Free, Pursuit Starter, Response Builder, planned Growth, and Enterprise.
- Credits have a foundation for included monthly credits, purchased credits, premium action costs, refunds, and future ledger events.
- Settings Billing/Usage can surface plan names, Growth as planned, and credit summaries.

The source registry, capability metadata, archive metadata columns, quality flag foundation, and public attachment/detail downloader are now in place. The next risk is operator trust and correction workflow: support/operator/admin users need a clear way to filter low-confidence records, inspect archive failures, correct metadata, and decide what is publishable.

## Last Completed Phase

**Attachment Download Archival Downloader** turned state/SAM crawler output into evidence-ready bid records:

`Source Registry -> Connector Run -> Detail/Attachment Downloader -> Quality Flags -> Admin QA -> Search/Bid Detail Evidence`

Completed locally:

- Public HTTP(S) attachments and optional detail pages are downloaded into the configured local attachment archive.
- Archive metadata records local path, byte size, content type, SHA-256 checksum, fetched timestamp, status, and failure reason.
- Non-public, login-like, CAPTCHA/browser-required, and non-HTTP URLs are marked unavailable instead of being force-fetched.
- Fetch failures mark individual attachments failed without dropping otherwise non-empty crawler runs.
- Frontend SAM.gov/state runners default to archive downloads and bid detail surfaces archive status/failure notes.

## Phase Goal

Give operations users a data QA surface:

`Crawler Logs -> Quality Filters -> Bid Review Queue -> Correction / Publish Confidence -> Evidence Links`

This phase should preserve the current crawler and archival behavior while making quality issues actionable from the admin console.

## In Scope

- Admin data QA queue:
  - list recently imported bids with source, quality flags, archive status, and review status
  - filter by source, state, archive failed/unavailable, stale detail page, and low confidence
  - drill into attachment/detail archive metadata and crawler log context
- Review/correction workflow:
  - mark reviewed, needs correction, suppressed/unpublished, or published
  - edit a limited set of normalized fields such as title, deadline, issuer, amount, category, and source URL
  - record audit notes and reviewer metadata
- Data quality scoring:
  - derive a compact score from required fields, deadline validity, source confidence, attachment/detail archive state, and crawler flags
  - expose score in admin list and bid detail metadata
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
- Operator/admin users can review and update QA status without changing source ingestion code.
- Corrections preserve an audit trail and do not erase original crawler metadata.
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
