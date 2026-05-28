# WinBids Implementation Status

Updated: 2026-05-28

This document is the working checklist for local development. Update it after each completed phase so the next task can start from this list instead of re-reading the whole codebase.

## How To Use This Checklist

每完成一个阶段后，都要更新下面三块：

1. **Current Product Status**：哪些能力已经可用，哪些只是部分可用。
2. **Account / Permission / Billing Tracker**：账户、admin、套餐、功能权限这条商业化主线的差距。
3. **Recommended Next Phase**：下一阶段优先做什么，避免每次重新阅读代码后再判断。

## Current Product Status

### Implemented

| Area | Current implementation |
|---|---|
| Product shell | Real app shell, sidebar, bilingual UI, WinBids demo visual style applied to main pages. |
| Bid discovery | `/search`, filters, sort, bid cards, bid detail page, source links, attachments. |
| Saved bids | Anonymous saved bids and authenticated workspace-shared saved bids, merge anonymous saved bids on register/login. |
| Supplier profile | `/profile`, profile API, completion score, deterministic matching inputs. |
| Auth basics | Register, login, logout, session cookie, session lookup, login/register pages, session payload with role/tier/features. |
| Account self-service | `/settings` shows authenticated email/display name, updates display name, changes password after validating current password, exports account data, and soft-deletes accounts; `/forgot-password` and `/reset-password` support local token-based password recovery; `/accept-invite` supports workspace invitation acceptance; Settings Team tab manages workspace name, member invites, invitation resend/revoke, owner transfer, member role changes, member disable/restore, and member removal. |
| User data model basics | `users` table, `sessions` table, `organizations`, `organization_memberships`, `role`, `account_tier`, `is_disabled`, and workspace owner/member state. |
| Admin auth helper | `requireAdmin()` checks authenticated non-disabled admin sessions; local bypass for development. |
| Admin user access console | `/admin` lists registered users, creates invited accounts with temporary passwords, filters/searches accounts, changes role/tier/enabled state, shows access audit logs, and presents login/forbidden states for non-admin access. |
| Admin crawler console | `/admin`, data source health, enable/disable sources, run all state crawlers, run single source, crawler logs. |
| Feature entitlement map | Central role/tier feature map for Free, Pro, Business, Enterprise, and admin-only console access. |
| Feature access guards | Reusable server `requireFeature`, client `useFeature`, and tier-aware locked states for gated features. |
| Usage limits | Central saved bid and intent workspace quota checks by tier; authenticated users are counted at workspace scope; APIs return `USAGE_LIMIT_REACHED` before creating over-limit resources. |
| Subscription foundation | `account_subscriptions`, `subscription_events`, plan catalog, account subscription API, Settings Billing tab. |
| Billing provider sync foundation | `billing_checkout_sessions`, checkout creation API, provider webhook intake, provider event idempotency, subscription status reconciliation, and Settings self-service upgrade/cancel controls. |
| Invoice / payment history foundation | `billing_invoices`, provider invoice event sync, payment-failed status handling, account invoice API, Settings invoice history UI, and optional HMAC webhook signature verification via `BILLING_WEBHOOK_SECRET`. |
| Customer portal foundation | Hosted checkout and customer portal URL templates, provider/customer placeholders, account portal API, and Settings Manage Billing entry. |
| Source ingestion foundation | SQLite schema, seed data, crawler logs, SAM.gov/state runner APIs, CA/TX/NY/FL/IL runner wiring. |
| Match scoring | Deterministic bid match score, confidence, component scores, explanation, risk notes. |
| Intent to Bid | Add intent from bid detail, idempotent workspace-scoped intent creation, shared intent list/detail for organization members, status update. |
| AI-like bid brief | Deterministic brief, key dates, initial checklist, risk flags. |
| Submission Guidance | `submission_paths`, `submission_confirmations`, generator, service, Pro-gated API routes, API client, Intent workspace UI for generated guidance, editable submission fields, readiness/risk lists, and manual submission confirmation. |
| Compliance Manifest Lite | `compliance_manifest_items`, generator, service, Business-gated API route, API client, and Intent workspace UI for requirement status, evidence status, and notes. |
| Pursue / No-Bid Decision Lite | `pursuit_decisions`, recommendation generator, Pro-gated API route, API client, and Intent workspace UI for decision capture, reasons, notes, and history. |
| Static product demo | `/winbids-demo` isolated prototype page from Drive frontend references. |

## Account / Permission / Billing Tracker

这部分专门跟踪普通账户、管理员账户、用户等级、付费功能关联。后续每次做完权限或商业化相关功能，都优先更新这里。

### Already Implemented

