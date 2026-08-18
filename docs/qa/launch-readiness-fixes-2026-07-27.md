# 上线阻塞项修复报告（2026-07-27）

基线：`main` @ `56569b9`
改动：**242 个文件，+11,134 / −1,367**，其中新增 65 个文件
配套审计报告：`docs/qa/launch-readiness-audit-2026-07-27.md`

---

## 一、回归结果（全部实跑，非引用）

| 门禁 | 修复前 | 修复后 |
|---|---|---|
| `npm run lint` | ✅ exit 0 | ✅ exit 0 |
| `npm run build` | ✅ 30.0s | ✅ 25.1s |
| standalone 里的测试文件 | ⚠️ 13 个进生产镜像 | ✅ **0 个** |
| `npx tsc --noEmit` | 315 错误（全在测试） | 344 错误（全在测试）**生产源码仍为 0** |
| `npm test` | 281 文件 / 1,569 用例 | ✅ **291 文件 / 1,790 用例全通过** |
| `crawler pytest` | 209 通过 | ✅ **249 通过** |
| **`npm run risk:check`** | ❌ **exit 1** | ✅ **exit 0，10/10 项 PASS** |
| ├ state-coverage | ❌ 5/50 州 | ✅ **50/50 州** |
| ├ secrets:scan | 被 `&&` 短路，从未在 CI 执行 | ✅ 932 文件 / 0 findings |
| └ npm audit（生产依赖） | **9 个漏洞（5 high）** | ✅ **0 个漏洞** |

新增测试约 **221 个前端用例 + 40 个爬虫用例**，覆盖本轮每一条修复。

---

## 二、按修复线的改动

### A 线 — 计费正确性

- **`invoice.*` 事件清空订阅周期末（最贵的 bug）** — `billing/providers.ts:109-131` 新增 `stripeInvoicePeriodEnd()` 从 `lines.data[].period.end` 取真实周期末；`invoice.paid` 带上，`invoice.payment_failed` 不带（取到未付周期会把宽限期反向推后一个月）；两者都不再输出 `cancelAtPeriodEnd`。落库层（`subscriptions.ts:830`、`mysql-subscriptions.ts:430`）改为**部分更新语义**——`undefined` 保留库中原值，只有显式 `null` 才清空。SQLite 与 MySQL 双路径。
- **webhook fail-closed** — `api/billing/webhook/route.ts:47-62` 缺 `BILLING_WEBHOOK_SECRET` 一律拒绝；逃生阀 `BILLING_WEBHOOK_ALLOW_UNSIGNED=1` 必须显式设置，且在生产类运行时无效。
- **催缴窗口被已结清账单占满** — `dunning.ts:163/255` 把 `status='payment_failed'` 下推 SQL（原先取 100 条再在 JS 里过滤，导致第 101 条之后的新失败账单永远进不了催缴且无报错）。
- **`provider_event_id` 唯一索引** — `migrate.ts:879` 挪进 `sqlite.exec` 块，MySQL 迁移现在能提取到它，列型自动生成为 `VARCHAR(191)`。webhook 幂等不再是 check-then-act。
- **生产忘设 `BILLING_PROVIDER` 静默走 local** — `providers.ts:372-396` 新增 `assertBillingProviderForRuntime()`，生产类运行时必须显式为 `stripe` 且有 `STRIPE_SECRET_KEY`，否则 checkout/portal/cancel 三条路径全部 fail-fast，不再返回 200 + 自指 URL。

### B 线 — 安全

