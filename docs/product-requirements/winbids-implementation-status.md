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
| Account self-service | `/settings` shows authenticated email/display name, updates display name, changes password after validating current password. |
| User data model basics | `users` table, `sessions` table, `role`, `account_tier`, and `is_disabled` account state. |
| Admin auth helper | `requireAdmin()` checks authenticated non-disabled admin sessions; local bypass for development. |
| Admin user access console | `/admin` lists registered users, filters/searches accounts, changes role/tier/enabled state, and shows access audit logs. |
| Admin crawler console | `/admin`, data source health, enable/disable sources, run all state crawlers, run single source, crawler logs. |
| Feature entitlement map | Central role/tier feature map for Free, Pro, Business, Enterprise, and admin-only console access. |
| Feature access guards | Reusable server `requireFeature`, client `useFeature`, and tier-aware locked states for gated features. |
| Usage limits | Central saved bid and intent workspace quota checks by tier; APIs return `USAGE_LIMIT_REACHED` before creating over-limit resources. |
| Subscription foundation | `account_subscriptions`, `subscription_events`, plan catalog, account subscription API, Settings Billing tab. |
| Source ingestion foundation | SQLite schema, seed data, crawler logs, SAM.gov/state runner APIs, CA/TX/NY/FL/IL runner wiring. |
| Match scoring | Deterministic bid match score, confidence, component scores, explanation, risk notes. |
| Intent to Bid | Add intent from bid detail, idempotent intent creation, intent list, intent detail workspace, status update. |
| AI-like bid brief | Deterministic brief, key dates, initial checklist, risk flags. |
| Submission Guidance | `submission_paths`, `submission_confirmations`, generator, service, Pro-gated API routes, API client, Intent workspace UI for generated guidance, editable submission fields, readiness/risk lists, and manual submission confirmation. |
| Static product demo | `/winbids-demo` isolated prototype page from Drive frontend references. |

### Partially Implemented

| Area | What exists | Missing to be useful |
|---|---|---|
| Account management | Register/login/logout/session APIs and pages; account settings can update display name and password; admin can enable/disable users, search/filter users, and review access audit logs | Password reset, admin-created accounts, account deletion/export |
| Admin vs user separation | Admin APIs enforce admin role; disabled admins are rejected; sidebar hides Admin for ordinary users | Route-level friendly forbidden UI, admin page redirect/empty state for non-admin users |
| User role model | `user`/`admin` role enum, role update API, audit trail, role-aware frontend session payload | More granular operator roles such as support/owner/member |
| Subscription / tier model | `account_tier` on users, admin tier assignment, central entitlement map, subscription status table, event history, Settings Billing tab | Billing provider sync, real checkout, invoices, cancellation |
| Feature access control | Central feature map, server guard, client helper, visible locked states, saved bid and intent usage limits | Apply guards/limits to every future gated API and add richer usage dashboards |
| Search alerts | API/service foundation exists | Full alert management UI, digest configuration, real email delivery |
| Notifications | Notification outbox foundation exists | Provider configuration, delivery retries, user notification preferences |
| Admin data QA | Source status and logs exist | Bid review/correction workflow, data quality score, admin publish/unpublish controls |

### Not Implemented

| Area | Needed capability |
|---|---|
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

Prioritize **Compliance Manifest Lite** or **Billing Provider Sync** depending on whether the next sprint should deepen bid execution workflow or connect real monetization.

Reason:

- The data model, session payload, account settings, subscription foundation, admin user management, search/filtering, audit logs, feature map, and reusable feature guards now exist.
- The remaining account gap is not basic self-service; it is real billing provider sync, broader usage dashboards, password reset, and organization/team support.
- Advanced features such as Compliance Manifest, Pursue / No-Bid, and Knowledge Station can now rely on the same feature gate and Submission Guidance pattern.

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

### Usage Limits

Current local limits:

| Feature key | Free | Pro | Business | Enterprise |
|---|---:|---:|---:|---:|
| `saved_bids` | 5 | 50 | 250 | Unlimited |
| `intent_workspace` | 2 | 20 | 100 | Unlimited |

## Suggested Implementation Order

1. **Product workflow depth**
   - Build Compliance Manifest Lite.
   - Build Pursue / No-Bid Decision Lite.

2. **Billing provider sync**
   - Connect checkout/customer/subscription webhooks.
   - Reconcile provider subscription state to `account_subscriptions`.
   - Add invoice/cancel/trial UI.

3. **Account lifecycle**
   - Add password reset.
   - Add admin-created accounts and invite flow.
   - Add organization/workspace model.

## Completed Phase: Account / Role / Tier Foundation

本阶段完成：
- `users` 增加 `account_tier` 与 `is_disabled`，迁移会兼容已有本地库。
- `/api/auth/session`、注册、登录返回 `role`、`tier`、`features`。
- 新增中心化 entitlement map，覆盖 Free/Pro/Business/Enterprise 与 admin-only 功能。
- 新增 Admin 用户管理 API：注册用户列表、改角色、改套餐、启用/禁用。
- `/admin` 接入用户权限表，普通用户侧边栏不再显示 Admin 入口。

当前还剩：
1. Billing provider 同步与真实 checkout/发票/取消订阅。
2. Password reset 邮件 token 流程。
3. Submission Guidance 真实编辑与确认 UI。

## Completed Phase: Feature Guards / Tier-Aware UI