| Capability | Status | Notes |
|---|---|---|
| 普通账户注册 | Done | `/register` and `/api/auth/register` create local user accounts, default `role=user`, default `account_tier=free`, and create sessions. |
| 普通账户登录/退出/session | Done | `/login`, logout API, session cookie, `/api/auth/session`, disabled account rejection. |
| 普通账户基础管理 | Done | `/settings` supports display name update, password change, password reset request/confirm, account data export, and soft account deletion/deactivation. |
| 普通账户团队空间 | Partial | Default organization/workspace exists; Team tab can rename workspace, invite local members, enqueue local invitation email notifications, resend/revoke pending invitations, accept invitations, transfer owner, update member role, disable/restore members, and remove members. |
| Admin 账户基础分离 | Done | `role=admin` is distinct from `role=user`; `requireAdmin()` protects admin APIs; `/admin` is hidden/blocked for ordinary users. |
| Admin 用户管理 | Done | Admin can list/search/filter users, create invited accounts with temporary passwords, update role/tier/enabled state, and view audit logs. |
| 用户等级模型 | Done | `account_tier` supports `free`, `pro`, `business`, `enterprise`. |
| 功能与等级关联 | Done | Central entitlement map controls feature keys such as `submission_guidance`, `compliance_manifest`, `pursue_no_bid`, `quote_workflow`, `knowledge_station`. |
| 服务端功能拦截 | Partial | `requireFeature()` exists and is already used by Submission Guidance, Compliance Manifest, and Pursue / No-Bid APIs. |
| 前端锁定态 | Partial | `useFeature()` and locked messages exist on key workspace modules and Settings feature overview. |
| 使用额度限制 | Partial | Saved bids and intent workspace limits exist by tier. |
| 订阅数据基础 | Partial | `account_subscriptions`, `subscription_events`, plan catalog, and Settings Billing tab exist. |
| 自助升级/取消基础 | Partial | Settings Billing can start Pro/Business checkout sessions, receive provider-compatible webhook updates, sync account tier/status, dedupe provider events, and schedule cancellation at period end. |
| 发票/支付历史基础 | Partial | Provider invoice paid/payment-failed events write `billing_invoices`; users can read invoice history in Settings; signed webhook verification is supported when `BILLING_WEBHOOK_SECRET` is configured. |
| 支付服务商配置/门户基础 | Partial | Hosted checkout/customer portal templates can redirect to provider URLs; users can open Manage Billing from Settings. |

### Still Needed

| Priority | Capability | Needed Work | Why It Matters |
|---:|---|---|---|
| P0 | Production Billing Provider Hardening | Add real provider SDK/API calls, provider-specific event mapping, deployment env guidance, and end-to-end sandbox test credentials. | The current boundary is provider-compatible, but not yet production payment processing. |
| P1 | Invoice / Payment History Polish | Add PDF/download affordances, invoice filters, customer-facing payment retry links, and richer invoice detail. | Paid users need a complete billing record experience. |
| P1 | Trial / Dunning Lifecycle | Add trial expiration, past-due reminders, payment failure states, and downgrade rules. | Prevents stale paid access when payment state changes. |
| P1 | Account Deletion / Export Polish | Add admin-facing deletion audit review and richer export format/version metadata. | Required for serious account management and compliance readiness. |
| P1 | Team Lifecycle Completion | Replace local invitation outbox with production email provider delivery, delivery retries, and user-facing delivery status. | Business/Enterprise accounts need real team administration. |
| P1 | Entitlement Coverage Audit | Ensure every gated future API and UI action uses the central feature map and consistent locked states. | Prevents paid features from leaking to lower tiers. |
| P1 | Usage Dashboard | Show current usage vs tier limits for saved bids, intents, and future quote/workspace limits. | Users need to understand why an upgrade is required. |
| P2 | Granular Operator Roles | Add support/operator roles separate from full admin. | Useful once support operations grow. |
| P2 | Advanced Feature Flags | Add configurable feature flags or per-account overrides beyond tier defaults. | Enables beta features and enterprise custom access. |

### Current Tier-To-Feature Direction

| Tier | User Type | Current / Planned Feature Access |
|---|---|---|
| Free | Ordinary trial/basic supplier | Search, saved bids with low quota, supplier profile, basic match score, limited intent workspace. |
| Pro | Individual paid supplier | Higher quotas, Submission Guidance, Pursue / No-Bid, full match explanation. |
| Business | Small team supplier | Pro features plus Compliance Manifest, team-ready workspace, future quote workflow. |
| Enterprise | Advanced/team account | Business features plus Knowledge Station, advanced intelligence, higher limits, support/admin assistance. |
| Admin | Platform operator | Admin console, crawler/source tools, user management, tier assignment, audit visibility. |

### Partially Implemented

