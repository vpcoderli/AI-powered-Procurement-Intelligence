# AWS 生产上线就绪审计报告（2026-07-27）

审计对象：`main` @ `56569b9`（2026-07-02，工作区干净）
上线目标：**AWS 生产环境**，面向公网的付费 SaaS（App Runner/ECS + RDS MySQL + S3 + Secrets Manager）
审计方式：源码拉入 Linux x86_64 容器（Node 22.22.2 / Python 3.11.15），`npm ci` 后**实跑**全部门禁 + 多路并行深度代码审计 + 对高危结论逐条回代码复核

---

## 一、硬判定

**不能上生产。**

代码质量本身不差——1,569 个前端用例、209 个爬虫用例全绿，生产源码零类型错误，SQL 注入面干净，会话机制健全，`intents` 全部 20 条路由无跨租户越权。问题不在"代码写得糙",而在三个结构性缺口：

1. **生产环境跑不起来**——三个 worker 不在任何镜像里，MySQL 迁移脚本不在部署产物里。爬虫、事件出站、邮件投递在生产全部为零。
2. **收入是错的**——任何一次续费 webhook 都会让用户**永久无法过期、无法降级、取消无效**。
3. **法务面敞口**——19 个州（占州源 38%）在抓取一个付费聚合站，项目自己的证据文件把它判为 `login_required`；爬虫零 robots.txt、零限速，并主动伪造 Referer/Origin 规避 bot 检测。

第 3 条是最尖锐的：它不是技术债，是可能收到 cease-and-desist 并被迫下线近四成数据源的商业风险。

另有一条需要立刻知道的事实：**CI 现在是红的。**

---

## 二、实测门禁结果

以下每一项都是本次在干净容器里真实执行的结果，不是引用文档。

| 门禁 | 结果 | 说明 |
|---|---|---|
| `npm ci` | ✅ 868 包 / 33s | Linux 原生模块正常编译 |
| `npm run lint` | ✅ exit 0 | 零错误零警告 |
| `npx tsc --noEmit` | ⚠️ **315 错误** | **全部 100% 在 `*.test.ts(x)`,生产源码 0 错误** |
| `npm run build` | ✅ **exit 0 / 30.0s** | **7-02 报告中唯一从未被任何环境验证过的门禁,本次首次跑通** |
| `npm test` | ✅ **281 文件 / 1,569 用例全通过 / 170.85s** | 与 7-02 报告数字完全一致 |
| `crawler pytest` | ✅ **209 通过 / 1.31s** | 与报告一致。**1.31 秒跑完 209 个爬虫用例 = 零网络覆盖** |
| `npm run db:migrate` + `db:seed` | ✅ | seed 后库中仅 **6 条 bid** |
| **`npm run risk:check`** | ❌ **exit 1** | **CI 合并门禁失败,详见下节** |
| `npm run secrets:scan` | ✅ 904 文件 / 0 findings | 单独执行（被 `&&` 短路） |
| `npm audit --omit=dev` | ❌ **9 个漏洞（5 high / 3 moderate / 1 low）** | 7-02 报告称"0 漏洞",已漂移 |
| `npm run i18n:check` | ⚠️ exit 0,98 处发现 | **不在 CI、不在 risk:check**,不阻断 |
| `npm run workers:check` | ✅ 0 warnings | 但它只是 env 变量 linter,不连 DB、不探进程 |

### 2.1 CI 现在是红的（BLOCKER-0）

`.github/workflows/ci.yml` 的执行序列是 `npm ci` → lint → test → build → **`npm run db:seed`** → **`npm run risk:check`**。我完整复现了这个序列：

```
Risk checklist FAIL at 2026-07-27T10:19:23Z
FAIL state-coverage: 5/50 required states have at least one active bid
FAIL state-data-quality-gate: 50 state quality rows checked for P0 blocker reason codes
  - missing state AK / AL / AR / AZ / CO / CT / DE / GA / HI / IA ...（共 45 州）
```

根因：`db:seed` 只造 6 条 bid、覆盖 5 个州，而 `risk-check.ts` 要求 50 州各有 active bid。README 与状态文档里所有"50/50 州、1,146 条 active bids、216 条安全附件路由"的证据，**只存在于开发机上那个被 `.gitignore` 排除的 `frontend/data/apsi.sqlite`**（`.gitignore:19: /data/*.sqlite`）。干净检出下不可复现。

连带后果：`risk:check` 是 `tsx risk-check.ts && npm run secrets:scan && npm audit` 的 `&&` 串联，第一环失败 → **后两环从 2026-07-02 起就从未在 CI 里真正执行过**。这解释了为什么 9 个新 CVE 无人发现。

这条要么改 seed 让它造满 50 州，要么把 state-coverage 从 PR 门禁挪到发布门禁——但不能维持"文档宣称它是合并门禁、实际它一直红着"的现状。

### 2.2 供应链漂移

生产依赖 9 个漏洞，其中 5 个 high：

| 包 | 级别 | 摘要 |
|---|---|---|
| `next` | **high** | App Router 中间件/代理绕过（Turbopack + 单 locale） |
| `postcss` | **high** | 通过 CSS 注释里的 `sourceMappingURL` 任意文件读取 |
| `sharp` | **high** | libvips 继承漏洞 CVE-2026-33327/33328/35590/35591 |
| `brace-expansion` | high | 指数级展开 DoS |
| `fast-uri` | high | 反斜杠 authority 分隔符导致主机混淆 |
| `@hono/node-server` / `@modelcontextprotocol/sdk` / `shadcn` | moderate | serve-static 路径穿越（经 shadcn 传递） |
| `body-parser` | low | 非法 limit 值静默关闭体积限制 |

