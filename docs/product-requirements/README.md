# WinBids Product Requirements

Updated: 2026-06-30

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
5. `winbids-local-usable-mvp-plan.md`
   - Defines the local usable MVP boundary, current completion estimate, remaining local MVP work, and acceptance criteria.
6. `winbids-next-development-plan.md`
   - Tracks the next implementation direction after the latest Drive refresh.
7. `winbids-implementation-status.md`
   - Tracks implemented, partial, and missing functionality after each local development phase.
8. `../superpowers/plans/2026-06-12-overall-progress-execution-roadmap.md`
   - Current unified P0-P3 execution roadmap, progress percentages, track ownership model, and freeze checklist.

## Current Recommendation

Use `winbids-implementation-status.md` and `winbids-next-development-plan.md` as the current planning entrypoints. The local MVP is now broadly usable and has moved into final local polish / data-ops depth. Production-readiness work remains explicitly separate:

- If staying local, continue **data warning closure + quote upload UI + award tabulation + deep Enterprise cockpit**.
- If AWS staging access is ready, run **Production Artifact / Package Storage External Signoff**.
- If Stripe test credentials are ready, run **Stripe Sandbox E2E**.
- If deployment ownership is ready, run **Production Worker / Secrets / Backup Dry Run**.

Reason:

- Local usable MVP is about **98% complete**.
- Production readiness is about **73% complete** and still depends on real AWS/S3/Stripe/email/backup execution.
- Commercialization loop is about **73% complete**; Stripe sandbox/live validation remains external.
- Procurement workflow depth is about **93% complete**; remaining local value is quote upload UI, XLSX parsing, award tabulation, and outcome analytics.
- AI / Enterprise depth is about **60% complete**; Product 6 lite is visible in Dashboard, while real LLM/RAG/credit remains future depth.
- Full PRD/platform scope is about **76% complete**.
- The latest detailed status is tracked in `winbids-implementation-status.md`; the next local plan is tracked in `winbids-next-development-plan.md`.

## Refresh Rule

If the Drive folder changes, re-read the Drive folder and update:

- Source inventory.
- Unified PRD.
- Gap analysis.
- Next development plan.
- Implementation status checklist.

Do not rely on memory from prior sessions when planning new work.