| Area | What exists | Missing to be useful |
|---|---|---|
| Account management | Register/login/logout/session APIs and pages; account settings can update display name and password; password reset token flow; users can export account data and soft-delete/deactivate their account; admin can create invited accounts, enable/disable users, search/filter users, and review access audit logs | Admin-facing deletion audit review and richer export format/version metadata |
| Organization/workspace model | Registered users get a default organization, session payload includes current workspace and owner/member role, Settings Team tab can rename workspace, invite local members, queue invitation email notifications, resend/revoke pending invitations, accept invitations, transfer owner, change member roles, disable/restore members, remove members, and saved bids/intents are shared across organization members | Production email provider delivery, retries, and delivery status |
| Admin vs user separation | Admin APIs enforce admin role; disabled admins are rejected; sidebar hides Admin for ordinary users; `/admin` shows login-required or forbidden states before loading admin APIs | More granular operator roles such as support/owner/member |
| User role model | `user`/`admin` role enum, role update API, audit trail, role-aware frontend session payload | More granular operator roles such as support/owner/member |
| Subscription / tier model | `account_tier` on users, admin tier assignment, central entitlement map, subscription status table, event history, Settings Billing tab, checkout sessions, hosted checkout/portal templates, provider-compatible webhook sync, cancellation scheduling, invoice history, and optional webhook signature verification | Real payment provider SDK/API calls, provider-specific event mapping, sandbox credentials, trial/dunning lifecycle |
| Feature access control | Central feature map, server guard, client helper, visible locked states, saved bid and intent usage limits; Submission Guidance and Pursue / No-Bid are Pro-gated, Compliance Manifest is Business-gated | Apply guards/limits to every future gated API and add richer usage dashboards |
| Search alerts | API/service foundation exists | Full alert management UI, digest configuration, real email delivery |
| Notifications | Notification outbox foundation exists | Provider configuration, delivery retries, user notification preferences |
| Admin data QA | Source status and logs exist | Bid review/correction workflow, data quality score, admin publish/unpublish controls |

### Not Implemented

| Area | Needed capability |
|---|---|
| Production billing polish | Real provider SDK/API calls, provider-specific event mapping, sandbox credentials, trial expiration, and dunning. |
| Organization team lifecycle | Production email provider delivery, retry worker, and invitation delivery status. |
| Response Workspace | Tasks, artifacts, internal checkpoints, reusable documents. |
| Sourcing / quote workflow | Partner database, quote requests, quote comparison, attachment storage. |
| Award / tabulation tracking | Award notices, bid status monitoring, tabulation records. |
| Win/loss learning | Outcome capture, reason taxonomy, future recommendation improvements. |
| Knowledge Station | Reusable knowledge items, snippets, templates, retrieval. |
| Production AI layer | LLM-backed extraction with citations, confidence, prompt rules, uncertainty handling. |

## Recommended Next Phase

Prioritize **Production Billing Provider SDK/API Adapter** next if the next sprint stays on monetization. If the next sprint stays on account lifecycle, prioritize Usage Dashboard and entitlement coverage audit.

Reason:

- The data model, session payload, account settings, password reset flow, organization/member foundation, workspace-shared saved bids/intents, team role management/removal, subscription foundation, admin user management, search/filtering, audit logs, feature map, reusable feature guards, Submission Guidance, Business-gated Compliance Manifest, and Pro-gated Pursue / No-Bid Decision now exist.
- The remaining account gap is not basic registration; it is real payment provider SDK/API integration, provider-specific event mapping, trial/dunning lifecycle, production email provider delivery, broader usage dashboards, and account export/deletion polish.
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

1. **Billing provider SDK/API adapter**
   - Replace URL-template-only checkout/customer portal with real provider SDK/API calls.
   - Map real provider checkout, customer, subscription, invoice, and payment retry events into `BillingProviderEvent`.
   - Add sandbox credential docs and end-to-end sandbox verification.

2. **Account lifecycle**
   - Add usage dashboard for tier limits.
   - Add production notification delivery and retry status.

3. **Product workflow depth**
   - Build Response Workspace.

## Completed Phase: Account / Role / Tier Foundation

本阶段完成：
- `users` 增加 `account_tier` 与 `is_disabled`，迁移会兼容已有本地库。
- `/api/auth/session`、注册、登录返回 `role`、`tier`、`features`。
- 新增中心化 entitlement map，覆盖 Free/Pro/Business/Enterprise 与 admin-only 功能。
- 新增 Admin 用户管理 API：注册用户列表、改角色、改套餐、启用/禁用。
- `/admin` 接入用户权限表，普通用户侧边栏不再显示 Admin 入口。

当前还剩：
1. Billing provider 同步与真实 checkout/发票/取消订阅。
2. Organization team management：成员角色调整、移除、owner 转移。
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
2. Organization team management：成员角色调整、移除、owner 转移。
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
2. Organization team management：成员角色调整、移除、owner 转移。
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
2. Organization team management：成员角色调整、移除、owner 转移。
3. Account deletion/export 账号数据导出与删除。
4. Submission Guidance 真实编辑与确认 UI。

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
3. Organization team management：成员角色调整、移除、owner 转移。
4. Account deletion/export 账号数据导出与删除。
5. Submission Guidance 真实编辑与确认 UI。

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
3. Organization team management：成员角色调整、移除、owner 转移。
4. Account deletion/export 账号数据导出与删除。

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
4. Account deletion/export 账号数据导出与删除。
5. Organization team management：成员角色调整、移除、owner 转移。
6. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。

建议下一步：
- 优先开发 Compliance Manifest Lite，因为它直接承接 Submission Guidance，让用户开始把投标要求转成可执行清单。

## Completed Phase: Admin Page Access Guard

