# WinBids Next Development Plan

Updated: 2026-05-29

## Recommendation

Continue with **P1 Data Pipeline Hardening: Attachment Download Archival Downloader** as the next implementation phase.

Commercial packaging and credits foundation is now in place:

- Internal tiers stay compatible as `free`, `pro`, `business`, and `enterprise`.
- Product-facing plan labels now support Free, Pursuit Starter, Response Builder, planned Growth, and Enterprise.
- Credits have a foundation for included monthly credits, purchased credits, premium action costs, refunds, and future ledger events.
- Settings Billing/Usage can surface plan names, Growth as planned, and credit summaries.

The source registry, capability metadata, archive metadata columns, and quality flag foundation are now in place. The next risk is data trust at the file layer: the product can now store archive metadata, but the crawler still needs the downloader that fetches attachments/detail pages, computes checksums, and records failure status.

## Phase Goal

Turn state crawler output into evidence-ready bid records:

`Source Registry -> Connector Run -> Detail/Attachment Downloader -> Quality Flags -> Admin QA -> Search/Bid Detail Evidence`

This phase should preserve the current 50-state registry, source metadata, and non-empty result guardrails while turning archive metadata from a schema foundation into actual downloaded evidence files.

## In Scope

- Attachment/detail downloader:
  - fetch public attachment URLs when crawler metadata marks them downloadable
  - fetch detail page HTML when connector supports detail page fetch
  - write files under the configured attachment/archive directory
  - calculate byte size, content type, checksum, fetched_at
  - record archive status and concise failure reason without dropping the bid
- Storage/repository behavior:
  - populate existing archive metadata columns on crawler upsert
  - keep original URL available even when local storage path is used for downloads
  - keep current API/bid detail behavior working for external-only attachments
- Guardrails:
  - do not bypass CAPTCHA, login walls, or terms-gated portals
  - mark unavailable/manual/browser-required sources explicitly
  - keep empty-result crawler failures intact
- Admin surface:
  - expose archived / unavailable / failed status clearly enough for QA
  - make 404 local file issues diagnosable from stored archive metadata

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
- Public downloadable attachments/detail pages are persisted locally with checksum, size, content type, fetched_at, and archive status.
- Source registry/admin views continue to explain why a source is verified, beta, fallback, browser-required, or manual.
- Bid records carry quality/admin-review metadata without breaking current search and bid detail pages.
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
