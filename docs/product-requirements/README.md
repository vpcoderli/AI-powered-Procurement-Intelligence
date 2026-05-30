# WinBids Product Requirements

Updated: 2026-05-30

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

Continue implementation with **Search Alerts Notification History + Digest Delivery Verification**.

Reason:

- Admin QA batch filters/correction history, Search Alerts management UI, 50-state crawler guardrails, notification provider hardening, production billing/worker runbooks, Qualification Evidence Citations v1, and Document-Grounded Q&A v1 are now implemented locally.
- The next highest-risk MVP gap is alert trust: users can configure alerts, but need delivery history and digest verification before alerting feels production-ready.
- This keeps the next slice small while directly supporting the existing notification foundation.

Product-workflow alternative:

- If the next sprint intentionally stays on Product 2, prioritize **amendment/addenda refresh** or **richer evidence/artifact links**.

## Refresh Rule

If the Drive folder changes, re-read the Drive folder and update:

- Source inventory.
- Unified PRD.
- Gap analysis.
- Next development plan.
- Implementation status checklist.

Do not rely on memory from prior sessions when planning new work.