本阶段完成：
- `/admin` 页面接入当前 session 权限判断。
- 未登录用户访问 `/admin` 时显示登录提示和登录入口。
- 已登录但非 admin 用户访问 `/admin` 时显示无权限提示和返回控制台入口。
- 只有 admin 用户才触发 admin 数据源、用户、审计日志等管理 API 加载。
- 补齐中英文权限状态文案和 admin 页面静态检查测试。

验证：
- `npm test -- src/app/admin/page.test.ts`
- `npm test -- src/app/admin/page.test.ts src/app/layout.test.ts src/lib/api/admin.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`
- 浏览器烟测：打开 `/admin`，当前 admin 会话正常进入“管理员运维”页面。

当前还剩：
1. Compliance Manifest Lite：结构化需求、人工完成状态、备注和证据状态。
2. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。
3. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
4. Account deletion/export 账号数据导出与删除。
5. Organization team management：成员角色调整、移除、owner 转移。
6. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。

建议下一步：
- 继续做 Organization team management，补齐成员角色调整、移除、owner 转移。

## Completed Phase: Admin User Invite Flow

本阶段完成：
- 新增 admin repository `createAdminUserInvite()`，可创建本地邀请账号并生成临时密码。
- 新增 `/api/admin/users` POST，管理员可创建账号并指定角色、套餐、显示名称。
- 创建邀请账号时写入 `admin_user_audit_logs`，action 为 `user_invited`。
- 前端 admin API client 新增 `createAdminUser()`。
- `/admin` 用户权限区新增邀请表单：邮箱、显示名称、角色、套餐，并显示一次性临时密码。
- 补齐中英文文案和 repository/route/client/page 测试。

验证：
- `npm test -- src/server/admin/users-repository.test.ts src/app/api/admin/users/route.test.ts src/lib/api/admin.test.ts src/app/admin/page.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`
- 浏览器烟测：打开 `/admin`，确认“邀请用户”表单、角色/套餐选择和“创建邀请”按钮已渲染。

当前还剩：
1. Organization team management：成员角色调整、移除、owner 转移。
2. Account deletion/export 账号数据导出与删除。
3. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
4. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。
5. Compliance Manifest Lite：结构化需求、人工完成状态、备注和证据状态。
6. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。

建议下一步：
- 优先做 Organization team management，因为账号、角色、套餐、恢复闭环和团队共享数据已经具备，下一块应补齐成员生命周期。

## Completed Phase: Password Reset Flow

本阶段完成：
- 新增 `password_reset_tokens` 表与迁移，保存一次性 token hash、过期时间、使用时间。
- 新增密码重置服务：请求重置、生成本地 reset token、未知邮箱不泄露账号存在性、确认 token 后更新密码。
- token 使用后会标记 `used_at`，过期/已使用/无效 token 都会拒绝；重置成功后清理该用户已有 session。
- 新增 `/api/auth/password-reset/request` 与 `/api/auth/password-reset/confirm`。
- 前端 API client 新增 `requestPasswordReset()` 与 `confirmPasswordReset()`。
- 登录页新增“忘记密码”入口；新增 `/forgot-password` 和 `/reset-password` 双语页面。

验证：
- `npm test -- src/server/auth/password-reset.test.ts src/server/db/schema.test.ts src/app/api/auth/password-reset/request/route.test.ts src/app/api/auth/password-reset/confirm/route.test.ts src/lib/api/auth.test.ts src/app/login/page.test.ts src/app/forgot-password/page.test.ts src/app/reset-password/page.test.ts`

当前还剩：
1. Organization team management：成员角色调整、移除、owner 转移。
2. Account deletion/export 账号数据导出与删除。
3. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
4. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。
5. Compliance Manifest Lite：结构化需求、人工完成状态、备注和证据状态。
6. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。

建议下一步：
- 优先开发 Organization team management，让普通账号、admin、套餐等级和未来高级功能真正落到可管理的公司团队上。

## Completed Phase: Organization / Workspace Foundation

本阶段完成：
- 新增 `organizations` 与 `organization_memberships` 表，支持组织和 owner/member 工作区角色。
- 注册普通用户时自动创建默认 organization，并写入 owner membership。
- 旧用户在读取 session/workspace 时会自动补齐个人工作区，兼容已有本地数据库。
- `/api/auth/session` 的用户 payload 可携带当前 workspace 信息：organizationId、organizationName、role。
- 新增 workspace 服务：读取工作区、修改组织名称、owner 邀请本地成员、member 管理操作会被拒绝。
- 新增 `/api/account/workspace` GET/PATCH 与 `/api/account/workspace/members` POST。
- 前端 API client 新增 `fetchAccountWorkspace()`、`updateAccountWorkspace()`、`inviteWorkspaceMember()`。
- `/settings` 新增 Team 标签页，可查看工作区、修改名称、邀请成员并显示一次性临时密码。

验证：
- `npm test -- src/server/account/workspace.test.ts src/server/db/schema.test.ts src/app/api/auth/session/route.test.ts src/app/api/account/workspace/route.test.ts src/app/api/account/workspace/members/route.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts src/server/auth/service.test.ts`