另有 23 个包过期，含 `@next/env 16.2.6 → 16.2.12`（与 `next` 主包版本已脱节）。

---

## 三、上线阻塞项（BLOCKER）

以下每条都给了 `文件:行`，并已回代码复核。

### 3.1 部署形态：生产跑不起来

| # | 问题 | 证据 |
|---|---|---|
| B1 | **三个 worker 不在任何镜像里**。`Dockerfile:66` 只 COPY `.next/standalone`,而 `scripts/` 不在 standalone 中（已实测确认）；`tsx` 是 devDependency,standalone 的 traced `node_modules` 里也没有。爬虫/事件/通知在生产**无可执行方式**。runbook 的 EventBridge 调度表是在调度一个不存在的产物。 | `Dockerfile:66-77`；实测 `.next/standalone/scripts` 不存在 |
| B2 | **MySQL 迁移在生产镜像里跑不了**。`db:mysql:migrate` = `tsx scripts/migrate-mysql.ts`,而 `scripts/` 未打包、`tsx` 未包含。（注：`migrate.ts` 本身**确实**被 Next 的 file tracing 带进了 standalone,所以 `mysql.ts:62` 的 `readFileSync` 路径没问题——真正的阻塞是入口脚本和运行时缺失。） | `mysql.ts:62`、`package.json` scripts |
| B3 | **零 IaC**。全库无 `*.tf` / `cdk.json` / CloudFormation。部署=手工点控制台,不可复现、不可审计、不可回滚到已知状态。 | 全库检索 |

### 3.2 数据库

| # | 问题 | 证据 |
|---|---|---|
| B4 | **MySQL 连接无 TLS**。池配置只有 `uri/connectionLimit/multipleStatements/namedPlaceholders`,**无 `ssl`、无 RDS CA bundle**。凭据与全部业务数据明文过网；若 RDS 参数组开 `require_secure_transport` 则直接连不上。 | `src/server/db/mysql.ts:33-40` |
| B5 | **102 个外键在 MySQL 侧被正则剥除**（含 88 个 `ON DELETE CASCADE`）,而 dev SQLite 是 `foreign_keys = ON`。生产删用户 → 88 类孤儿行,GDPR 删除路径静默泄漏。 | `mysql.ts:75-77`、`db/client.ts:26` |
| B6 | **迁移无并发锁**。全库 0 处 `GET_LOCK`,而 `event-worker.ts:161`、`notification-worker.ts:189` 在**启动时自动跑迁移**。两个 ECS task 同时启动 → `SHOW COLUMNS` 后 `ALTER` 的 TOCTOU → `ER_DUP_FIELDNAME`（不在吞错集合内）→ worker 崩溃。 | `mysql.ts`、两个 worker |
| B7 | **`ER_DUP_ENTRY` 被当成"已跳过"吞掉**。建唯一索引时若表内已有重复值,索引静默不创建、迁移报 exit 0,去重能力降级为普通 INSERT。版本表 `mysql_migrations` 只写一行硬编码哨兵且**从不读取**,等同于没有。无任何 down/rollback。 | `mysql.ts:10, 342-347` |

### 3.3 安全

| # | 问题 | 证据 |
|---|---|---|
| B8 | **限流可被 `X-Forwarded-For` 完全绕过**。取 XFF 的**第一个**条目作为客户端 IP,而 ALB/App Runner 是在**末尾**追加真实 IP → 首位永远是攻击者自填值。每次换一个伪造 IP 即得全新限流桶。叠加限流状态是**进程内内存**,多实例 = N 倍尝试次数。撞库无有效防护。 | `src/server/security/request-ip.ts:10-15`（已精读确认） |
| B9 | **制品上传在任何限制之前把整个请求体读入内存**。POST 路径 `formData()` 在 `:92`,`requireFeature` 在 `:100`,25MB 校验在 service `:346`。（`:76` 那个 `requireFeature` 属于 GET 分支,已逐行确认。）Next App Router 无内置体积上限,`next.config.ts` 未配 `bodySizeLimit`,无 middleware 可拦。**任意已登录用户——包括无上传权限的 Free 用户**——单个大 POST 即可打爆实例内存。 | `intents/[id]/artifacts/route.ts:76/92/100`、`artifacts/service.ts:346` |
| B10 | **附件下载路由完全无鉴权,且全量读进内存**。该文件 import 里没有任何 auth helper,全库也**无 `middleware.ts`**（实测 0 个）。`readFile()` 整文件入内存后 `new Response(content)`。政府标书 PDF 常 50–200MB,爬虫侧亦无大小上限 → 10 个匿名并发即 2GB RSS。**全站最廉价的 DoS,且任何人可下载全部标书附件**。 | `api/bids/[id]/attachments/[attachmentId]/route.ts:1-4, 107` |
| B11 | **五项安全控制共用 `NODE_ENV` 单一开关**：admin 免认证绕过、密码重置 token 明文回包（一步账号接管）、billing webhook 免签名（任意账号升 business）、Cookie `Secure` 标志、SES SNS 签名跳过。`Dockerfile:54` 确实写死 `ENV NODE_ENV=production`,所以按文档部署时全部 inert——**判它 BLOCKER 的理由是单点失效代价过高**:代码库自己在 `billing/providers.ts:255-259` 写了更严谨的 `isProductionLikeRuntime`（同时看 `APP_ENV`/`DEPLOY_ENV`）,说明作者清楚 `NODE_ENV` 不够,而 ECS 任务定义极易只设 `APP_ENV=production`。 | `admin/auth.ts:44-46`、`password-reset/request/route.ts:45`、`billing/webhook/route.ts:46`、`auth/session.ts:19` |
| B12 | **`CRAWLER_RUN_TOKEN` 未设时 fail-open,且无 NODE_ENV 门**：`if (!requiredToken) return true`。公网任何人可 POST 触发 50 源抓取。 | `api/crawler/state/run/route.ts:52-55` |

