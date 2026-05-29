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

Continue implementation with **Commercial Packaging And Credits Reconciliation** unless the sprint intentionally stays on crawler/data quality.

Reason:

- The latest Drive requirements changed the commercial model from `Free / Pro / Business / Enterprise` to `Free / Pursuit Starter / Response Builder / Growth / Enterprise`.
- Credits are now a first-class metering layer for premium AI and workflow actions.
- Product 3, Knowledge Station, and premium AI work should not be built on top of the old Pro/Business gate vocabulary.

Data-quality alternative:

- If the next sprint remains focused on crawler reliability, prioritize **P1 Data Pipeline Hardening: Attachment Archival + Source Registry Metadata**.

## Refresh Rule

If the Drive folder changes, re-read the Drive folder and update:

- Source inventory.
- Unified PRD.
- Gap analysis.
- Next development plan.
- Implementation status checklist.

Do not rely on memory from prior sessions when planning new work.
