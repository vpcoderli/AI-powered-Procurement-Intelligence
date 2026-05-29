# WinBids Product Requirements

Updated: 2026-05-29

This directory is the local working source for WinBids product requirements after reading the shared Google Drive folder.

## Reading Order

1. `winbids-drive-source-inventory.md`
   - Lists every Drive file read and the source hierarchy.
2. `winbids-unified-prd.md`
   - Consolidates product vision, modules, phases, scope, and MVP guardrails.
3. `winbids-requirements-reconciliation-2026-05-29.md`
   - Compares the latest Drive requirements with the local implementation and creates the revised requirement list.
4. `winbids-current-gap-analysis.md`
   - Compares the source requirements with the current local system.
5. `winbids-next-development-plan.md`
   - Tracks the next implementation direction after the latest Drive refresh.
6. `winbids-implementation-status.md`
   - Tracks implemented, partial, and missing functionality after each local development phase.

## Current Recommendation

Continue implementation with **P1 Data Pipeline Hardening: Attachment Archival + Source Registry Metadata**.

Reason:

- Commercial packaging and credits foundation is now implemented locally while preserving `free/pro/business/enterprise` compatibility values.
- The next highest-risk gap is data reliability: source registry metadata, connector capability tracking, attachment/detail archival, checksums, content types, and quality flags.
- Product 2, Knowledge Station, and Response Workspace will be stronger if bid source evidence and document archives are trustworthy first.

Product-workflow alternative:

- If the next sprint intentionally shifts to user workflow depth, prioritize **Product 2 Qualification Upgrade**.

## Refresh Rule

If the Drive folder changes, re-read the Drive folder and update:

- Source inventory.
- Unified PRD.
- Gap analysis.
- Next development plan.
- Implementation status checklist.

Do not rely on memory from prior sessions when planning new work.