### 3.4 性能

| # | 问题 | 证据 |
|---|---|---|
| B13 | **`/api/bids` 全表扫描 + 应用层过滤排序 + 无分页**。SQLite 与 MySQL 两条路径都是 `SELECT <27列> WHERE display_status <> 'suppressed' ORDER BY id ASC`——无 LIMIT、无 WHERE 下推。关键词/州/截止日过滤全在 JS 里 `String.includes`,响应也不分页。1,147 行 ≈ 4.5MB/次；十万行 ≈ **400MB 单次堆分配**,并发 2 个请求即 OOM。索引 `idx_bids_active_deadline` 完全用不上,因为 `is_active` 从不进 WHERE。 | `bids/repository.ts:291, 333`、`bids/service.ts:147-156`（已精读确认） |
| B14 | **`/api/dashboard/summary` 单请求触发 5 次全表扫描**（2 次直接 + `createRiskReport` 内部 2 次 + saved bids）,并发发出。十万行时约 2GB 瞬时堆,**首页最先炸**。 | `dashboard/summary.ts:233-250`、`risk/checklist.ts:492,494` |
| B15 | **两个 outbox 无 claim 机制,多副本必然重复投递**。全库 `FOR UPDATE｜SKIP LOCKED｜GET_LOCK` **零命中**。逻辑是 `SELECT pending ORDER BY created_at LIMIT 25` → 发送 → `UPDATE sent`。两个 ECS 副本拿到**完全相同**的 25 行,各发一次邮件。`dedupe_key` 唯一索引只保证**入队**幂等,不保证**投递**幂等。 | `notifications/outbox-repository.ts:407-425`、`events/event-log.ts:396-435` |
| B16 | **爬虫子进程 `execFile` 无 timeout、无 maxBuffer**。无 timeout → 一个卡死的州门户永久阻塞 worker（53 个源严格串行）。maxBuffer 默认 1MB → MySQL 模式下子进程把全部 bid 打到 stdout,超限即被 kill,**每次都失败**。 | `crawler/state-runner.ts:109`、`sam-gov-runner.ts:112` |

### 3.5 计费（单点最贵的 bug）

| # | 问题 | 证据 |
|---|---|---|
| B17 | **任何 `invoice.paid` / `invoice.payment_failed` 事件都会把 `current_period_end` 写成 NULL、`cancel_at_period_end` 清零**。事件映射分支根本不设这两个字段 → 落库时 `event.currentPeriodEnd ?? null`；而 `subscriptionIsExpired(null)` **直接 return false**。结果:**任何续费过的用户永远无法过期、无法降级、取消无效**;`invoice.payment_failed` 甚至同时把用户置为 past_due 又让他永久保留 Pro。MySQL 路径同病。 | `billing/providers.ts:202-230`、`subscriptions.ts:1140-1141, 470-473`、`mysql-subscriptions.ts:911-912`（三处均已精读确认） |
| B18 | **MySQL 生产没有 `provider_event_id` 唯一索引**——DDL 提取正则只截取第一个 `sqlite.exec` 块,而该索引在块外。webhook 幂等退化为 check-then-act,重投递可双授权;且该列被判为 `LONGTEXT`,手工补索引会报 `ER_BLOB_KEY_WITHOUT_LENGTH`。 | `mysql.ts:65-73`、`migrate.ts:1058` |
| B19 | **`BILLING_PROVIDER` 默认 `local`**。生产忘设 → 点"升级 Pro"返回 200,`checkoutUrl` 是自指的 `/settings?checkoutSession=...`,而 `settings/page.tsx` 没有任何 searchParams 消费逻辑 → **永不扣款、永不升级、无任何报错**。 | `subscriptions.ts:265, 963-976` |
| B20 | `stripe-live-launch-checklist.md`：**38 项 `- [ ]`,0 项完成**。无对账任务、无 `charge.refunded`/dispute 处理（退款后仍保留付费权限）、无 Stripe Tax。 | 同名文档 |

### 3.6 通知

| # | 问题 | 证据 |
|---|---|---|
| B21 | **文档与代码直接矛盾**。runbook 写 "Valid provider names are `file`, `console`, `http`, **`ses`, `sendgrid`**"；而 worker 硬编码 `SUPPORTED_NOTIFICATION_PROVIDERS = new Set(["file","console","http"])`,对 ses/sendgrid 直接抛错。SES/SendGrid 的 provider 代码**写得很完整**（含 SNS RSA / ECDSA 退信验签）,但**后台 worker 永远无法使用**。生产唯一能用的是 `http`——一个你必须自己另造的网关。 | `scripts/notification-worker.ts:5, 109-111` vs `docs/operations/notification-delivery-runbook.md:43`（两侧均已核对原文） |
| B22 | **无抑制名单**（全库 `suppress` 零命中）。硬退信只把该行标 `failed`,而投递逻辑会重新选中 `failed` 行 → **对刚退信的地址反复重发**。SES 账号会被封。无 `List-Unsubscribe`、无退订链接（CAN-SPAM 风险）、无发送限流、无死信队列。 | `notifications/delivery.ts:89-97` |