当前还剩：
1. Organization team management：成员角色调整、移除、owner 转移。
2. Account deletion/export 账号数据导出与删除。
3. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
4. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。
5. Compliance Manifest Lite：结构化需求、人工完成状态、备注和证据状态。
6. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。

建议下一步：
- 继续做 Organization team management，补齐成员角色调整、移除、owner 转移。

## Completed Phase: Organization Shared Workspace Data

本阶段完成：
- 新增 workspace scope 工具：认证用户按所属 organization 的 active members 解析数据范围，匿名用户保持单用户 cookie 范围。
- Saved bids 支持组织共享：owner/member 任一方保存后，同 workspace 成员都能在 `/api/saved-bids` 看到；重复保存同一 bid 会复用已有记录；删除会从 workspace 视图移除。
- Intent workspace 支持组织共享：owner/member 任一方创建后，同 workspace 成员可在 `/api/intents` 与 `/api/intents/[id]` 读取同一 intent。
- Intent 创建按 workspace 维度幂等：同一 workspace 内同一 bid 只复用一个 intent，不会因为不同成员重复创建而分裂。
- Intent 状态更新按 workspace 授权：同 workspace 成员可更新共享 intent；其他 workspace 用户不可读取或更新。
- Saved bids 与 intent usage limits 改为 workspace 范围计数，避免免费/付费额度被成员拆分绕过。

验证：
- `npm test -- src/server/bids/repository.test.ts src/server/intents/service.test.ts src/server/auth/usage-limits.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`
- API 烟测：owner 注册并邀请 member；owner 保存 bid 与创建 intent；member 登录后能读取同一 saved bid 和 intent。

当前还剩：
1. Organization team management：成员角色调整、移除、owner 转移。
2. Account deletion/export 账号数据导出与删除。
3. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
4. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。
5. Compliance Manifest Lite：结构化需求、人工完成状态、备注和证据状态。
6. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。

建议下一步：
- 继续做 Organization team management：先实现 owner 修改成员角色、移除成员、禁止移除最后一个 owner，再接 Settings Team UI。

## Completed Phase: Organization Team Management

本阶段完成：
- Workspace service 新增成员角色调整与成员移除能力，只有 workspace owner 可以执行。
- 系统会阻止降级或移除最后一个 active owner，避免团队失去管理者。
- 被移除成员会退出原 organization；再次访问 workspace 时会回到自己的个人工作区。
- 新增 `/api/account/workspace/members/[userId]` PATCH/DELETE，分别用于调整角色和移除成员。
- 前端 API client 新增 `updateWorkspaceMemberRole()` 与 `removeWorkspaceMember()`。
- `/settings` Team 标签页接入成员角色下拉和移除按钮，并补齐中英文状态文案。

验证：
- `npm test -- src/server/account/workspace.test.ts src/lib/api/auth.test.ts 'src/app/api/account/workspace/members/[userId]/route.test.ts' src/app/settings/page.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`

当前还剩：
1. Compliance Manifest Lite：结构化需求、人工完成状态、备注和证据状态。
2. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。
3. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
4. Account deletion/export 账号数据导出与删除。
5. Organization team lifecycle：owner 转移流程、成员禁用/恢复、邀请接受/邮件投递。
6. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。

建议下一步：
- 优先开发 Compliance Manifest Lite，把 Submission Guidance 生成的提交要求沉淀为可勾选、可备注、可追踪证据状态的执行清单。

## Completed Phase: Compliance Manifest Lite

本阶段完成：
- 新增 `compliance_manifest_items` 表与迁移，用于保存 Intent 维度的结构化合规清单。
- 新增 Compliance Manifest 生成器：基于 Intent 初始清单、风险提示和基础投标准备项生成合规条目。
- 新增 Compliance service/repository，支持按可访问 Intent 创建清单、读取清单、更新条目状态、证据状态和备注。
- 新增 `/api/intents/[id]/compliance` GET/PATCH，并使用 `compliance_manifest` feature gate；Business/Enterprise 可访问，Pro/Free 会返回 `FEATURE_NOT_AVAILABLE`。
- 前端 API client 新增 `fetchComplianceManifest()` 与 `updateComplianceManifestItem()`。
- Intent 工作台新增 Compliance Manifest 面板：低套餐显示锁定说明；Business+ 显示完成概览、条目状态、证据状态和备注编辑。
- 补齐中英文文案和静态页面检查。

验证：
- `npm test -- src/server/compliance/service.test.ts 'src/app/api/intents/[id]/compliance/route.test.ts' src/lib/api/intents.test.ts src/server/db/schema.test.ts src/app/intents/page.test.ts`
- `npm test`
- `npm run lint`
- `npm run db:migrate`
- `npm run build`
- 浏览器烟测：从 bid detail 创建 Intent，打开 Intent 工作台，确认 Compliance Manifest 面板渲染 8 条清单、完成概览和证据备注输入。

当前还剩：
1. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。
2. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
3. Account deletion/export 账号数据导出与删除。
4. Organization team lifecycle：owner 转移流程、成员禁用/恢复、邀请接受/邮件投递。
5. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。
6. Response Workspace：任务、文档、内部检查点和附件/证据管理。

