# WinBids Implementation Status

Updated: 2026-05-28

This document is the working checklist for local development. Update it after each completed phase so the next task can start from this list instead of re-reading the whole codebase.

## Current Product Status

### Implemented

| Area | Current implementation |
|---|---|
| Product shell | Real app shell, sidebar, bilingual UI, WinBids demo visual style applied to main pages. |
| Bid discovery | `/search`, filters, sort, bid cards, bid detail page, source links, attachments. |
| Saved bids | Anonymous and authenticated saved bids, merge anonymous saved bids on register/login. |
| Supplier profile | `/profile`, profile API, completion score, deterministic matching inputs. |
| Auth basics | Register, login, logout, session cookie, session lookup, login/register pages. |
| User data model basics | `users` table, `sessions` table, `role` column with default `user`. |
| Admin auth helper | `requireAdmin()` checks authenticated session with `users.role = admin`; local bypass for development. |
| Admin crawler console | `/admin`, data source health, enable/disable sources, run all state crawlers, run single source, crawler logs. |
| Source ingestion foundation | SQLite schema, seed data, crawler logs, SAM.gov/state runner APIs, CA/TX/NY/FL/IL runner wiring. |
| Match scoring | Deterministic bid match score, confidence, component scores, explanation, risk notes. |
| Intent to Bid | Add intent from bid detail, idempotent intent creation, intent list, intent detail workspace, status update. |
| AI-like bid brief | Deterministic brief, key dates, initial checklist, risk flags. |
| Submission Guidance foundation | `submission_paths`, `submission_confirmations`, generator, service, API routes, API client. |
| Static product demo | `/winbids-demo` isolated prototype page from Drive frontend references. |

### Partially Implemented

| Area | What exists | Missing to be useful |
|---|---|---|
| Account management | Register/login/logout/session APIs and pages | Account settings, password change/reset, user list, user editing, admin-created accounts |
| Admin vs user separation | Admin APIs enforce `role = admin`; sidebar currently exposes admin entry | Route-level UI gating, admin user management, ordinary users should not see/enter admin surfaces |
| User role model | `users.role` supports `user` and admin checks | Role enum, role update API, audit trail, role-aware frontend session payload |
| Subscription / tier model | Mentioned in PRD only | Database fields/tables, tier assignment, feature matrix, usage limits, paywall/upgrade UI |
| Feature access control | None centralized | `feature_key -> tier/role` mapping and reusable server/client guards |
| Submission Guidance UI | Static Submission Path preview in Intent workspace; backend API exists | Fetch real submission guidance, editable fields, confirmation form, saved confirmation state |
| Search alerts | API/service foundation exists | Full alert management UI, digest configuration, real email delivery |
| Notifications | Notification outbox foundation exists | Provider configuration, delivery retries, user notification preferences |
| Admin data QA | Source status and logs exist | Bid review/correction workflow, data quality score, admin publish/unpublish controls |

### Not Implemented

| Area | Needed capability |
|---|---|
| User management console | Admin page to list users, search users, view account state, change role, change tier, disable account. |
| User tiers / paid plans | Free, Pro, Business/Team, Enterprise tier model with feature and usage limits. |
| Feature matrix | Central list of feature keys, required tier, required role, and UI/API guard behavior. |
| Billing integration | Checkout, subscription status sync, invoices, cancellation, trial expiration. |
| Organization/workspace model | Company account, multiple users under one company, shared bids/intents, team roles. |
| Password reset | Email token flow, reset page, expiry and invalidation. |
| Compliance Manifest Lite | Structured bid requirements, manual completion, notes, evidence status. |
| Pursue / No-Bid Decision Lite | Recommendation, decision capture, reasons, decision history. |
| Response Workspace | Tasks, artifacts, internal checkpoints, reusable documents. |
| Sourcing / quote workflow | Partner database, quote requests, quote comparison, attachment storage. |
| Award / tabulation tracking | Award notices, bid status monitoring, tabulation records. |
| Win/loss learning | Outcome capture, reason taxonomy, future recommendation improvements. |
| Knowledge Station | Reusable knowledge items, snippets, templates, retrieval. |
| Production AI layer | LLM-backed extraction with citations, confidence, prompt rules, uncertainty handling. |

## Recommended Next Phase

Prioritize **Account, Role, Tier, and Feature Access Foundation** before continuing advanced bid features.

Reason:

- Admin/user separation is a platform prerequisite.
- Paid tiers will affect which future features should appear in UI.
- Advanced features such as Compliance Manifest, Submission Guidance editing, and Knowledge Station need a reusable feature gate instead of one-off checks.

## Account / Role / Tier Direction

### Roles

Use roles for operational authority:

- `user`: ordinary supplier account.
- `admin`: platform operator with access to crawler/data/admin tools.

Later optional roles:

- `owner`: company account owner.
- `member`: company team member.
- `support`: support/operator without full admin permissions.

### Tiers

Use tiers for product entitlement:

- `free`: basic search, limited saved bids, limited intents.
- `pro`: more saved bids/intents, match explanations, submission guidance.
- `business`: compliance manifest, team-ready workspace, quote workflow.
- `enterprise`: advanced intelligence, admin support, higher limits.

### Feature Keys

Start with a central feature map:

| Feature key | Free | Pro | Business | Enterprise |
|---|---:|---:|---:|---:|
| `bid_search` | Yes | Yes | Yes | Yes |
| `saved_bids` | Limited | Yes | Yes | Yes |
| `supplier_profile` | Yes | Yes | Yes | Yes |
| `match_score` | Basic | Full | Full | Full |
| `intent_workspace` | Limited | Yes | Yes | Yes |
| `submission_guidance` | Preview | Yes | Yes | Yes |
| `compliance_manifest` | No | Preview | Yes | Yes |
| `pursue_no_bid` | No | Yes | Yes | Yes |
| `quote_workflow` | No | No | Yes | Yes |
| `knowledge_station` | No | No | Limited | Yes |
| `admin_console` | Admin only | Admin only | Admin only | Admin only |

## Suggested Implementation Order

1. **Auth session payload upgrade**
   - Include `role`, `tier`, and enabled feature keys in `/api/auth/session`.
   - Update `AuthContext` and `PublicUser`.

2. **Schema and migration**
   - Add `account_tier` to users.
   - Add `is_disabled` or equivalent account state.
   - Keep billing integration out of scope for this slice.

3. **Admin user management**
   - Add admin API: list users, update role, update tier, disable/enable user.
   - Add `/admin/users` or a tab in `/admin`.
   - Protect with `requireAdmin()`.

4. **Frontend access guards**
   - Hide admin nav for non-admin users.
   - Show locked/upgrade states for tier-gated features.
   - Keep API-side checks authoritative.

5. **Feature gate helper**
   - Server helper: `requireFeature(principal, featureKey)`.
   - Client helper/hook: `useFeature(featureKey)`.
   - Add tests for role/tier combinations.

6. **Then resume product features**
   - Connect real Submission Guidance UI.
   - Build Compliance Manifest Lite.
   - Build Pursue / No-Bid Decision Lite.

## Status Update Template

Use this after every phase:

```text
本阶段完成：
- ...

验证：
- ...

当前还剩：
1. ...
2. ...
3. ...

建议下一步：
- ...
```