### 3.7 可观测性

| # | 问题 | 证据 |
|---|---|---|
| B23 | **三个 worker 的 Sentry 全部报废**。它们各自 `import { captureException }` 并在崩溃时调用,但 `initSentry` **只在 `instrumentation.ts` 里被调用**（Next 专用钩子）,worker 是独立 tsx 进程 → SDK 无 client → 事件被静默丢弃。**worker 崩溃永不告警**,而 `workers:check` 只是 env linter,不连 DB 不探进程,worker 死一周它仍 exit 0。 | `instrumentation.ts:21-28`、`crawler-worker.ts:6/290`、`event-worker.ts:15/203`、`notification-worker.ts:2/250`（已逐个确认） |
| B24 | **零 request/correlation id**（无 `middleware.ts`,UI 里的 `traceId` 永远为空）、**零指标**（无 CloudWatch/EMF/OTel）、**零告警定义**。runbook 反复承诺 CloudWatch alarms 但没有一个指标名或阈值。 | 全库检索 |
| B25 | `/api/health` **确实真探 DB**（降级返 503,这点是对的）,但 Dockerfile/compose/runbook **全无引用**,这个唯一能用的探针是孤儿；且未鉴权即回显原始 DB 错误 `error.message`,会泄漏 RDS 主机名、VPC IP、DB 用户名。 | `api/health/route.ts:53, 100` |

### 3.8 备份

| # | 问题 | 证据 |
|---|---|---|
| B26 | 备份/还原脚本**确实**分支到 MySQL（`mysqldump --single-transaction`,密码走 `MYSQL_PWD` 不进 argv）——文档说"只支持 SQLite"是低估。但：`backup-drill.ts:49` 硬编码 `drillType: "local-sqlite-only"`、`:158` 自写 `productionDrillRequired: "UNRESOLVED"`；MySQL 演练辅助函数 `countMysqlRows` **零调用者**；**零调度**（无 cron/EventBridge）；**RPO/RTO 全库未定义**；`ops-evidence/` 只有 5 个 source-health 文件,无任何还原演练证据,所有 migrate 记录都指向 `127.0.0.1:3306`。 | `backup-drill.ts:49,158`、`mysql-restore.ts:151` |

### 3.9 合规与法务（最尖锐）

| # | 问题 | 证据 |
|---|---|---|
| B27 | **19 个州（38% 州源）在抓 BidNet,文档只说 3 个**。`state_bidnet.py` 的 `BIDNET_STATE_URLS` 有 **17 个州**（AL/AK/AZ/ID/KY/LA/MD/MI/MN/NC/ND/NE/NH/OH/SC/VT/WI）,加 `co_bidnet.py`、`wv_bidnet.py` = **19**。文档把这批拆散在三处披露,**没有一处给出总数**。 | `crawler/apsi_crawler/spiders/state_bidnet.py:4-22` 及另两个文件（已逐行数过） |
| B28 | **BidNet 是付费聚合站,而项目自己的证据文件把它判为 `login_required`** —— `ops-evidence/source-health/source-health-access-review.json` 里 CO/OH 条目 `"classification": "login_required", "reviewMode": "vendor_account"`。然后照爬不误,数据作为"50 州覆盖"卖给付费用户。项目自己的政策 `known-limitations.md:14` 写着"login-required、付费、受限的源必须保持 blocked"——BidNet 全中,19 个源全部在线。 | 上述证据文件 + `known-limitations.md:14` |
| B29 | **爬虫从不读 robots.txt**（`crawler/` 全库 0 命中,实测确认）、**零速率限制**（`sleep`/`DOWNLOAD_DELAY`/backoff/并发上限全库 0 命中,实测确认）。worker 每 15 分钟一轮、轮内 50 源背靠背 → 对 bidnetdirect.com 单一主机约 **1,824 次/天,零延迟**。 | 实测 `grep -rn 'robots'` = 0、`grep -rnE '\bsleep\(|DOWNLOAD_DELAY|rate_limit'` = 0 |
| B30 | **主动伪装浏览器规避 bot 检测**。多个 spider 先 GET 人类页面暖 cookie,再带伪造 `Referer`/`Origin`/`X-Requested-With` POST 内部 JSON 接口；UA 是完整 Chrome 串,**全库无任何联系方式**。团队自己把"官方站 403/Cloudflare 挡了所以绕到 BidNet"写进了 README 和状态文档——**"绕过技术访问限制"这一事实被写进了发行文档**。 | `de_bids.py:64-65`、`ga_procurement_registry.py:108,116-122`、`ms_contract_bid_search.py:135-136`、`ia_bid_opportunities.py:102-103`（实测确认） |
| B31 | **没有 kill switch**。Python 爬虫**完全不读** `approved_for_ingestion` / `is_enabled`；45/50 源 `approvedForIngestion: false` 但 runner 不做任何审批过滤,照跑不误。收到律师函只能重新部署。合规台账里**完全没有 BidNet**,台账自认 **0/50 源做过 ToS 审查**。 | `crawler/configured-runner.ts:60-86`、`data-source-compliance-ledger.md:105` |
| B32 | **无隐私政策页、无 ToS 页、无 cookie 同意**（却在设匿名追踪 cookie）；账号删除是软删除,且删除流程把**原始邮箱明文写进永久审计日志**,当场撤销自己的匿名化（GDPR Art.17 失败）；爬虫还把州政府采购官邮箱入库。 | `account/lifecycle.ts:376-386`、`de_bids.py:47` |