- **限流被 XFF 绕过** — `security/request-ip.ts:9-63` 改为按 `TRUSTED_PROXY_HOP_COUNT`（默认 1）**从右往左**取 XFF 条目，越界钳制到最左。测试断言 4 种伪造前缀全部落到同一限流桶。
- **附件下载无鉴权 + 全量入内存** — `api/bids/[id]/attachments/[attachmentId]/route.ts:66-135` 加 `resolvePrincipal` 鉴权；`readFile` 改 `createReadStream` + `Readable.toWeb()` 流式响应，补 `Content-Length` 与 `nosniff`，Content-Type 用白名单重新推导（不再回放爬虫存的 mime）。
- **上传次序错误** — `intents/[id]/artifacts/route.ts:88-127` 与 `[artifactId]/route.ts:155-204` 把 `requireFeature` 提到 `formData()` 之前，并加 `exceedsRequestBodyLimit`（新模块 `security/request-body-limit.ts`，30MB）。测试用 spy 断言未授权用户被拒时 `formData` 从未被调用。
- **五处安全分支共用 `NODE_ENV`** — 新建 `security/runtime-env.ts`，`admin/auth.ts`、`auth/session.ts`、`password-reset/request/route.ts`、`webhooks/ses/route.ts` 统一改用；`ADMIN_UI_LOCAL_BYPASS` 与重置 token 回显改为"非生产 + 显式开启"双条件。
- **`CRAWLER_RUN_TOKEN` fail-open** — 新建 `security/crawler-run-token.ts`（含 `timingSafeEqual`），两个 crawler run 路由删掉 `if (!requiredToken) return true`，缺 token 一律 401。
- **CSRF 覆盖 26 个路由** — 全部 `intents/**`(16)、`saved-bids/**`(2)、`search-alerts/**`(2)、`company/profile`、`bids/[id]/intent`、`auth/login|logout|register`。`csrf.ts` 两处 fail-open 修掉（无 Origin 无 Referer 在生产下拒绝；生产不再回退信任 `Host` 头，必须显式 `APP_ORIGIN`）。新增 `csrf-route-coverage.test.ts` 枚举所有写方法路由，未加 CSRF 又不在豁免名单即失败。**豁免有据**：三个 webhook（签名鉴权）、邀请接受（token 无 session）、密码重置（会打断从邮件客户端打开的链接）、两个匿名营销表单。
- **全站零安全响应头** — `next.config.ts` 加 `headers()`：CSP、`nosniff`、`Referrer-Policy`、`X-Frame-Options: DENY`、`Permissions-Policy`、COOP、生产 HSTS。新建 `storage/content-type.ts` 按扩展名白名单 + magic byte 推导，`.html/.svg/.js` 等一律降级为 `application/octet-stream`。
- **`securityScanStatus` 硬编码 clean** — 原诊断需修正：`supplier_artifacts` 表根本没有该列（那两列属于 `artifact_versions`）。改为从最新版本行派生，无版本行时默认 `"pending"` 而非谎称 `"clean"`。
- **改密不失效其它会话** — `auth/service.ts:278-330` + `mysql-service.ts:336-374` 加 `keepSessionToken` 选项，改密后删除该用户其它全部 session。
- **未认证接口回显驱动原始报错** — `health/route.ts:88-140`、`health/scrapers/route.ts:10-29` 生产下只返回最小信息，细节进结构化日志。

### C 线 — 性能与数据层

- **`/api/bids` 全表扫描无分页** — `bids/repository.ts` 把 `is_active`、关键词、州、issuerType、日期区间、排序全部下推 SQL，加 `LIMIT/OFFSET`，附件只按当前页 id 拉取。`api/bids/route.ts:64` 新增 `page`/`pageSize`（默认 100，上限 200），响应**只加字段**不改旧语义。新增 `bids/query-pushdown.test.ts`（32 例）——**用旧的内存实现作为 oracle**，对 26 种查询组合逐一比对 SQL 结果完全一致。日期用半开区间保持 sargable；`source` 子串匹配保持大小写敏感（否则州码 "IN" 会命中 "Illinois … Bulletin"）。
  量化：1,147 行下单请求堆占用 ~4.5MB → ~400KB；10 万行下 ~400MB → 与页大小无关的常数级，OOM 消除。