建议下一步：
- 开发 Pursue / No-Bid Decision Lite，让 Pro+ 用户能基于匹配、风险、合规清单进度记录是否继续投标及原因。

## Completed Phase: Pursue / No-Bid Decision Lite

本阶段完成：
- 新增 `pursuit_decisions` 表与迁移，用于保存 Intent 维度的投标/放弃决策历史。
- 新增 Pursuit recommendation generator，基于匹配分数、风险提示、资料缺口和截止日期生成 `pursue` / `no_bid` / `review` 推荐。
- 新增 Pursuit service/repository，支持读取推荐、读取当前决策、保存新决策记录、返回历史记录。
- 新增 `/api/intents/[id]/decision` GET/PATCH，并使用 `pursue_no_bid` feature gate；Pro/Business/Enterprise 可访问，Free 会返回 `FEATURE_NOT_AVAILABLE`。
- 前端 API client 新增 `fetchPursuitDecisionBoard()` 与 `updatePursuitDecision()`。
- Intent 工作台新增 Pursue / No-Bid Decision 面板：低套餐显示锁定说明；Pro+ 显示推荐、置信度、决策选择、原因、备注和历史记录。
- 补齐中英文文案和静态页面检查。

验证：
- `npm test -- src/server/pursuit/service.test.ts 'src/app/api/intents/[id]/decision/route.test.ts' src/lib/api/intents.test.ts src/server/db/schema.test.ts src/app/intents/page.test.ts`
- `npm test`
- `npm run lint`
- `npm run db:migrate`
- `npm run build`
- 浏览器烟测：打开 Intent 工作台，确认 Pursue / No-Bid Decision 面板、推荐区、保存决策按钮和决策历史渲染。

当前还剩：
1. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
2. Account deletion/export 账号数据导出与删除。
3. Organization team lifecycle：owner 转移流程、成员禁用/恢复、邀请接受/邮件投递。
4. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。
5. Response Workspace：任务、文档、内部检查点和附件/证据管理。
6. Production AI layer：LLM-backed extraction、引用、置信度和不确定性处理。

建议下一步：
- 优先做 Billing Provider Sync，把当前本地套餐/权限基础接到真实 checkout、webhook 和订阅状态同步上。

## Completed Phase: Billing Provider Sync Foundation

本阶段完成：
- 新增 `billing_checkout_sessions` 表，记录用户自助升级 checkout session。
- `subscription_events` 增加 `provider_event_id`，provider webhook 重放时可去重。
- 新增订阅服务能力：创建 Pro/Business checkout、接收 `checkout.completed` / `subscription.updated` / `subscription.deleted` provider event、同步 `account_subscriptions` 与 `users.account_tier`、安排 period end 取消。
- 新增 `/api/account/subscription/checkout`、`/api/account/subscription/cancel`、`/api/billing/webhook`。
- 前端 API client 接入 checkout/cancel。
- `/settings` Billing 标签页支持 Pro/Business 自助开始结账、显示 checkout 状态消息、取消当前订阅。

验证：
- `npm test -- src/server/billing/subscriptions.test.ts src/app/api/account/subscription/checkout/route.test.ts src/app/api/account/subscription/cancel/route.test.ts src/app/api/billing/webhook/route.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts src/server/db/schema.test.ts`

当前还剩：
1. Production Billing Provider Hardening：真实 provider credentials/config、webhook signature、hosted checkout redirect、customer portal。
2. Invoice / Payment History UI：发票记录、provider invoice link、账单历史。
3. Trial / Dunning Lifecycle：试用到期、扣款失败、逾期提醒、降级规则。
4. Account deletion/export 账号数据导出与删除。
5. Organization team lifecycle：owner 转移、成员禁用/恢复、邀请接受/邮件投递。

建议下一步：
- 继续做 Invoice / Payment History UI + Production Billing Provider Hardening；如果先补账户完整性，则做 Account deletion/export 与 owner 转移。

## Completed Phase: Invoice / Payment History + Webhook Signature Foundation

本阶段完成：
- 新增 `billing_invoices` 表，记录 provider invoice id、invoice number、金额、币种、状态、发票链接、PDF 链接、到期/支付时间。
- `applyBillingProviderEvent()` 支持 `invoice.paid` 与 `invoice.payment_failed`，能写入发票历史，并在支付失败时把订阅状态同步为 `past_due`。
- 新增 `listAccountInvoices()` 服务和 `/api/account/billing/invoices`，登录用户可读取自己的账单/发票历史。
- `/api/billing/webhook` 支持 `invoice.*` event，并在配置 `BILLING_WEBHOOK_SECRET` 时要求 `x-billing-signature` HMAC-SHA256 校验。
- 前端 API client 新增 `fetchBillingInvoices()`。
- `/settings` Billing 标签页新增 Invoice history 区域，展示发票编号、状态、金额、日期和发票链接。

验证：
- `npm test -- src/server/billing/subscriptions.test.ts src/server/db/schema.test.ts src/app/api/account/billing/invoices/route.test.ts src/app/api/billing/webhook/route.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts`