---

## 四、HIGH（上线后 30 天内必须补）

- **CSRF 覆盖不一致**：47 个含写方法的 route 中,**30 个没有任何 CSRF 校验**（实测统计）。`verifyCsrfSafe` 只覆盖 `/api/account/**` 与 `/api/admin/**`。全部 `/api/intents/**`、`/api/saved-bids/**`、`/api/search-alerts/**`、`/api/company/profile` 均无。唯一防线是 `SameSite=Lax`——它确实拦得住跨站 POST,所以**不是当前可直接利用的漏洞**;但 `csrf.ts:8-14` 的模块注释自己论证了 Lax 单独不足,任何一次 cookie 属性调整或子域接管即全面失守。
- **全站零安全响应头**：`X-Content-Type-Options`、CSP 全库 0 命中,`next.config.ts` 无 `headers()`（实测确认）。叠加下一条更危险。
- **生产默认的病毒扫描是空实现**：`OBJECT_STORAGE_MALWARE_SCANNER` 未设时返回 noop 扫描器（只做两次 EICAR 子串比对）,`clamav`/`aws-macie` 被**静默降级**。类型白名单默认不生效,且校验的是**攻击者自填的 multipart `contentType`**,无 magic byte 嗅探,黑名单缺 `.html/.svg/.hta`。而下载响应的 Content-Type 直接用这个被污染的库存值。目前所有下载都带 `Content-Disposition: attachment`（已逐条核对 5 处）,故未构成已确认的存储型 XSS。
- **`securityScanStatus` 硬编码 `"clean"`**：`artifacts/service.ts:247` 的 hydration mapper 无条件返回 `"clean"` 而不读行数据（同文件 `:186` 那个 mapper 是对的）→ pending/blocked 的扫描在列表里显示为已通过。
- **修改密码不失效其他会话**：`auth/service.ts:301-309` 只更新 hash 不删 sessions（对比：密码重置路径 `:204` 正确删了）。用户察觉被盗改密码后,攻击者会话仍有效最长 30 天。
- **未认证接口回显原始 `error.message`**：`api/bids`、`api/bids/[id]`、`api/health`、`api/health/scrapers` 四处,Drizzle/MySQL 驱动错误常含 SQL 片段与连接元数据。
- **连接池配置不足**：只设 `connectionLimit: 10`,无 `connectTimeout`/`idleTimeout`/`enableKeepAlive`/`queueLimit`。`queueLimit` 默认 0 = 无限排队无超时；无 keepAlive → AWS NLB 350s 空闲断连导致间歇 `ECONNRESET`。而 B14 每请求占 7 连接 → **2 个并发用户打满池**。
- **`crawler_locks` 的 CAS 本身是正确的**（单语句原子、基于时间而非存在性,worker 猝死后自愈,这块写得很好）——但 runbook 建议把 owner 设成共享常量 `CRAWLER_OWNER=prod-crawler-worker`,而释放语句是 `DELETE WHERE source=? AND owner=?` → **所有权保护失效,副本 B 会删掉副本 A 正在持有的锁**。叠加 TTL 10 分钟硬编码、无心跳续租,而开启附件归档的全量爬取可达数小时。
- **worker 无法优雅退出**：`sleep()` 是裸 `setTimeout`,SIGTERM 只翻 boolean 不中断休眠。默认间隔 15 分钟,ECS StopTimeout 30s → 每次部署都被 SIGKILL,`finally` 里的连接池关闭从不执行。
- **催缴窗口会被老账单占满**：`billing/dunning.ts:161-167` 的 `SELECT ... ORDER BY updated_at ASC LIMIT 100` **无 `WHERE status='payment_failed'`**,状态在 JS 里过滤。invoice 表超 100 行后,**新失败的账单永远进不了催缴**,且无报错。
- **全部 16 个页面都是 `"use client"`,零 SSR 数据**。`export const dynamic`/`revalidate`/`unstable_cache` 全库 0 命中。首屏 = 空壳 HTML → 下载 bundle → 客户端 fetch → 再渲染。`admin/page.tsx` 4,327 行、`intents/[id]/page.tsx` 3,615 行全量进浏览器。实测最大 chunk 222KB,静态 chunks 合计 1.9MB。
- **CI 无部署流水线**：无 staging、无镜像构建、无镜像扫描（Trivy/ECR）、无 SBOM、无 tsc 类型检查。
- **事故响应有流程无能力**：无 on-call、无 SEV 分级、无升级路径、无 paging（alert 自认 "log-only"）、无 postmortem 模板、无 status page、无 feature flag、无 WAF/Shield/CAPTCHA。检测 100% 靠人工。回滚步骤写了 8 步但迁移前向单向（0 个 down 文件）。

---

## 五、功能完整性对账：文档 vs 代码

结论：**不是造假型虚高。** 状态文档大量使用 "Lite / deterministic / Done **locally**" 限定词,多数 Lite 声明属实。虚高集中在三处——爬虫口径、"seam 存在但不通电"、以及 **README 剥离了限定词**（把状态文档的 "Lite/deterministic" 改写为"支持…已完成"）。