- **收藏夹全表加载** — `service.ts:165/265` 改用 `listBidsByIds*`（`WHERE id IN (…)` 按 500 分块）。10 万行下 SQL 文本从 ~4MB / 10 万占位符降到 ≤10 个。
- **首页 5 次全表加载** — `dashboard/summary.ts` 改走 `COUNT(*)`；`risk/checklist.ts:387/498` 两条路径改为只加载一次。全表加载 5→1 次，10 万行下瞬时堆 ~2GB → ~400MB。
- **outbox 无 claim，多副本必然重复投递** — `notifications/outbox-repository.ts:464/522` 与 `events/event-log.ts:423/479` 改为「候选 SELECT → 条件 UPDATE 抢占租约 → 按 owner 回读」，租约到期自动释放（默认 120s 可调）。测试断言两个"副本"不会拿到同一行。重复投递从"2 副本 × 25 行/tick 全量重复"降为 0。
- **`execFile` 无 timeout/maxBuffer** — `crawler/state-runner.ts:162`、`sam-gov-runner.ts:162` 加 timeout（state 5min / SAM 10min，可配）、`killSignal: SIGKILL`、`maxBuffer` 64MB。MySQL 模式的 `--output-json` 从"每次必失败"变为可用；单源卡死不再永久阻塞 53 源串行队列。
- **MySQL 无 TLS** — `db/mysql.ts:71/87` 支持 `MYSQL_SSL` / `MYSQL_SSL_CA`（RDS global bundle）/ `MYSQL_SSL_REJECT_UNAUTHORIZED`，`minVersion TLSv1.2`；并加 `connectTimeout` 10s、`idleTimeout` 60s、`maxIdle`、`enableKeepAlive`、`queueLimit` 默认 50（原为 0 = 无限排队无超时）。
- **`ER_DUP_ENTRY` 被当作已跳过** — `db/mysql.ts:15` 只保留 `ER_DUP_KEYNAME`。唯一索引因存量重复值建不出来时不再静默降级。
- **新增 3 个索引** — `idx_bids_active_published`、`idx_bids_active_display_status_id`、`idx_bids_active_issuer_type_deadline`；`idx_bids_active_deadline` 因 `is_active` 现在进 WHERE 而真正可用。

### D 线 — 爬虫合规

新建共享 HTTP 层 `crawler/apsi_crawler/net/`（`identity` / `client` / `robots` / `throttle` / `approval` / `config` / `errors`）+ `sources/bidnet_policy.py`。

- **诚实 UA** — `net/identity.py:50` 生成 `APSiBot/1.0 (+https://<domain>/bot; ops@<domain>)`，域名/邮箱走 `APSI_BOT_DOMAIN`/`APSI_BOT_CONTACT_EMAIL`，另发 `From` 头。`net/client.py:42` 把身份头合入每个请求且**调用方无法覆盖**。13 处 Chrome/Mozilla 串已清除，`test_no_spider_ships_a_browser_user_agent` 防回归。
- **移除规避逻辑** — `de_bids.py:52`、`ga_procurement_registry.py:100`、`ms_contract_bid_search.py:123`、`ia_bid_opportunities.py:79` 删掉暖 cookie 的预热 GET 与伪造 `Referer`/`Origin`/`X-Requested-With`；额外清理了同型的 `ut_bonfire.py:48`、`va_eva.py:221`。`net/client.py:28` 设 `IMPERSONATION_HEADERS` 黑名单在共享层强制剥离，防止任何 spider 再写回去。
- **遵守 robots.txt** — `net/robots.py` 用 `urllib.robotparser`，按 origin 缓存（默认 1h）。每个请求前 `check()`，禁止时抛 `RobotsDisallowedError` **且完全不发请求**。5xx 与网络错误**默认 fail-closed**。
- **每域限速与退避** — `net/throttle.py:105` 全局并发信号量（默认 4）→ 每 origin 串行锁 → 补足最小间隔（抖动 2–5s，robots `Crawl-delay` 永远优先）；`:131` 处理 429/503 的 `Retry-After`（秒数与 HTTP-date 两种），无该头则指数退避。附件下载走单独的 asset profile（0.5–1.5s）以免全量跑超出 15 分钟 tick。
- **kill switch** — `net/approval.py` + `cli.py:121`。**默认拒绝**：不传允许列表则什么都不抓。允许列表由已持有数据库连接的前端侧传入（`--approved-source` / `APSI_APPROVED_SOURCE_IDS`），避免给爬虫引入 MySQL driver 和第二套凭据。
- **BidNet 显式 opt-in** — `sources/bidnet_policy.py:46` 把 19 个 id 收敛为唯一真相（17 个 `state_bidnet` + CO + WV），模块 docstring 写明开关理由与开启前必须完成的 5 项。代码全部保留，只加策略门：未设 `APSI_ENABLE_BIDNET_SOURCES=1` 时这些源不启用，runner 跳过并给出理由，`co_bidnet.py:69` 作为最后一道防线。

