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
| Auth basics | Register, login, logout, session cookie, session lookup, login/register pages, session payload with role/tier/features. |
| User data model basics | `users` table, `sessions` table, `role`, `account_tier`, and `is_disabled` account state. |
| Admin auth helper | `requireAdmin()` checks authenticated non-disabled admin sessions; local bypass for development. |
| Admin user access console | `/admin` lists registered users and lets admins change role, tier, and enabled/disabled state. |
| Admin crawler console | `/admin`, data source health, enable/disable sources, run all state crawlers, run single source, crawler logs. |
| Feature entitlement map | Central role/tier feature map for Free, Pro, Business, Enterprise, and admin-only console access. |
| Feature access guards | Reusable server `requireFeature`, client `useFeature`, and tier-aware locked states for gated features. |
| Source ingestion foundation | SQLite schema, seed data, crawler logs, SAM.gov/state runner APIs, CA/TX/NY/FL/IL runner wiring. |
| Match scoring | Deterministic bid match score, confidence, component scores, explanation, risk notes. |
| Intent to Bid | Add intent from bid detail, idempotent intent creation, intent list, intent detail workspace, status update. |
| AI-like bid brief | Deterministic brief, key dates, initial checklist, risk flags. |
| Submission Guidance foundation | `submission_paths`, `submission_confirmations`, generator, service, API routes, API client. |
| Static product demo | `/winbids-demo` isolated prototype page from Drive frontend references. |

### Partially Implemented

| Area | What exists | Missing to be useful |
|---|---|---|
| Account management | Register/login/logout/session APIs and pages; admin can enable/disable users | Account settings, password change/reset, admin-created accounts, user search/filtering |
| Admin vs user separation | Admin APIs enforce admin role; disabled admins are rejected; sidebar hides Admin for ordinary users | Route-level friendly forbidden UI, admin page redirect/empty state for non-admin users |
| User role model | `user`/`admin` role enum, role update API, role-aware frontend session payload | Audit trail, more granular operator roles such as support/owner/member |
| Subscription / tier model | `account_tier` on users, admin tier assignment, central entitlement map | Billing provider sync, usage limits, paywall/upgrade UI, subscription history |
| Feature access control | Central feature map, server guard, client helper, and visible locked states | Apply guards to every future gated API and add usage limits |
| Submission Guidance UI | Static Submission Path preview in Intent workspace; backend API exists; API is Pro-gated | Fetch real submission guidance, editable fields, confirmation form, saved confirmation state |
| Search alerts | API/service foundation exists | Full alert management UI, digest configuration, real email delivery |
| Notifications | Notification outbox foundation exists | Provider configuration, delivery retries, user notification preferences |
| Admin data QA | Source status and logs exist | Bid review/correction workflow, data quality score, admin publish/unpublish controls |

### Not Implemented

| Area | Needed capability |
|---|---|
| User tiers / paid plans | Free, Pro, Business/Team, Enterprise tier model with feature and usage limits. |
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

Prioritize **Admin User Management Polish and Account Settings** before continuing advanced bid features.

Reason:

- The data model, session payload, admin user management, feature map, and reusable feature guards now exist.
- The next gap is making account management usable day to day: search/filter users, audit changes, and start real account settings.
- Advanced features such as Compliance Manifest, Submission Guidance editing, and Knowledge Station can now rely on the same feature gate.

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

1. **Admin user management polish**
   - Add user search/filtering.
   - Add audit events for role/tier/disabled changes.
   - Add admin-created account flow when needed.

2. **Account settings foundation**
   - Show authenticated email/display name instead of placeholder profile values.
   - Add password change flow.
   - Add disabled/account-state messaging where needed.

3. **Then resume product features**
   - Connect real Submission Guidance UI.
   - Build Compliance Manifest Lite.
   - Build Pursue / No-Bid Decision Lite.

## Completed Phase: Account / Role / Tier Foundation

本阶段完成：
- `users` 增加 `account_tier` 与 `is_disabled`，迁移会兼容已有本地库。
- `/api/auth/session`、注册、登录返回 `role`、`tier`、`features`。
- 新增中心化 entitlement map，覆盖 Free/Pro/Business/Enterprise 与 admin-only 功能。
- 新增 Admin 用户管理 API：注册用户列表、改角色、改套餐、启用/禁用。
- `/admin` 接入用户权限表，普通用户侧边栏不再显示 Admin 入口。

当前还剩：
1. Admin 用户搜索、筛选、审计日志。
2. 密码重置、账户设置页完善、billing 集成。
3. Submission Guidance 真实编辑 UI。

## Completed Phase: Feature Guards / Tier-Aware UI

本阶段完成：
- 新增 server `requireFeature()` / `FeatureAccessError`，API 可统一按功能键拦截。
- `resolvePrincipal()` 现在为匿名和登录用户都携带 `role`、`tier`、`features`。
- 新增 client `useFeature()` / `canUseFeature()` / `lockedFeatureMessage()`。
- Submission Guidance GET/PATCH/confirm API 已按 `submission_guidance` 做 Pro 门槛。
- Intent Workspace 的 Submission Path 模块会按套餐显示锁定态。
- Settings/Profile 区域显示当前套餐和功能可用/锁定状态。

当前还剩：
1. Admin 用户搜索、筛选、审计日志。
2. 账户设置从静态表单升级为真实资料与密码修改。
3. Billing/订阅同步与真实付费状态接入。
4. Submission Guidance 真实编辑与确认 UI。

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