### 三类系统性手法

1. **建表 + 建表测试 = 声称能力**。`credit_balances` 有 schema、有 migration、`schema.test.ts:405` 有断言"表存在"——但全仓零读零写,`credit-ledger.ts:149/153/157` 三个函数**无条件 throw**（实测确认）。
2. **写了 seam 就计入完成度**。AI provider registry、S3 provider、SES/SendGrid provider、quote parser——代码质量都不差,但**没有一条接在默认运行路径上**,却全部计入了 60%/73%/93% 的分子。`parseQuoteUploadText` 全仓非测试引用**只有它自己的定义和一处死 re-export**（实测确认）,路由不 import 它、不调 `formData()`,UI 无 file input。
3. **证据不可复现**。见 §2.1。

### 具体缺陷（可立即修）

| 能力 | 判定 | 问题 |
|---|---|---|
| Response Workspace PDF 导出 | ⚠️ 有硬伤 | `service.ts:1051` **静默截断到 44 行**;`:1064/1088` 用 `latin1` 编码 → **中文标题必然乱码**（而这是中英双语产品）。测试只断言 `%PDF-` 魔数,不覆盖截断和非 ASCII。 |
| DOCX 导出 | ⚠️ | 结构合法但只有纯文本段落,无样式无表格。依赖里无 `pdfkit`/`docx`/`jszip`——全是手搓字节。 |
| 导出审批 | ⚠️ | `service.ts:1867` **创建导出的人可以自己批准**,无职责分离;`:692` 审批阈值硬编码为 1。 |
| Award "learning summary" | ⚠️ | 单 intent 模板字符串,把枚举码原样插进用户可见文案（输出 `price_uncompetitive`）,且**英文硬编码在 server 层**绕过 i18n。无跨标胜率/趋势。 |
| Intent 决策引擎 | ⚠️ | 逻辑真实但全是硬编码阈值（`score>=70 && risk<=1 → pursue`）。**`pursuit/generator.ts`（252 行,真正的决策逻辑）和 `compliance/generator.ts` 无测试文件**。保存人工决策时不记录当时推荐值 → 无 override 审计轨迹。 |
| 50 州爬虫 "verified" | ❌ | CA/TX/NY 三个把 `response.json()` 指向 HTML 页面 → **对真站必抛 "not valid JSON"**。它们只被注入的 fake dict 喂过。5 个"verified"中只有 IL 是真的。 |
| "live validation confirms non-empty results" | ❌ | 测试把 fetcher 整个替换成返回固定 bid,**零网络覆盖**（209 个爬虫用例 1.31 秒跑完,已实测佐证）。状态文档自己在别处记录该次全量运行 exit 非零。 |
| Product 6 Intelligence Lite | ✅ | 指标确实从真实 DB 行派生,`llm: "not_used"` 在代码和 UI 都如实回显。**文档自述准确。** |
| i18n | ✅ | en/zh **各 1,362 个叶子键、0 缺失**,TS 类型强制。覆盖率报告本身是诚实的。但扫描器**只扫 `src/app` 从不扫 `src/components`**（漏 14 处硬编码英文）,且 `i18n:check` 不在 CI。 |
| 营销漏斗 | ✅ 有口径缺陷 | 6 个事件全部从生产路由发出。但 `complete_signup` **仅在 `marketingIntent === "demo"` 时发** → 自然注册对漏斗不可见;"first matched bid" 幂等键是 `userId:bidId` → 一个用户看 40 个标发 40 条,与 UI 标签语义不符。 |
| Stripe 集成 | ✅ 大体属实 | checkout/portal/cancel 均调真 SDK,webhook 用官方 `constructEvent` 真验签,生产强制 `sk_live_`。但真 SDK 调用**零测试**（775 行测试全走注入 fake）。 |

### 完成度对比

| 维度 | README 声称 | 独立评估 | 主要扣分 |
|---|---:|---:|---|
| 本地可用 MVP | 98% | **80–84%** | quote parser 未接线、PDF 截断+中文乱码、local checkout 空转、数据证据不可复现 |
| 生产发布准备 | 73% | **48–55%** | worker 拒绝 ses/sendgrid 与 runbook 冲突、S3 无 env 接线、无退信抑制 |
| 商业化闭环 | 73% | **62–66%** | Stripe 真实（加分）,但 B17 续费 bug + 真 SDK 零测试 |
| 营销漏斗 | 94% | **80%** | 条件发射 + 语义错 + 1000 条聚合上限 |
| 采购工作流深度 | 93% | **70–74%** | parser 死代码、PDF/DOCX 是玩具、审批无职责分离、生成器无测试 |
| AI / Enterprise 深度 | 60% | **25–32%** | provider seam 是死代码、credit 三函数 throw、成本恒为 0 |
| 完整 PRD | 76% | **55–60%** | 上述加权 |
| **50 州数据**（README 未单列） | 隐含 ~95% | **40–50%** | 3/5 "verified" adapter 对真站必失败;19 州靠聚合器;live validation 全 mock |

---

## 六、已验证是对的（同样重要）

审计不只找问题。以下是逐条核对后确认扎实的部分，改动时不要破坏：