当前还剩：
1. Production Billing Provider Hardening：真实 provider SDK/config、hosted checkout redirect、customer portal、provider-specific event mapping、部署环境变量说明。
2. Trial / Dunning Lifecycle：试用到期、扣款失败重试、逾期提醒、自动降级规则。
3. Invoice / Payment History Polish：PDF 下载体验、筛选、支付重试链接、更完整的发票详情。
4. Account deletion/export 账号数据导出与删除。
5. Organization team lifecycle：owner 转移、成员禁用/恢复、邀请接受/邮件投递。

建议下一步：
- 如果继续商业化主线，做 Production Billing Provider Hardening + Customer Portal；如果补账户闭环，做 Account deletion/export + owner 转移。

## Completed Phase: Hosted Billing Provider + Customer Portal Foundation

本阶段完成：
- `createCheckoutSession()` 支持 `BILLING_CHECKOUT_URL_TEMPLATE`，配置后生成 hosted checkout URL，并填充 `providerSessionId`、`tier`、`userId`、`successUrl`、`cancelUrl`。
- 新增 `createCustomerPortalSession()`，支持 `BILLING_CUSTOMER_PORTAL_URL_TEMPLATE`，配置后用 provider customer id 生成 customer portal URL；未配置时回退本地 Settings。
- 新增 `/api/account/billing/portal`，登录用户可创建自己的账单门户会话。
- 前端 API client 新增 `createBillingPortalSession()`。
- `/settings` Billing 标签页新增 Manage Billing 入口，统一进入本地/hosted 账单门户。
- 补齐中英文账单门户文案。

验证：
- `npm test -- src/server/billing/subscriptions.test.ts src/app/api/account/billing/portal/route.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts`
- `npm test`
- `npm run lint`
- `npm run db:migrate`
- `npm run build`
- `git diff --check`
- 浏览器烟测：打开 `/settings`，切换 Billing/账单标签，确认“管理账单”“打开账单门户”和发票区域渲染。

当前还剩：
1. Production Billing Provider SDK/API：接真实 Stripe/其他 provider SDK、真实 hosted checkout/customer portal session 创建、sandbox credentials。
2. Provider-specific event mapping：把真实 provider payload 转换为当前内部 `BillingProviderEvent`。
3. Trial / Dunning Lifecycle：试用到期、扣款失败重试、逾期提醒、自动降级规则。
4. Invoice / Payment History Polish：PDF 下载体验、筛选、支付重试链接、更完整的发票详情。
5. Account deletion/export 账号数据导出与删除。
6. Organization team lifecycle：owner 转移、成员禁用/恢复、邀请接受/邮件投递。

建议下一步：
- 如果继续商业化主线，做真实 provider SDK/API adapter；如果先补账户闭环，做 Account deletion/export + owner 转移。

## Completed Phase: Account Export / Deletion + Owner Transfer

本阶段完成：
- 新增 `exportAccountData()`，导出当前用户账户、工作区、订阅/发票、收藏、供应商资料、投标意向、Submission/Compliance/Pursuit 数据和搜索提醒。
- 新增 `softDeleteAccount()`，软删除会匿名化邮箱、清空密码、禁用账户、清理 session/reset token，并移除 active workspace 访问。
- 删除账户时，如果当前用户是仍有其他 active 成员的唯一 owner，会返回 `OWNER_TRANSFER_REQUIRED`，要求先转让 owner。
- 新增 `transferWorkspaceOwnership()`，owner 可把工作区 owner 转给其他 active 成员，自己降为 member。
- 新增 `/api/account/export`、`DELETE /api/account`、`/api/account/workspace/ownership`。
- 前端 API client 新增 `exportAccountData()`、`deleteAccount()`、`transferWorkspaceOwnership()`。
- `/settings` Security 标签新增账户数据导出和删除账户入口；Team 标签新增显式“转让 Owner”操作。
- 补齐中英文账户生命周期文案。

验证：
- `npm test -- src/server/account/lifecycle.test.ts src/app/api/account/export/route.test.ts src/app/api/account/route.test.ts src/app/api/account/workspace/ownership/route.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts`
- `npm test`
- `npm run db:migrate`
- `npm run lint`
- `npm run build`
- `git diff --check`
- 浏览器烟测：打开 `/settings`，Security/安全 标签显示“导出账户数据”“删除账户”；Team/团队 标签显示“转让 Owner”。

当前还剩：
1. Production Billing Provider SDK/API：接真实 Stripe/其他 provider SDK、真实 hosted checkout/customer portal session 创建、sandbox credentials。
2. Provider-specific event mapping：把真实 provider payload 转换为当前内部 `BillingProviderEvent`。
3. Trial / Dunning Lifecycle：试用到期、扣款失败重试、逾期提醒、自动降级规则。
4. Invoice / Payment History Polish：PDF 下载体验、筛选、支付重试链接、更完整的发票详情。
5. Organization team lifecycle：成员禁用/恢复、邀请接受/邮件投递。
6. Usage Dashboard：展示当前使用量与套餐额度。

