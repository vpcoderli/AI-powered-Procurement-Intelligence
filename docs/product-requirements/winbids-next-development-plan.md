# WinBids Next Development Plan

Updated: 2026-05-30

## Recommendation

Continue with **Product 2 Qualification Evidence Citations v1** as the next implementation phase.

Commercial packaging and credits foundation is now in place:

- Internal tiers stay compatible as `free`, `pro`, `business`, and `enterprise`.
- Product-facing plan labels now support Free, Pursuit Starter, Response Builder, planned Growth, and Enterprise.
- Credits have a foundation for included monthly credits, purchased credits, premium action costs, refunds, and future ledger events.
- Settings Billing/Usage can surface plan names, Growth as planned, and credit summaries.

The source registry, capability metadata, archive metadata columns, quality flag foundation, public attachment/detail downloader, Admin Bid QA queue, correction audit persistence, publish/suppress controls, batch QA actions, rich QA filters, correction history, Search Alerts management UI, notification provider hardening, 50-state crawler guardrails, and production billing/worker runbooks are now in place. The next risk is qualification trust: users need generated outputs to point back to evidence before the Product 2 workflow can deepen.

## Last Completed Phase

**Admin QA Batch Filters + Correction History plus P1 operational hardening** made QA and MVP operations more scalable:

Completed locally:

- Admin QA repository/API/client/UI now support display status, score range, source confidence, reviewer, and reviewed-date filters.
- Operator/admin users can select QA rows and batch mark reviewed, move to needs review, publish, or suppress.
- `/admin` exposes correction history and original-vs-corrected values; support remains read-only.
- Settings includes Search Alerts management for per-alert CRUD and pause/resume.
- Notification provider validation, notification delivery runbook, production billing/worker runbook, worker deployment checks, and 50-state crawler non-empty/live validation guardrails were added.

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

Make Product 2 qualification outputs evidence-backed:

`Intent Workspace -> Generated Qualification Output -> Evidence Citation -> Source/Attachment Link -> User Trust`

This phase should preserve the current deterministic generators while adding citation persistence and display. It should not require a production LLM to be useful.

## In Scope

- Persist qualification evidence citations linked to intent/bid outputs.
- Generate deterministic citations from bid fields, archived detail pages, attachment metadata, and existing compliance/submission outputs where available.
- Expose read-only citation API/client helpers.
- Show citations in Intent detail near Submission Guidance, Compliance Manifest, and Pursue/No-Bid sections.
- Keep feature gates and existing output wire shapes stable.

## Out Of Scope

- Login-only portal automation or CAPTCHA bypass.
- Full OCR/document parsing.
- Free-form LLM Q&A.
- Amendment/addenda monitoring automation.
- Production object storage migration.
- Broad redesign of public search/bid detail pages.

## Acceptance Criteria

- Existing 50-state crawler, Admin QA, Search Alerts, notification, and billing tests remain green.
- Citation records preserve source type, source label, excerpt/field reference, confidence, and generated timestamp.
- Intent detail can display citations without requiring a paid external AI provider.
- Submission Guidance, Compliance Manifest, and Pursue/No-Bid continue to work with current gates.
- Search/bid detail still works for existing records.
- `npm test`, `PYTHONPATH=crawler python3 -m pytest crawler/tests`, `npm run lint`, `npm run build`, `npm run db:migrate`, and `git diff --check` pass.

## Remaining Work After This Phase

1. Product 2 Qualification Upgrade continuation: document-grounded Q&A, amendment refresh, evidence/artifact links, no-bid taxonomy, qualification risk explanations.
2. Search Alerts notification history and digest delivery verification.
3. 50-state crawler hardening continuation: promote beta adapters, add source quality monitoring, and document Source Registry / Connector Engine / Normalization QA responsibilities.
4. Production deployment dry run for billing, notification, and crawler workers.
5. UI/UE production polish: migrate the demo visual direction into real `/search`, `/bids/[id]`, `/admin`, and settings workflows.
6. Knowledge Station Lite as Product 0.9 workflow coaching.
7. Response Workspace Lite and Artifact Vault Lite.
8. Supply Chain and Quote Lite.
9. Deadline Notifications, Award Tracking, and Win/Loss Learning Lite.
10. Real credit consumption, advanced usage metrics, enterprise custom rules, and production AI layer.