本阶段完成：
- 新增 server `requireFeature()` / `FeatureAccessError`，API 可统一按功能键拦截。
- `resolvePrincipal()` 现在为匿名和登录用户都携带 `role`、`tier`、`features`。
- 新增 client `useFeature()` / `canUseFeature()` / `lockedFeatureMessage()`。
- Submission Guidance GET/PATCH/confirm API 已按 `submission_guidance` 做 Pro 门槛。
- Intent Workspace 的 Submission Path 模块会按套餐显示锁定态。
- Settings/Profile 区域显示当前套餐和功能可用/锁定状态。

当前还剩：
1. Billing provider 同步与真实 checkout/发票/取消订阅。
2. Password reset 邮件 token 流程。
3. Submission Guidance 真实编辑与确认 UI。

## Completed Phase: Admin User Management Polish

本阶段完成：
- 新增 `admin_user_audit_logs` 表与迁移。
- `/api/admin/users` 支持按关键词、角色、套餐、启用状态过滤。
- `/api/admin/users/[id]` 修改角色、套餐、启用/禁用时写入审计日志。
- 新增 `/api/admin/users/audit-logs` 管理员接口。
- `/admin` 用户权限区增加搜索/筛选控件与“用户权限审计”视图。

当前还剩：
1. Billing provider 同步与真实 checkout/发票/取消订阅。
2. Password reset 邮件 token 流程。
3. Submission Guidance 真实编辑与确认 UI。

## Completed Phase: Account Settings Foundation

本阶段完成：
- 新增当前用户资料更新服务与 `/api/account/profile`。
- 新增当前用户密码修改服务与 `/api/account/password`，会校验当前密码与新密码强度。
- `/settings` 个人资料从静态占位数据改为真实登录用户邮箱/显示名称。
- `/settings` 安全页接入真实密码修改流程，并补齐中英文状态文案。
- 新增服务、API route、前端 API client、Settings 静态检查测试。

当前还剩：
1. Billing provider 同步与真实 checkout/发票/取消订阅。
2. Password reset 邮件 token 流程。
3. Admin 创建账号 / 邀请用户流程。
4. Organization/workspace 多用户公司账户模型。
5. Submission Guidance 真实编辑与确认 UI。

## Completed Phase: Billing / Subscription Foundation

本阶段完成：
- 新增 `account_subscriptions` 与 `subscription_events` 表，支持当前订阅状态和套餐变更事件历史。
- 新增订阅服务：默认读取 admin/manual 当前套餐，也支持本地 checkout/provider 同步入口更新有效 `account_tier`。
- 新增 `/api/account/subscription`，登录用户可读取当前订阅、来源、状态、周期结束时间和套餐目录。
- `/settings` 新增 Billing 标签页，展示当前套餐、订阅状态、来源、可用套餐和升级入口占位。
- 新增订阅服务、API route、前端 API client、Settings 静态检查和 schema 测试。

当前还剩：
1. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
2. Usage limits：继续覆盖 alerts、AI/高级功能调用次数，并增加使用量仪表盘。
3. Password reset 邮件 token 流程。
4. Admin 创建账号 / 邀请用户流程。
5. Organization/workspace 多用户公司账户模型。
6. Submission Guidance 真实编辑与确认 UI。

## Completed Phase: Usage Limits Foundation

本阶段完成：
- 新增中心化 `usage-limits` 服务，定义 Free/Pro/Business/Enterprise 的 saved bids 与 intent workspace 额度。
- `/api/saved-bids` 在新增保存前检查额度；已保存的同一 bid 可幂等通过。
- `/api/bids/[id]/intent` 在新增 Intent 前检查额度；已有同一 bid 的 Intent 可幂等通过。
- 超额时 API 返回 `USAGE_LIMIT_REACHED`、当前用量、额度和推荐升级套餐。
- 前端 API client 识别 `USAGE_LIMIT_REACHED`；Bid Detail 的 Intent 创建失败会展示升级到 Pro 的提示。

当前还剩：
1. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
2. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。
3. Password reset 邮件 token 流程。
4. Admin 创建账号 / 邀请用户流程。
5. Organization/workspace 多用户公司账户模型。

## Completed Phase: Submission Guidance UI

本阶段完成：
- Intent 详情页从静态 Submission Path 预览改为真实读取 `/api/intents/[id]/submission`。
- Pro 及以上用户可编辑提交方式、门户链接、联系邮箱、注册/纸质递交/补遗确认要求。
- 页面展示生成的提交指导、复杂度、准备清单和提交风险提示。
- 新增手动“确认已提交”表单，写入 `/api/intents/[id]/submission/confirm`。
- 补齐中英文文案和页面静态检查测试。

验证：
- `npm test -- src/app/intents/page.test.ts src/lib/api/intents.test.ts 'src/app/api/intents/[id]/submission/route.test.ts' 'src/app/api/intents/[id]/submission/confirm/route.test.ts'`
- `npm test`
- `npm run lint`
- `npm run build`
- 浏览器烟测：打开 Intent 工作台，保存提交指导成功，确认已提交成功。

当前还剩：
1. Compliance Manifest Lite：结构化需求、人工完成状态、备注和证据状态。
2. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。
3. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
4. Password reset 邮件 token 流程。
5. Admin 创建账号 / 邀请用户流程。
6. Organization/workspace 多用户公司账户模型。
7. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。

建议下一步：
- 优先开发 Compliance Manifest Lite，因为它直接承接 Submission Guidance，让用户开始把投标要求转成可执行清单。

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