建议下一步：
- 如果继续权限/账户主线，做成员禁用/恢复 + 邀请接受；如果继续商业化主线，做真实 provider SDK/API adapter。

## Completed Phase: Workspace Member Disable / Restore + Invitation Acceptance

本阶段完成：
- `organization_memberships.status` 现在支持 `active`、`invited`、`disabled`，Team 列表会展示成员状态。
- 新增 `workspace_invitations` 表，保存邀请 token hash、邀请人、被邀请用户、过期时间和接受时间。
- 邀请成员时不再直接给临时密码，而是创建 pending invited 用户、invited membership 和本地 invite URL。
- 新增 `acceptWorkspaceInvitation()`，被邀请用户可通过 token 设置密码并激活 membership，同时创建 session。
- 新增成员 `disableWorkspaceMember()` / `restoreWorkspaceMember()`，Owner 可暂停/恢复成员访问；停用会清理该成员 session 并排除在 workspace usage scope 之外。
- 新增 `/api/account/workspace/invitations/accept`，并扩展 `/api/account/workspace/members/[userId]` 支持 status PATCH。
- 前端 API client 新增 `acceptWorkspaceInvitation()` 与 `setWorkspaceMemberStatus()`。
- 新增 `/accept-invite` 页面，支持输入 token、显示名称、密码并接受邀请。
- `/settings` Team 标签显示 invited/disabled 状态、邀请链接、停用/恢复按钮。
- 补齐中英文邀请接受、成员状态、停用/恢复文案。

验证：
- `npm test -- src/server/account/workspace.test.ts src/server/db/schema.test.ts src/app/api/account/workspace/members/route.test.ts src/app/api/account/workspace/members/[userId]/route.test.ts src/app/api/account/workspace/invitations/accept/route.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts src/app/accept-invite/page.test.ts`
- `npm run lint`
- `npm run build`

当前还剩：
1. Production Billing Provider SDK/API：接真实 Stripe/其他 provider SDK、真实 hosted checkout/customer portal session 创建、sandbox credentials。
2. Provider-specific event mapping：把真实 provider payload 转换为当前内部 `BillingProviderEvent`。
3. Trial / Dunning Lifecycle：试用到期、扣款失败重试、逾期提醒、自动降级规则。
4. Invoice / Payment History Polish：PDF 下载体验、筛选、支付重试链接、更完整的发票详情。
5. Production Notification Delivery：把本地 notification outbox 接到真实邮件服务、重试与投递状态。
6. Usage Dashboard：展示当前使用量与套餐额度。

建议下一步：
- 如果继续权限/账户主线，做 Usage Dashboard + entitlement coverage audit；如果继续商业化主线，做真实 provider SDK/API adapter。

## Completed Phase: Workspace Invitation Resend / Revoke + Local Email Outbox

本阶段完成：
- `workspace_invitations` 增加 `revoked_at` 与 `last_sent_at`，迁移兼容已有本地库。
- `inviteWorkspaceMember()` 会向 `notification_outbox` 写入本地邀请邮件记录，内容包含 invite URL。
- 新增 `resendWorkspaceInvitation()`，Owner 可为 pending invitation 轮换 token、延长过期时间并再次写入通知 outbox。
- 新增 `revokeWorkspaceInvitation()`，Owner 可撤销 pending invitation；撤销后旧 token 不可接受，并释放被邀请邮箱供后续重新邀请。
- 新增 `/api/account/workspace/invitations/[userId]/resend` 与 `/api/account/workspace/invitations/[userId]`。
- 前端 API client 新增 `resendWorkspaceInvitation()` 与 `revokeWorkspaceInvitation()`。
- `/settings` Team 标签对待接受成员显示“重发邀请 / 撤销邀请”，重发后展示新的邀请链接。
- 补齐中英文邀请重发、撤销、确认文案。

验证：
- `npm test -- src/server/account/workspace.test.ts src/server/db/schema.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts src/app/api/account/workspace/invitations/[userId]/resend/route.test.ts src/app/api/account/workspace/invitations/[userId]/route.test.ts`

当前还剩：
1. Production Billing Provider SDK/API：接真实 Stripe/其他 provider SDK、真实 hosted checkout/customer portal session 创建、sandbox credentials。
2. Provider-specific event mapping：把真实 provider payload 转换为当前内部 `BillingProviderEvent`。
3. Trial / Dunning Lifecycle：试用到期、扣款失败重试、逾期提醒、自动降级规则。
4. Invoice / Payment History Polish：PDF 下载体验、筛选、支付重试链接、更完整的发票详情。
5. Production Notification Delivery：把 notification outbox 接到真实邮件服务、投递重试、投递状态展示与偏好。
6. Usage Dashboard：展示当前使用量与套餐额度。
7. Entitlement Coverage Audit：确认所有未来高级功能 API 与 UI 都走统一 feature gate。

建议下一步：
- 如果继续权限/账户主线，做 Usage Dashboard + entitlement coverage audit；如果继续商业化主线，做 Production Billing Provider SDK/API Adapter。

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