### E 线 — 运维与 CI

- **三个 worker 的 Sentry 全部报废** — `crawler-worker.ts:280`、`event-worker.ts:193`、`notification-worker.ts:404` 各加 `initSentry("worker")`。此前 worker 崩溃时的 `captureException` 被静默丢弃。
- **通知 worker 与 runbook 矛盾** — `notification-worker.ts:6` 白名单加 `ses`/`sendgrid`，`:167` 补对应 env 校验（from-address 格式、region、access-key 必须成对、API key）。provider 实现本就完整可用，只是白名单没放行。
- **无退信抑制名单** — 新建 `notifications/providers/suppression.ts` + 两张表（`notification_suppressions`、`notification_delivery_backoff`）。投递前查抑制与退避窗口；硬退信/complaint 写入抑制；失败写指数退避（5min 起，封顶 6h）。`delivery-events.ts:70` 让 webhook 收到退信时**实时**写抑制。此前 `failed` 行会被下一 tick 立即重选，对刚退信的地址反复重发，SES 账号会被封。
- **PDF 导出 44 行截断 + 中文乱码** — `response-workspace/service.ts:1046-1240` 重写：删掉 `.slice(0, 44)` 改为真正分页；`/WinAnsiEncoding` + `encodePdfLiteral`，Latin-1 可表示字符正确渲染，CJK 输出可逆的 `\u{XXXX}` 转义**而非乱码**并在页首插入降级说明；原始中文标题以 UTF-16BE 写入 `/Info /Title` 精确往返；`createResponsePackageExport` 返回 `warnings` 把"PDF 不支持 CJK，请用 Markdown/DOCX"暴露给调用方。外部验证：pypdf 读出 6 页、末页含 `Section 59`、标题 `中文标题 Café — test` 完整往返，`qpdf --check` 无语法错误。
- **`vitest.config.ts` 不排除 `.next`** — 加 `exclude`。此前先 build 再 test 会多跑 16 个副本文件。
- **CI 修红** — `scripts/seed-db.ts` 新增 `seedStateCoverageBids()`，对没有 active state bid 的州各补一条完整记录（用各州真实 canonical 门户 URL，非占位符），幂等；`.github/workflows/ci.yml:63-90` 把 `risk:check` 的 `&&` 串联**拆成三个独立步骤**（Risk checklist / Secret scan / Dependency audit）并加 `if: ${{ !cancelled() }}`，一个失败不再遮蔽其余。选"补种子"而非"把门禁挪到发布阶段"，是因为 50 州覆盖是产品核心承诺，挪走等于让 PR 再也拦不住掉州的回归。
- **worker 无法优雅退出** — 新建 `scripts/worker-shutdown.ts`（`AbortSignal` 驱动的可中断 sleep + 信号控制器），三个 worker 的裸 `setTimeout` 全部替换。实测：`kill -TERM` 后 **10ms 退出**（此前要等满 15 分钟被 SIGKILL）。

