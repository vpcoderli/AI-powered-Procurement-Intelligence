# WinBids Next Development Plan

Updated: 2026-05-29

## Recommendation

Continue with **P1 Data Pipeline Hardening: Attachment Archival + Source Registry Metadata** as the next implementation phase.

Commercial packaging and credits foundation is now in place:

- Internal tiers stay compatible as `free`, `pro`, `business`, and `enterprise`.
- Product-facing plan labels now support Free, Pursuit Starter, Response Builder, planned Growth, and Enterprise.
- Credits have a foundation for included monthly credits, purchased credits, premium action costs, refunds, and future ledger events.
- Settings Billing/Usage can surface plan names, Growth as planned, and credit summaries.

The next risk is data trust. The system has 50-state beta crawler coverage, but the product still needs better source metadata, document archival, checksums, quality flags, and Admin QA workflow depth.

## Phase Goal

Turn state crawler output into evidence-ready bid records:

`Source Registry -> Connector Run -> Detail/Attachment Archive -> Quality Flags -> Admin QA -> Search/Bid Detail Evidence`

This phase should preserve the current 50-state registry and non-empty result guardrails while adding durable archive and quality metadata.

## In Scope

- Source Registry metadata fields:
  - provider family
  - access mode
  - source type
  - source confidence
  - activation status
  - requires browser/manual/login flags
- Connector capability metadata:
  - supports query
  - supports pagination
  - supports attachment metadata
  - supports detail page fetch
  - fallback source notes
- Attachment/detail archival foundation:
  - original URL
  - local storage path or future object reference
  - byte size
  - content type
  - checksum
  - fetched_at
  - archive status
- Bid quality metadata:
  - missing title/source/deadline flags
  - empty content guardrails
  - source confidence
  - admin review status
- Admin surface updates:
  - source capability visibility
  - archive status visibility
  - quality/review status visibility

## Out Of Scope

- Login-only portal automation.
- CAPTCHA bypass.
- Full OCR/document parsing.
- Replacing every fallback source in the same batch.
- Product 2 citation UI.
- Production object storage migration.

## Acceptance Criteria

- Existing 50-state crawler tests remain green.
- Crawler imports still reject empty result sets.
- Attachment/detail archive metadata is persisted for crawler-managed files or clearly marked unavailable.
- Source registry/admin views expose enough capability metadata to explain why a source is verified, beta, fallback, browser-required, or manual.
- Bid records can carry quality/admin-review metadata without breaking current search and bid detail pages.
- `npm test`, `npm run lint`, `npm run build`, `npm run db:migrate`, and `git diff --check` pass.

## Remaining Work After This Phase

1. Bid Admin/Data QA Console Expansion.
2. Product 2 Qualification Upgrade: citations, Q&A, amendment refresh, evidence/artifact links, no-bid taxonomy.
3. Knowledge Station Lite as Product 0.9 workflow coaching.
4. Response Workspace Lite and Artifact Vault Lite.
5. Supply Chain and Quote Lite.
6. Deadline Notifications and Search Alerts UI.
7. Submission Guidance Completion.
8. Award Tracking and Learning Lite.
9. Product 6 data capture only; full intelligence remains post-MVP.