- **SQL 注入面干净**。所有 MySQL 调用走 `?` 占位符；所有 `${}` 插值的片段插入的都是代码内字面量或白名单枚举；标识符插值均经 `assertMysqlIdentifier`/`quoteMysqlIdentifier`；**全库 ORDER BY 无一处插值**；连接池 `multipleStatements: false`。
- **`/api/intents/**` 20 条路由无跨租户越权**，已逐条核对 WHERE 子句。信任根是 `findIntentByUsersAndId`（`and(inArray(userId, scopeUserIds), eq(id, intentId))`），所有嵌套资源都重新收敛到父 intent，GET 与写方法校验一致。**21 条 admin 路由全部经 `requireAdmin`/`requireAdminAccess`**，含角色分级。
- **路径穿越两侧均安全**。写：`sanitizeFileName` + `assertSafeSegment` 双层。读：`resolveAllowedLocalPath` 对根与候选**双向 realpath**，收敛判断用 `path.relative` 而非 `startsWith`，兄弟目录绕过与符号链接均被拦截。
- **会话机制健全**：256 位 `randomBytes(32)` token、库中仅存 SHA-256、登录时新签发（无会话固定）、`HttpOnly`+`SameSite=Lax`+30 天上限、登出真正删除服务端行、重置 token 单次使用 1 小时过期且成功后清空该用户全部会话。
- **Stripe webhook 签名校验正确**：取原始 text 未重序列化，官方 `constructEvent`（HMAC-SHA256 + 常量时间比较 + 300s 重放窗口），生产 fail-closed。**无 Stripe Elements、无卡号触碰，SAQ-A 姿态干净。**
- **`crawler_locks` 的 CAS 是真正原子的**：SQLite 用 `ON CONFLICT DO UPDATE ... WHERE expires_at <= excluded.acquired_at RETURNING`，MySQL 用 `ON DUPLICATE KEY UPDATE ... IF(...)`，单语句无读改写竞态，基于时间而非存在性的守卫。
- **重试实现质量高**：指数退避 + AWS full jitter，分类器正确排除 4xx 和 `locked/disabled/blocked`。
- **Python 侧 21 处 HTTP 调用全部显式 `timeout=30`，零遗漏**（实测 144 处 `timeout=` 命中）——爬虫最常见的坑反而没踩。
- **`MysqlRuntimeDatabaseGuard` Proxy** 在 MySQL 模式下让任何误用 SQLite 的代码路径立即抛错，配合 `mysql-route-coverage.test.ts`，是很扎实的双路径防护。
- **无硬编码生产凭据**，仓库无 `.env*`，secrets-scan 904 文件 0 findings。
- **生产环境校验 fail-closed**：拒绝 SQLite、拒绝 `file`/`console` 通知 provider。
- 备份/恢复正确使用流；marketing CSV 导出有 5,000 行硬上限；依赖树精简无重客户端库泄漏。

---

## 七、最小可上线清单

按依赖顺序。**第 0 阶段未完成前，任何生产流量都不应接入。**

### 第 0 阶段 — 法务闸门（先做，否则后面都是沉没成本）

1. **立即停用 19 个 BidNet 源**——从 `state_sources.py` 注册表移除，不要只改 DB 标志，爬虫不读它。
2. 删除 `de_bids.py` / `ga_procurement_registry.py` / `ms_contract_bid_search.py` / `ia_bid_opportunities.py` 的 cookie 暖场与伪造 Referer/Origin 逻辑。
3. 全部 spider 换统一 UA：`APSiBot/1.0 (+https://<domain>/bot; ops@<domain>)`。
4. 实现 robots.txt 拉取+缓存+遵守（含 Crawl-delay）、每域串行 + 最小 2–5s 延迟 + 429/Retry-After 退避 + 全局并发上限。
5. 对剩余 31 个源逐个做 ToS 审查并填台账；`RISK_CHECK_REQUIRE_SOURCE_APPROVAL=true` 设为 CI 必设。**上线源集合 = 审查通过的子集，哪怕只有 5 个州。**
6. 给爬虫加真正的 kill switch：Python 侧启动前查 `data_sources.is_enabled` / `approved_for_ingestion`。
7. 上线隐私政策 + ToS + cookie 同意 + DSAR 路径；修账号删除把邮箱写回审计日志的问题。

### 第 1 阶段 — 让生产跑得起来

8. 新建 worker 镜像（复用 deps/builder stage + 完整 node_modules + tsx），或把三个 worker 编译进 standalone。
9. 迁移改为不依赖 `scripts/` 的产物（DDL 抽成 `.sql` 资产打进镜像），加 `GET_LOCK` 互斥，加真实版本表，从 worker 启动路径移除自动迁移改为独立 one-off job。
10. 修 MySQL 生成器：保留外键、补齐正则漏掉的索引（`provider_event_id` 先 `MODIFY` 成 `VARCHAR(191)`）、全表加 `utf8mb4/utf8mb4_unicode_ci`、`ER_DUP_ENTRY` 移出吞错集合。
11. 池加 `ssl: { ca: rds-global-bundle }` + `connectTimeout` + `enableKeepAlive` + `queueLimit`；`connectionLimit` 按 (web task 数 + worker 数) × limit < RDS `max_connections` 定容。
12. 写 `assertProductionEnv()` 并在 `instrumentation.ts` 与三个 worker 里 fail-fast：`DATABASE_URL` 必须 mysql://、`BILLING_PROVIDER` 必须 stripe、`APP_ORIGIN`/`CRAWLER_RUN_TOKEN`/`SENTRY_DSN` 必须存在。`CRAWLER_RUN_TOKEN` 改为缺失即拒绝。
13. 五处 `NODE_ENV` 安全分支统一改走 `isProductionLikeRuntime`；`ADMIN_UI_LOCAL_BYPASS` 与 reset token 回显改为默认关闭需显式开启；删掉 `admin-reset.ts` 的硬编码口令与 secrets-scan 白名单。
14. **修复 CI**：改 seed 造满 50 州，或把 state-coverage 移出 PR 门禁——不能维持红着。修完后 `npm audit` 会立刻暴露那 9 个 CVE，一并处理（`next`、`postcss`、`sharp` 三个 high 优先）。