### 跨线集成

- **爬虫审批开关接线（阻塞项）** — `configured-runner.ts:24/60` 新增 `loadApprovedCrawlerSourceIds`，按 `is_enabled = 1 AND approved_for_ingestion = 1` 从 `data_sources` 取（SQLite/MySQL 双路径）；`:118` **在调度层就过滤**未批准的 source（不取锁、不起子进程，但产出 `status: "blocked"` 保留可观测性），同时把允许列表传给子进程作为第二道防线。两个 admin 手动运行路由一并补齐。**没有这一步，升级后 worker 会拒绝抓取一切。**
- **存量 MySQL 列型阻塞迁移** — `db/mysql.ts:444-512` 在迁移循环**之前**加 `widenProviderEventIdColumn`（`SHOW COLUMNS` 判型后 `MODIFY` 成 `VARCHAR(191)`，幂等）与 `removeDuplicateProviderEventIds`（保留最新一条）。否则 A 线新加的唯一索引会在存量库上报 `ER_BLOB_KEY_WITHOUT_LENGTH`，而 C 线刚收紧的错误集合会让它**中断整个迁移**。
- **测试文件进生产镜像** — `next.config.ts:99` 加 `outputFileTracingExcludes`。实测 standalone 里的测试文件 15 → **0**。
- **`isProductionLikeRuntime` 三份副本** — 收敛到 `security/runtime-env.ts`，并区分出两个语义：`isProductionLikeRuntime`（不含 staging，用于鉴权旁路）与 `isProductionLikeDeployment`（含 staging，用于基础设施姿态）。`storage/object-storage.ts:129` 那份按设计保持独立并加注释。
- **环境变量文档** — `docs/transferability/environment-variables.md` 补入 23 个新变量（逐个到代码里核对默认值），新增 "Crawler subsystem (Python)" 小节；`docs/operations/notification-delivery-runbook.md` 改写为与代码一致。

### 依赖 CVE

- `next` / `@next/env` `16.2.6` → **`16.2.12`**（修 App Router 中间件/代理绕过）。
- 新增 `overrides`：`postcss ^8.5.23`（任意文件读取）、`sharp ^0.35.3`（libvips 四个 CVE）、`fast-uri ^4.1.1`（主机混淆）。
- **`shadcn` 从 `dependencies` 移到 `devDependencies`** —— 它是脚手架 CLI，不是运行时依赖，放在 dependencies 会把 `@hono/node-server` 与 `@modelcontextprotocol/sdk` 两个 moderate CVE 带进生产依赖树。
- 结果：**生产依赖 0 漏洞**（`npm audit --omit=dev`）。开发依赖仍有 8 个（1 low / 7 moderate，全在 shadcn CLI 链上），不影响运行时，`risk:check` 用 `--omit=dev` 故通过。
- ⚠️ 试过 `brace-expansion ^5.0.8` 的 override 但**回退了**——v5 改了导出形态，老版 `minimatch` 依赖 v1/v2 的 `expand` 默认导出，会让 ESLint 直接崩。移到 devDependencies 后它已不在生产依赖树里。

---

## 三、本轮**没有**修的（需要人或基础设施）

这些不是代码能解决的，仍是上线阻塞：

