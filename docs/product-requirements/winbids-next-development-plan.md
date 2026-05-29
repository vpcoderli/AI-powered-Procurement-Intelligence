# WinBids Next Development Plan

Updated: 2026-05-29

## Recommendation

Continue with **Commercial Packaging And Credits Reconciliation** as the next implementation phase.

The latest Drive refresh changed the product packaging from the local `Free / Pro / Business / Enterprise` model to:

`Free -> Pursuit Starter -> Response Builder -> Growth -> Enterprise`

It also makes credits a first-class entitlement and metering layer. Because Product 3, Knowledge Station, premium AI, quote workflow, award analysis, and future intelligence all depend on plan/credit gates, this should be reconciled before building more paid workflow depth.

## Phase Goal

Create a compatibility-safe commercial foundation:

`Current tiers -> new plan vocabulary -> feature slugs -> credit ledger -> contextual paywalls -> usage/credits UI`

This phase should not remove existing data or break current users. The safest first implementation is to support new plan labels and feature/credit metadata while mapping current local tiers to the new business meaning.

## Recommended Mapping

| Current local tier | Updated product plan | Rationale |
|---|---|---|
| `free` | Free | Acquisition and proof of relevance. |
| `pro` | Pursuit Starter | Existing Pro gates already cover Submission Guidance and Pursue / No-Bid, which are Starter-style readiness workflows. |
| `business` | Response Builder | Existing Business gates already cover Compliance Manifest and team-ready workspace direction; future Response Workspace belongs here. |
| `enterprise` | Enterprise | Keep as sales-led advanced governance/custom plan. |
| New | Growth | Add as future/disabled plan for award tracking, tabulation analysis, buyer history, rebid forecasting, and Product 6-adjacent learning. |

## In Scope

- Plan catalog labels and display copy for Free, Pursuit Starter, Response Builder, Growth, Enterprise.
- Internal compatibility mapping from existing enum values to updated plan semantics.
- Feature slug expansion from the Drive PRD:
  - `bid.brief.full.generate`
  - `compliance.manifest.generate`
  - `readiness.review.run`
  - `response.workspace.create`
  - `artifact.vault.upload`
  - `response.section.draft`
  - `package.review.run`
  - `amendment.delta.run`
  - `award.tabulation.analyze`
  - `price.to.win.run`
  - `team.member.invite`
- Credit model foundation:
  - included monthly credits
  - purchased credits
  - credit ledger
  - credit quote before premium action
  - no-consume/refund behavior for failed system generations
  - low-balance state
- Contextual paywall types:
  - Starter activation
  - Builder activation
  - Growth activation
  - credit top-up
  - seat limit
  - Enterprise contact sales
- Settings usage/plan copy update so the UI speaks the new product language.
- Documentation update in implementation status and requirements.

## Out Of Scope

- Charging for credit packs in Stripe.
- Migrating all database enum values immediately.
- Building Product 3 Response Workspace.
- Building Knowledge Station Lite.
- Building paid AI provider calls.
- Building Growth award/intelligence features.
- Removing backward compatibility for current `pro` and `business` code paths.

## Acceptance Criteria

- Current users and tests still work with existing `free/pro/business/enterprise` stored tier values.
- UI and plan catalog show the updated commercial names.
- Entitlement logic can answer both old feature keys and new PRD feature slugs.
- Credit ledger schema exists and can record grants/consumption without requiring Stripe credit-pack checkout.
- Premium action checks can return a structured reason: plan required, credits required, seat limit, role denied, payment past due, or limit reached.
- Settings usage/plan surfaces explain plan, usage, and credits without surprising the user.
- `npm test`, `npm run lint`, `npm run build`, `npm run db:migrate`, and `git diff --check` pass.

## Data-Quality Alternative

If the next sprint should stay on crawler/data reliability instead of commercial packaging, do **P1 Data Pipeline Hardening: Attachment Archival + Source Registry Metadata**.

That alternative should:

- Add source registry metadata fields: provider family, access mode, allowed use, validation confidence, registration status, activation readiness.
- Add raw object/archive references and attachment download status.
- Record checksum, byte size, content type, original URL, local path/object reference, fetched_at, parser version, and extraction availability.
- Route failed or suspicious records into Admin QA.

## Remaining Work After This Phase

1. P1 Data Pipeline Hardening: attachment archival, raw archive, source registry metadata, validation flags.
2. Bid Admin/Data QA Console Expansion.
3. P2 Qualification Upgrade: citations, Q&A, amendment refresh, evidence/artifact links, no-bid taxonomy.
4. Knowledge Station Lite as Product 0.9 workflow coaching.
5. Response Workspace Lite and Artifact Vault Lite.
6. Supply Chain and Quote Lite.
7. Deadline Notifications.
8. Submission Guidance Completion.
9. Award Tracking and Learning Lite.
10. Product 6 data capture only; full intelligence remains post-MVP.