### 第 2 阶段 — 收入正确性与性能

15. **修 B17**（`invoice.*` 保留 `current_period_end` / `cancel_at_period_end`）——这是单点最贵的 bug。
16. 补 `charge.refunded`/dispute 处理；加 `event.created` 排序保护；上定时对账 job；跑完 live checklist 全部 38 项。要么实现额度计量，要么从定价页删掉额度承诺。
17. `/api/bids` 改 SQL 下推 + `LIMIT/OFFSET` 分页 + 关键词走全文索引；`getSavedBids` 改 `WHERE id IN (savedIds)`；dashboard 的 5 次全表合并为聚合 `COUNT(*)`。**一条解掉 B13/B14 和 saved-bids 全表。**
18. 附件路由加鉴权 + `createReadStream` + `Readable.toWeb()`，或改签名 URL 重定向让字节不过容器。
19. `execFile` 加 `timeout` + `maxBuffer`（两行，解掉 B16）。
20. outbox 加 `claimed_by`/`claimed_until` 条件 UPDATE 抢占，或改用 SQS。
21. artifact 上传把 `requireFeature` 提到 `formData()` 之前，并配 `bodySizeLimit`。

### 第 3 阶段 — 可运维

22. worker 入口调 `initSentry`；加 `instrumentation-client.ts` + `global-error.tsx` + `withSentryConfig`；87 个路由的错误响应换统一 handler（记日志、不回显 `error.message`）。
23. 加 `middleware.ts` 生成 request id 贯穿日志/Sentry/响应头；限流器换共享存储并**按可信代理跳数从右取 IP**；覆盖 register 与 AI 端点。
24. 通知：把 `ses`/`sendgrid` 加进 worker 白名单（代码已就绪），配 SES 域名验证/DKIM/SPF/DMARC，建抑制列表表并在发送前查询，加 `List-Unsubscribe`。
25. worker 心跳表 + CloudWatch 指标 + 告警（心跳过期、outbox 积压、5xx 率、webhook 失败率、退信率）接 PagerDuty/Slack；`/api/health` 加鉴权与错误脱敏并挂到 App Runner 健康检查。
26. 补 `X-Content-Type-Options` + CSP；统一 CSRF 覆盖到全部 30 个缺失路由；强制真实病毒扫描器 + magic-byte 校验。
27. IaC 化整个拓扑；CI 加 tsc（先修 315 个测试类型错）、镜像构建 + Trivy 扫描、staging 环境与自动部署。
28. RDS 自动备份 + PITR + 跨区快照；写 MySQL 版 `backup-drill`（`countMysqlRows` 已在，零调用）；定义 RPO/RTO 数值；**真跑一次还原演练并留证**。
29. 事故响应：定义 SEV0-3、on-call 轮值、升级路径、postmortem 模板；做一次回滚演练（迁移改 expand/contract 两阶段）。

### 工期估计

第 0 阶段 **2–4 周**（含外部法务意见）；第 1–3 阶段并行 **6–10 周**。

---

## 附录 A：本次审计的复现方法

```bash
# 在 Linux x86_64 / Node 20+ 环境
cd frontend
npm ci
npm run lint                 # → exit 0
npx tsc --noEmit             # → 315 errors, 全部在 *.test.ts
npm run build                # → exit 0, 30.0s
npm run db:migrate && npm run db:seed
npm test                     # → 281 files / 1569 tests passed
npm run risk:check           # → exit 1（复现 CI 红）
npm run secrets:scan         # → PASS, 904 files, 0 findings
npm audit --omit=dev         # → 9 vulns (5 high)
cd ../crawler && pip install -r requirements.txt && PYTHONPATH=. pytest   # → 209 passed
```

## 附录 B：本次审计顺带修掉的两处

1. `CLAUDE.md` / `README.md` 的 Next.js 15 vs 16.2.6 版本矛盾、Node 18+ vs CI/Dockerfile 的 Node 20、README 结构树漏掉 `src/server/`（34 个业务域 / 170 个模块）与 `app/api/`（87 条 route）。
2. 新增的 `start-mysql.sh` 里 `MYSQL_ROOT_PASSWORD=${DB_PASS}_root` 会被 `secrets-scan.ts` 判为硬编码高熵密钥并使 `risk:check` 失败，已改为变量间接赋值并实测 scan 恢复 PASS。

## 附录 C：两处工程卫生问题

1. **`vitest.config.ts` 不排除 `.next`**。若在 `npm test` 前跑过 `npm run build`，测试会把 `.next/standalone` 里的副本一起跑（本次实测：294 文件 / 1,677 用例，多出 13 个文件）。建议加 `exclude: ["**/node_modules/**", "**/.next/**"]`。
2. **Next standalone 产物里含 13 个 `.test.ts` 文件**，会被打进生产镜像。