1. **worker 镜像不存在** —— `Dockerfile` 只打包 web 进程，三个 worker 与 `scripts/` 不在任何镜像里。需要新建 worker 镜像或把 worker 编译进 standalone。
2. **零 IaC** —— 无 Terraform/CDK/CloudFormation，部署仍是手工点控制台。
3. **MySQL 迁移仍不在部署产物里** —— 入口 `scripts/migrate-mysql.ts` 未打包、`tsx` 是 devDependency。需要把 DDL 抽成 `.sql` 资产 + 独立 one-off job，并加 `GET_LOCK` 互斥（多 task 同时启动仍会 TOCTOU）。本轮只修了迁移**内容**的正确性，没修**投递方式**。
4. **102 个外键在 MySQL 侧仍被正则剥除** —— 改动面大且会影响现有数据，需要单独规划。
5. **备份无调度、无 RPO/RTO、无还原演练证据** —— `backup-drill.ts` 仍是 `local-sqlite-only`。
6. **零指标、零告警定义、零 request id** —— 本轮只修了"Sentry 收得到 worker 崩溃"，CloudWatch 指标/告警/`middleware.ts` 的 correlation id 都还没有。
7. **限流器仍是进程内内存** —— B 线修了 IP 取值正确性，但多实例下仍是 N 倍配额。需要 Redis/ElastiCache。
8. **Stripe live checklist 38 项仍是 0 项完成**；无对账 job、无 `charge.refunded`/dispute 处理、无 Stripe Tax。
9. **法务侧的人的工作** —— 对剩余 31 个源逐个做 ToS 审查、隐私政策/ToS/cookie 同意页、DSAR 路径、账号删除把邮箱写回审计日志的问题。
10. **前端无翻页控件** —— `/api/bids` 现在默认返回第 1 页 100 条（`total` 仍为全量），`src/app/search/page.tsx` 需要加"加载更多"。
11. **CSP 仍带 `'unsafe-inline'`** —— Next 16 的 hydration 内联 script 需要它，去掉要先引入 middleware 做 nonce。
12. **全部 16 个页面仍是 `"use client"`，零 SSR** —— 首屏瀑布未改善。

---

## 四、部署前必须做的三件事

按顺序，漏掉任何一件都会出问题：

1. **`npm install`** —— `package.json` 有版本变更与新增 `overrides`。
2. **`npm run db:migrate`（SQLite）/ `npm run db:mysql:migrate`（MySQL）** —— 本轮新增了索引、两张抑制表、outbox 的 claim 列，并新增了存量 `provider_event_id` 的列型迁移与去重。**MySQL 迁移会先删除 `subscription_events` 里重复的 `provider_event_id` 行（保留最新一条）**，建议先备份。
3. **把生产库里该批准的数据源置为已批准** —— 爬虫现在是 default-deny：`data_sources.approved_for_ingestion` 为 NULL 或 0 的源**不会被调度**。种子库不写这一列，所以不做这一步爬虫会一个源都不抓。这是设计如此，但需要有人显式做决定——而这个决定应该发生在 ToS 审查之后。

---

## 五、已知的行为变更（可能影响现有使用方）

| 变更 | 影响 |
|---|---|
| 附件下载需要登录 | 匿名点击附件会拿到 401 JSON，前端 bid 详情页可能需要加提示 |
| `/api/bids` 默认只返回第 1 页 100 条 | `total` 仍是匹配总数；前端需要加翻页，否则用户看不到第 100 条之后的标 |
| 爬虫 default-deny | 见上节第 3 点 |
| BidNet 19 个源默认关闭 | 51 个源中 32 个默认可用（31 州 + SAM.gov）；叠加移除规避逻辑后的失败风险，乐观 31 州、悲观 25 州 |
| 移除伪造请求头后可能抓不到的州 | DE、GA、MS、IA 直接命中，UT、VA 同型——共 6 个州有失败风险。**这是正确结果**：失败会以清晰错误落进 `crawler_logs`，说明对方本就不欢迎自动访问，应走公开 API 或访问协议 |
| 生产必须显式设 `APP_ORIGIN` | 否则 CSRF 校验不再回退信任 `Host` 头 |
| 生产必须显式设 `BILLING_PROVIDER=stripe` | 否则 checkout/portal/cancel fail-fast |
| 生产必须设 `CRAWLER_RUN_TOKEN` | 否则 crawler run 路由一律 401 |
