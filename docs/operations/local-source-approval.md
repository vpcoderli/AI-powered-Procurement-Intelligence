# 县/市级数据源的治理拦截、前置检查与批准

背景、实测数据与设计取舍见[县/市级数据源"治理拦截"的修复可行性](../superpowers/specs/2026-09-16-local-source-governance-recovery-design.md)；采集与详情补全的上游链路见[爬虫与 Scrapling 逻辑梳理](../architecture/crawler-enrichment-flow.md)；附件归档见[附件归档与修复](./attachment-repair.md)。本文只讲：治理拦截是什么规则、批准前怎么检查、批准表单每一栏代表谁的责任、批准之后那些"看起来像失败"的结果各自是什么意思，以及整批源怎么接入（平台审查、预检入队、带台账批量批准，第 8 节）。

一句话原则：**治理门禁是策略，不是 bug。** 本文里的任何工具都只是把人做判断需要的证据摆到面前，没有一处会替人放行。

## 1. 什么是"治理拦截"

管理端批量运行面板显示的"治理拦截"（`batchRunStatus_blocked`）来自 `frontend/src/server/crawler/orchestrator.ts` 的 `blockedReasonFor()`。它在**任何一次抓取开始前**检查 `data_sources` 的治理列，命中即返回 `status: "blocked"`，Python 进程根本不会启动：

| 触发条件 | 面板提示 | 含义 |
| --- | --- | --- |
| `jurisdiction_level ∉ {federal, state}` 且 `approval_status ≠ 'approved'` | 来源未获准入批准 | 县/市/特别区源必须由人显式批准 |
| `approved_for_ingestion = 0`，或 `approval_status ∈ {needs_review, blocked}` | 来源未获准入批准 | 被人为暂缓或拉黑 |
| `legal_review_status ∉ {approved_public, approved}`（且非空） | 该来源尚未通过法务审查 | 法务结论未落库 |

州级与联邦源沿用历史兼容规则（不需要逐个批准），县/市级批量注册源必须留痕——这是 2026-07-29 数据源注册表设计定下的规则，合规台账在 [`data-source-compliance-ledger.md`](./data-source-compliance-ledger.md)。2026-09-15 加固后手动入口与定时入口执行同一门禁，所以这些源在**任何入口**都显示治理拦截（此前手动入口曾绕过门禁）。

另有 5 个 `is_enabled = 0` 的州级占位源（`cal_eprocure`、`illinois_procurement_bulletin`、`myfloridamarketplace`、`new_york_state_contract_reporter`、`texas_smartbuy`）显示"已禁用"，与治理无关：它们是与正式州源重复的早期占位行。处理方式是通过 `PATCH /api/admin/data-sources/[id]` 把 `approvalStatus` 标为 `blocked`、`approvalNotes` 写明 `duplicate placeholder`，保留行以免历史日志指向空 id；标记后它们不再出现在批量运行面板的可运行条目里。**不要删除**，也不要为了"让面板干净"去批准它们。

## 2. 前置检查（Pre-check）

`/admin` → 数据源表 → 每行的"审批前置检查"卡片 → **前置检查** 按钮，对应 `POST /api/admin/data-sources/[id]/precheck`（admin 或 operator 角色，走 CSRF 校验）。它按顺序做三件事，**全程不入库任何招标**：

1. **robots.txt 扫描**：读取该源 `base_url` 所在主机的 robots.txt，判断被抓取的列表路径是否被 `Disallow`，结果写回 `robots_txt_status` / `robots_txt_flag_reason`。这是分诊信号，**不是法律结论**。 robots.txt **通过 Python crawler 的 HTTP 客户端抓取**（`fetch-robots` 子命令）：BidNet 这类 WAF 门户会直接拒绝 Node 的 `fetch`（无论 UA，2026-09-16 实测 403），而 crawler 的 `requests` 会话能拿到 200；爬虫看到的 robots 才是约束爬虫的那一份。`npm run source:compliance:scan` 默认同样走 crawler，`--node-fetch` 可退回 Node。
2. **试抓（dry run）**：以 `limit=5` 跑一次真实的 `fetch-task`，**跳过治理门禁**（门禁本来就是这次检查要辅助的决定），但不写库、不发通知。返回解析到的条数、前几条标题、实际用的列表解析器、HTTP 状态、是否 WAF 挑战。
3. **租户路径探测**：仅当试抓以 HTTP 404 失败时，调用只读的 `python -m apsi_crawler.cli discover-tenant`，按 `/{州名}/{slug}/…`、`/{slug}/…` 及 slug 变体逐个试探（请求之间有最小间隔，遇 202 WAF 挑战立即停止），用页面标题里的租户名确认，输出 `suggested_base_url`。

结论写回 `live_health_disposition` / `live_health_notes` / `live_health_reviewed_at`，并以三种判定呈现：

| 判定 | 面板文案 | 说明 |
| --- | --- | --- |
| `ready` | 可以批准 | 页面可达、robots 无异常、解析到了招标行 |
| `empty` | 可访问，当前无开放招标 | 页面可达且是**已验证空态**（见第 4 节），不是解析失败 |
| `needs_fix` | 需先修复 | 404 / WAF 挑战 / 解析不出行 / robots 被标记，先修再批 |

`needs_fix` **不阻止**批准——合规判断权在人。但批准一个明知 404 的源只会让调度器每轮失败一次，正确顺序是先修 `base_url` 再批。

## 3. 批准表单：每一栏是谁的责任

同一张卡片里的 **批准县/市源**（`ApproveLocalSourceDialog`）把批准与合规台账合并成**一次** `PATCH /api/admin/data-sources/[id]`（admin 角色）。提交时固定写入 `approval_status=approved`、`legal_review_status=approved_public`、`approved_for_ingestion=true`、`is_enabled=true`、`tos_reviewed=true`，外加下面这些人填的字段：

| 字段 | 谁负责 | 说明 |
| --- | --- | --- |
| 合规复核人 `compliance_reviewer` | 批准人本人 | 默认填当前登录管理员的邮箱，可改成真正承担责任的人。**必填** |
| 服务条款 URL `tos_url` | 批准人 | 勾选"我已阅读服务条款"即是在断言你读过它。留空只是不留链接，不代表没读 |
| 法务意见参考 `legal_opinion_reference` | 法务 | 工单号 / 备忘录编号。当上一次前置检查 **robots 被标记**，或该源 `requires_login = 1` 时，前端与服务端都**强制必填** |
| 下次合规复核日期 `compliance_review_due_at` | 批准人 | 默认今天 + 12 个月 |
| 合规备注 `compliance_notes` | 批准人 | 例如"仅采集公开招标列表与详情页，不触碰注册/投标流程" |
| 批准备注 `approval_notes` | 批准人 | 本次批准的理由，会随 `source_approval_events` 留痕 |

服务端的拒绝信息**原样显示**在表单里（例如 `requires_login` 行缺少复核人或法务参考时的硬校验），不做二次包装——被拒的是哪一栏，只有服务端的原话说得清。

批准不是永久豁免：到了 `compliance_review_due_at` 要重新走一遍前置检查并更新台账；门户改版、条款变更或 robots 变化时随时可以用数据源表的"暂缓"退回 `needs_review`。

## 4. 批准之后：三种"看起来像失败"的结果

### 4.1 已验证空态（零条 = 成功）

县市门户经常**确实没有**在招项目。以前这会被当成解析失败（`CoBidnetError: page did not contain open solicitations`），连续失败还会拉低源健康度。现在只有同时满足三条才判为已验证空态：

1. 页面 HTTP 200 且不是 WAF 挑战页；
2. **可见**文案中命中明确的空态短语（`no open bids` / `no open solicitations` / `no solicitations (are )?(currently )?available` / `no results found` / `there are currently no`），`aria-hidden="true"`、`hidden`、`display:none` 的隐藏元素不算——BidNet 模板在 16 条真实行上方常驻一段隐藏的"There are no open bids"（Aurora 实测），空态判定放在解析之后：sidecar 与适配器都解析出 0 行才会去看文案；
3. **租户确认**：源标签里的特征词（如 Erie、Boulder）出现在页面标题或正文中。

三条齐全 → `status = "success"`、`bids = []`、`metadata.emptyState = {verified, marker, tenant_confirmed, method}`，Node 侧 `validateCrawlerImport` 接受这种零条成功，健康度按成功回写。**缺第 3 条**（拿到的是通用错误页、跳转页或别的租户页）仍然按 `EmptyCrawlerResultError` 失败处理——否则一个拿错页面的源会永远"成功"。

批量运行面板把它显示为"空态：无开放招标"；没有空态证据的零条成功另外显示为"成功（0 条）"，两者刻意不混在一起。

### 4.2 404 租户路径：探测建议、人工写回

BidNet 的租户路径会变。前置检查在 404 时给出 `suggested_base_url`，面板上出现"写入 base_url"按钮，**点击后仍需在确认框里确认**才会 `PATCH {baseUrl}`。

不自动写入的理由很实在：租户路径填错不会报错，只会安静地把**另一个县**的招标抓进你的库里。写回前请确认候选 URL 的页面标题确实是本辖区；探测结果模糊（多个候选都 `label_match`，或一个都不匹配）时宁可留空，交给人查。

### 4.3 平台限流推迟（deferred）

BidNet Direct 在 AWS WAF 后面，同平台密集请求会集中吃 403（2026-08-21 就发生过一次，10 个源同时 403）。现在同一批次里：

- 同 `provider_family` 的源之间至少间隔 `CRAWLER_PLATFORM_MIN_INTERVAL_MS`（默认 5000 ms）；
- 其中任何一个源以挑战/限流特征失败（BidNet 挑战错误，或 HTTP 403 / 429 / 202），本批次**尚未运行**的同平台源直接返回 `status: "deferred"`、`reason: "platform_throttled:<sourceId>"`。

`deferred` 不是失败：不回写源健康度、不触发通知、worker 不重试。面板显示"平台限流，本批推迟"，并指出是哪个源触发的。处理方式是稍后单独重跑，而不是立刻重试整批——立刻重试正是招来限流的原因。

## 5. 列表解析：Scrapling 主路径与适配器回退

列表页解析配置在 `data_sources.fetch_config.list_extraction`，由管理端"爬虫配置"面板的**列表解析**分组编辑：

```json
{
  "list_extraction": {
    "mode": "scrapling",
    "render": false,
    "item_selector": null,
    "max_items": 200,
    "selectors": {
      "title": null, "url": null, "published_date": null,
      "deadline_date": null, "source_bid_id": null, "issuer_name": null
    }
  }
}
```

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `mode` | `scrapling`（默认）/ `adapter` | `scrapling` 把列表 HTML 交给抽取 sidecar 的 `POST /extract-list`（自适应选择器，门户改版更耐受）；`adapter` 保留 Python 适配器自带的解析 |
| `render` | 布尔，默认 `false` | `true` 时先用 `services/browser-downloader` 的 `POST /render` 渲染页面再解析，用于列表行由 JavaScript 注入的租户。需要配置 `BROWSER_DOWNLOADER_URL`；它只渲染公开页面，不登录、不过验证码、不越 `allowed_hosts` |
| `item_selector` | CSS/XPath 或空 | 空则由 sidecar 用启发式挑选重复容器 |
| `max_items` | 1..500，默认 200 | 每页最多解析行数 |
| `selectors` | 六个字段的 CSS/XPath | 留空则回退到启发式（锚文本作标题、锚 href 作链接、日期型单元格、路径里的数字段作门户编号） |

**回退是自动的**：sidecar 不可达、返回不合法、或解析出 0 条且不是已验证空态时，爬虫改用适配器解析，并在 `metadata.listExtraction` 记 `method: "adapter_fallback"` 与 `fallback_reason`。整个过程**不会多发一次列表请求**——两条路径共用同一份已抓取的 HTTP 响应，礼貌策略不变。

`metadata.listExtraction.method` 也显示在前置检查结果卡的"列表解析器"一行，用来判断某个源今天是走主路径还是在回退。

`render: true` 是前瞻能力：今天的 BidNet 县市列表页仍是**服务端渲染**，不需要浏览器。除非某个租户确实改成了 XHR 加载（症状是：HTML 拿得到、但里面既没有招标行也没有空态文案），否则不要开。

## 6. 相关环境变量

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `CRAWLER_PLATFORM_MIN_INTERVAL_MS` | `5000` | 同平台两个源之间的最小间隔，见 4.3 |
| `SCRAPLING_EXTRACTOR_URL` | 未设 | 抽取 sidecar 地址；未设时 `mode: scrapling` 直接走适配器 |
| `BROWSER_DOWNLOADER_URL` | 未设 | 浏览器 sidecar 地址；`render: true` 需要它 |
| `CRAWLER_TASK_TIMEOUT_MS` | `1800000` | 整个 fetch-task 预算（含补全），超时 SIGKILL |

完整清单见[环境变量参考](../transferability/environment-variables.md)。

## 7. 推荐操作顺序

1. 对目标源点**前置检查**（一次只跑一个；同平台的多个源之间留几秒，探测本身也守最小间隔）。
2. 判定 `needs_fix` 且给出了 `suggested_base_url` → 核对候选页面确属本辖区 → 点"写入 base_url"并确认 → 再跑一次前置检查。
3. 判定 `ready` 或 `empty` → 填批准表单（复核人、ToS、必要时法务参考、下次复核日期）→ 勾选条款确认 → 批准并启用。
4. 在批量运行面板单独跑一次该源，确认结果是"成功"、"空态：无开放招标"之一；若出现"平台限流，本批推迟"，稍后再单独重跑。
5. 把本次批准结论补进[合规台账](./data-source-compliance-ledger.md)。

以上是**单个源**的顺序。整批源（同一平台一次几百个）的接入——平台审查、预检入队、带台账批量批准——见第 8 节。

## 8. 批量接入（阶段 3）

第 2、3 节讲的是**一个源**：点一次前置检查、填一张批准表单。2026-09-28 注册之后，库里有约 950 个 `approval_status IS NULL` 的 BidNet 县/市/镇源（当时待预检的是 952 个），逐个走表单既不现实，也留不下一致的台账。阶段 3（设计见[设计稿](../superpowers/specs/2026-09-24-county-data-completeness-design.md)第 7 节及其"实施补充（阶段 3）"）把这条路换成三步：

1. **平台审查**：人对整个平台做一次合规审查（ToS、robots.txt、访问边界），记成一行（8.1）；
2. **预检入队**：给源打上"待预检"标记，由爬虫 worker 在平台预算内替你跑第 2 节的前置检查（下文简称**预检**）（8.2）；
3. **带台账批量批准**：服务端逐个核对三项检查（外加 8.7 的几种跳过情形），全部通过的源一次写好台账并批准（8.3）。

原则同前：**没有一步替人放行。** 平台审查由 admin 亲手建立，预检只产出证据，批准是 admin 的一次点击；而且服务端在写入前会把全部检查**再做一遍**——面板上的数字只是提示，不是授权。批量路径只管**同一平台的一整批源**，个别源、不属于任何平台的源和例外情况仍走第 3 节的表单（8.4）。

### 8.1 平台审查

`platform_reviews` 表的一行 = "某平台在某天被审查过一次"。它把原本每个源各填一遍的 ToS、robots.txt、访问边界提到平台一级记一次；批量批准时再复制进每个源自己的台账（复制关系见[合规台账](./data-source-compliance-ledger.md#平台审查platform_reviews)）。

**在哪里建。** `/admin` → **数据源**区块**最上方**的"平台合规审查"面板（"新建审查"按钮；只有 admin 看得到表单，operator / support 只读），或 `POST /api/admin/platform-reviews`。面板里"复核人"取当前登录管理员的邮箱，且不可改；建审查需要以 admin 登录管理端。

| 字段（请求体键名，面板同名） | 必填 | 说明 |
| --- | --- | --- |
| `providerFamily` | 是 | 小写 slug（`a-z`、`0-9`、`_`、`-`），对应 `data_sources.provider_family`，如 `bidnet`；不能是显示用的占位家族 `public_portal` / `state_portal` / `federal_portal`（8.4） |
| `tosUrl`、`tosReviewedAt` | 是 | 服务条款地址（http/https）与通读日期。BidNet 是 `https://www.bidnetdirect.com/tsandcs`，其内容与 APSi 的关系见下方"首轮实测" |
| `robotsUrl`、`robotsCheckedAt` | 是 | robots.txt 地址与取得时间；必须经 crawler 取（见下） |
| `robotsSummary` | 是 | 一行摘要：禁止的路径范围，以及为什么它不覆盖被抓取的列表/详情路径 |
| `reviewer` | 是 | 复核人。面板取登录邮箱；curl 要自己写 |
| `nextReviewAt` | 是 | 下次复核日期，必须晚于 `reviewedAt` |
| `reviewedAt` | 否 | 审查日期，省略取提交时刻。"有效审查"就按它排序 |
| `legalOpinionReference` | 否 | 法务意见/工单号。批准 `requires_login = 1` 的源时必须有（8.3） |
| `accessBoundary` | 否 | 省略即写入固定句：`只读公开列表与详情页；不登录、不取会员内容、不绕 WAF` |
| `notes` | 否 | 备注 |

校验失败返回 400 `INVALID_REQUEST`，`message` 把所有问题用 `; ` 连起来一次给全。

**有效 / 到期 / 缺失。** 一个平台的有效审查是它 `reviewed_at` **最新**的那一行（不是"最新的未到期一行"：最新一行到期了，更早的未到期行也不会顶上）：

| 状态 | 条件 | 后果 |
| --- | --- | --- |
| `valid` 有效 | 最新一行的 `next_review_at` 在当前时刻之后 | 可以批量批准该平台的源 |
| `expired` 到期 | 最新一行的 `next_review_at` 已过 | 批量批准该平台的源一律跳过（`platform_review_expired`）；**已批准的源照常运行**，不会被回退 |
| `missing` 缺失 | 该平台一行都没有 | 同样跳过（`missing_platform_review`） |

因此**不要把 `reviewedAt` 写成未来日期**——它会一直是"最新一行"，压住之后所有的续期；续期的 `nextReviewAt` 也不要选得比仍未到期的旧行更早——最新一行一到期，平台就读作到期，旧行不会顶上。到期后面板上该平台的状态徽标变成"已到期"，批量批准面板提示"平台审查已到期或缺失，先在上方续期再批准"。

**谁能做什么。** `POST` 只有 admin，并走 CSRF 校验；`GET`（审查列表，外加每个平台的有效审查与状态）admin / operator / support 都能读。每次写入是一条审计事件 `platform_review.created`（`event_log`，`target_type = 'platform_review'`，`before_after_json` 里是整行），同时 `created_by` 记建立者的用户 id。**续期 = 再建一行**：旧行留作历史，没有 PATCH，也没有删除。面板的"续期"只把 ToS 与 robots.txt 两个地址带过去，摘要、法务参考、备注都要重写——它们记的是"那一天查到了什么"。

**先经 crawler 取 robots.txt**（第 2 节讲过：BidNet 的 WAF 拒绝 Node `fetch`），再把 `Disallow` 的范围写成一行摘要。BidNet 2026-09-21 的禁止范围见 [`source-discovery.md`](./source-discovery.md) 第 2 节，以当天取到的为准：

```bash
cd crawler
echo '{"base_url":"https://www.bidnetdirect.com/participating-buyers"}' \
  | python3 -m apsi_crawler.cli fetch-robots \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["status"], d["robots_url"]); print("\n".join(l for l in d["body"].splitlines() if l.lower().startswith(("user-agent","disallow","allow"))))'
```

本地开发用 `ADMIN_UI_LOCAL_BYPASS=true`（只在 `NODE_ENV !== "production"` 时生效；`.env.local` 里设，重启 dev server）时接口不要求会话，可以直接 curl。此时 `created_by` 为空、审计事件的操作者记为 `system`，所以 `reviewer` 必须自己写：

```bash
curl -sS -X POST http://localhost:3000/api/admin/platform-reviews \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:3000' \
  -d '{
    "providerFamily": "bidnet",
    "tosUrl": "https://www.bidnetdirect.com/tsandcs",
    "tosReviewedAt": "2026-09-30",
    "robotsUrl": "https://www.bidnetdirect.com/robots.txt",
    "robotsCheckedAt": "2026-09-30T08:00:00Z",
    "robotsSummary": "<当天 fetch-robots 取到的 Disallow 范围，一行>",
    "reviewer": "<复核人邮箱>",
    "legalOpinionReference": null,
    "nextReviewAt": "2027-09-30",
    "notes": "<可选>"
  }'
# 201 {"review":{"id":"prv_…","providerFamily":"bidnet",…}}

curl -s http://localhost:3000/api/admin/platform-reviews \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k: v["status"] for k, v in d["effective"].items()})'
# {'bidnet': 'valid'}
```

`Origin` 头可以省（CSRF 校验对既无 `Origin` 也无 `Referer` 的请求放行）；写了就必须是本站来源，跨站来源答 403 `CSRF_VALIDATION_FAILED`。

### 8.2 预检入队

**入队只打标记，不发任何请求。** `data_sources.precheck_requested_at` 是队列标记：只由入队操作**设置**、只由 worker 在预检**完成**后清除。三种入队方式效果相同：

```bash
cd frontend
export DATABASE_URL='mysql://…'    # 脚本不读 .env.local；不导出就落到 SQLite（data/apsi.sqlite）——看输出括号里是 MySQL 还是 SQLite
npm run source:precheck -- --provider bidnet --pending --dry-run   # 先看会入队哪些，什么都不写
npm run source:precheck -- --provider bidnet --pending             # 真入队
npm run source:precheck -- --source <id> --source <id>             # 按 id 入队（可重复）
```

- 脚本必须是 `--provider <平台> --pending`，或至少一个 `--source <id>`；参数组合不对（单独的 `--provider` 或 `--pending`、什么参数都没有、参数不认识）都会打印用法并以退出码 1 结束。输出形如 `Dry run (MySQL): N sources would be queued`（后面逐行列出 id）与 `Queued N sources for precheck (MySQL): …`（真入队，只列前 20 个 id）。
- 管理端"带台账的批量批准"面板里的"**为待预检源入队**"按钮（admin / operator）做的是 `--pending` 那一种，接口是 `POST /api/admin/data-sources/precheck-requests`，请求体 `{"providerFamily":"bidnet","pending":true}` 或 `{"sourceIds":["…"]}`（最多 500 个 id），返回 `{ requestedCount, sourceIds }`。
- 队列标记本身不触碰任何治理列，入队之后源仍在治理拦截中。

**`pending`（待预检）的定义**，脚本、接口和按钮共用一份，就是"待预检且尚未入队"：它和就绪度的"待预检"一组用同一条预检证据规则（`precheck-queue.ts` 的 `precheckEvidence`，见 8.3）。本地级别（`county` / `city` / `township` / `special_district`）、`is_enabled = 1`、`approval_status` 为空或 `needs_review` 且不是被人暂缓的（8.7）、`precheck_requested_at` 为空（没有排在队里），并且存的预检用不上：没有预检；记的地址不是当前 `base_url`（或旧格式备注没记地址）；预检之后又有失败或治理变更（`last_failure_at` 或 `last_approval_reviewed_at` 晚于 `live_health_reviewed_at`）；或超过 14 天。14 天内对当前地址的 `needs_fix` 不算待预检——要先有人修，否则再预检一次结论也一样。平台审查缺失或到期时，这些源在就绪度里落在"缺平台审查"，但照样会被入队。按 id 入队则不看这些条件，只跳过已经在队里的。

**worker 怎么消化队列。** `npm run worker:crawler`（起之前可以先 `npm run worker:crawler:check`；和脚本一样，不读 `.env.local`，连 MySQL 要在启动它的 shell 里导出 `DATABASE_URL`）每个 tick（`CRAWLER_WORKER_INTERVAL_MS`，默认 15 分钟）先跑日常列表，**然后**用**同一个 tick 的 `PlatformTickBudget`**——也就是日常列表花剩下的额度（设计稿 §5.5 的优先级 2）——跑预检队列（`frontend/src/server/crawler/precheck-queue-runner.ts`）：

- 按 `precheck_requested_at` 从旧到新。每 tick 最多读 500 行、最多**开始** 50 个预检；因预算、平台暂停或退避而跳过的行不占这 50 个名额。
- 每个预检**预扣 2 个请求**（robots.txt 一次 + 列表页一次）；预检以 404 收场、触发了租户探测（最多 6 个请求），按 **2 + 6** 结算。额度不够就留到下个 tick，不算失败。
- robots.txt **每个主机每 tick 只取一次**（按 URL 缓存；BidNet 所有租户共用 `https://www.bidnetdirect.com/robots.txt`）。日志里的 `robotsFetches` 是本 tick 实际取了几个不同的 robots 地址：只要这个 tick 至少开始了一个预检，BidNet 独占队列时它就是 1；一个预检都没开始时为 0——日常列表把额度花光了、平台正被暂停，或队列是空的。
- 同一平台两个预检之间至少隔 `CRAWLER_PLATFORM_MIN_INTERVAL_MS`（默认 5000 ms）。日常列表与预检两步各自计时，两步衔接处不额外等待。
- 预检本身就是第 2 节那一套：不入库任何招标，写回 `robots_txt_*` 与 `live_health_*`，并把当时用的 `base_url` 记进结论备注（`live_health_notes` 里的 `precheck.baseUrl`），批准时核对（8.3 的第 3 项）。
- 停止信号若在日常列表阶段到来，这个 tick 不再开始预检；标记留在库里，下次启动接着跑。队列这一步整体抛错只记 `crawler_precheck_queue_failed` 日志并上报，不影响日常爬取。

**什么算"完成"。** 只有预检给出了关于**该源自己**的结论，才清除标记：

| 预检结果 | 怎么判 | 队列标记 | 对平台的影响 |
| --- | --- | --- | --- |
| **完成** | `ready`、`empty`，以及 404、解析失败、没解析到行这类 `needs_fix`——它们都是关于源本身的证据 | 清除 | 无 |
| **挑战** | 试抓**失败**，且是 WAF 挑战（HTTP 403 / 202，或 `…ChallengeError`）或 HTTP 429 | **保留** | 暂停整个平台 `CRAWLER_PLATFORM_PAUSE_MS`（默认 30 分钟，日常列表也被挡住），本 tick 该平台剩余的预检停止 |
| **环境 / 瞬时失败** | 没拿到结果文档（解释器缺失、超时、崩溃、输出解析不了），或网络类错误、HTTP 5xx、`HTML request failed:`（连接层失败） | **保留** | 本 tick 该平台剩余的预检停止；**不**暂停平台 |

只有失败的试抓才会被读成挑战或错误：一次解析出了行的试抓，不会因为某个详情页在日志里出现过 403 就被当成挑战。

**重试与放弃。** 被挑战或出错的源保留原来的队列时间戳（继续排在队首），worker 在内存里给它记一笔退避：`当前时刻 + CRAWLER_PLATFORM_PAUSE_MS` 之前不再尝试。两类情形在日志里的表现不同：

- **挑战**：整个平台被暂停，暂停期内该平台的所有队列行（包括这个源）都计入 `skippedPaused`；它自己的退避与暂停同时结束，所以挑战一般只体现为 `skippedPaused`。（没有 `provider_family` 的源没有平台可暂停，只有它自己的退避，计入 `skippedRetry`。）
- **环境 / 瞬时失败**：平台不暂停。本 tick 内该平台剩下的行计入 `skippedPaused`（平台在本 tick 停掉了）；之后的 tick 里只有这个源因退避被跳过、计入 `skippedRetry`，同平台的其余源照常处理。

**连续 3 次**（`PRECHECK_MAX_ATTEMPTS`）挑战或出错后放弃：清除标记，结果记为 `abandoned`，并打一条 `crawler_precheck_abandoned` 警告日志。预检写过结论的源，行里仍是最后一次写下的 `needs_fix` 与原因，14 天内不会再被 `--pending` 选中；要重试就按 id 入队：`npm run source:precheck -- --source <id>`。这份退避记忆只在 worker 进程内存里，重启即清零——平台暂停也是。

**被挑战的源在就绪度里先读作"已排队"。** 预检在返回之前已经把 `needs_fix` 与原因写进行里，但标记保留期间，这个源在就绪度里读作 `precheck_queued`（待预检），排在预检证据之前判断，不会落进"需修正"。放弃（`abandoned`）之后标记清除，它才读作 `precheck_needs_fix`，所以"需修正"里可能混有放弃了的被挑战源。区分办法：`live_health_notes` 里 `precheck.fetch.wafChallenge` 为 `true`。

**预算算术。** 每 tick 的额度是 `⌊每小时额度 × tick 时长 ÷ 1 小时⌋`（见[生命周期与预算](./bid-lifecycle-and-crawl-budget.md)第 4 节）。默认 `bidnet=60`、tick 15 分钟，每 tick 15 次请求。日常列表先花，预检只拿剩下的；下表假设当天没有别的 BidNet 请求到期、没有预检以 404 收场（每个 404 要花 8 而不是 2）：

| `CRAWLER_PLATFORM_BUDGETS` | 每 tick 额度 | 每 tick 预检数 | 每小时 | 952 个源约需 |
| --- | --- | --- | --- | --- |
| `bidnet=60`（默认） | 15 | 7（14 个请求，余 1） | 28 | 34 小时 |
| `bidnet=120` | 30 | 15 | 60 | 约 16 小时 |

这是**下限**：worker 每轮是"跑完再睡 15 分钟"，实际周期是 15 分钟加上本轮耗时；已批准的源越多，日常列表占的额度越多。`bidnet=120` 会把对 BidNet 的持续请求率翻倍，而 BidNet 对**持续 60 次/小时**的容忍度本身还没实测过（设计稿第 14 节的风险 1，阶段 3 首轮全量时核实），120 更没有——先用默认值跑，看 `challenge` 计数与平台暂停，再决定要不要调；该变量是 worker 进程的环境变量，改后要重启 worker。

**日志。** worker 的日志是 JSON 行：`crawler_precheck_abandoned` 与 `crawler_precheck_queue_failed` 写到 stderr，另外两个写到 stdout，按事件名 grep 时两个流都要看：

| 事件 | 内容 |
| --- | --- |
| `crawler_precheck_queue_processed` | 每 tick 一行汇总计数：`queued`（本 tick 读到的队列行数）、`done`、`challenge`、`error`、`abandoned`、`skippedBudget`（额度不够）、`skippedPaused`（平台被暂停，或本 tick 内已因挑战 / 错误停掉）、`skippedRetry`（源自己还在退避期）、`stoppedFamilies`、`robotsFetches`（本 tick 取了几个不同的 robots 地址） |
| `crawler_precheck_queue_completed` | worker 的结构化日志，`prechecks` 字段是完整结果：`processed[]` 逐个源的 `outcome`（`done` / `challenge` / `error` / `abandoned`）、`verdict`、`error` |
| `crawler_precheck_abandoned` | 警告：`source`、`family`、`attempts`、`lastOutcome`、`reason` |
| `crawler_precheck_queue_failed` | 错误：队列这一步整体失败 |

看队列进度：

```sql
SELECT COUNT(*) AS queued, MIN(precheck_requested_at) AS oldest FROM data_sources WHERE precheck_requested_at IS NOT NULL;
```

**一个 worker，且别同时手动打同一平台。** 预算与暂停都在 worker 进程内存里，队列也没有逐源租约：起两个 crawler worker 会重复预检、成倍花额度。管理端的单源预检和手动运行**不占** worker 的预算，也不受它的内存暂停约束——worker 在消化队列时，别再手动对同一平台跑预检或爬取。

### 8.3 带台账批量批准

批准的入口是管理端"带台账的批量批准"面板（数据源区块，平台审查面板下面）或 `POST /api/admin/data-sources/batch`（`action: "approve"`，只有 admin，一次最多 100 个 id）。**本地源**（`jurisdiction_level` 有值且不是 `federal` / `state`，和治理门禁 `blockedReasonFor` 是同一条规则）只有同时通过下面三项检查、又不属于 8.7 列出的几种情形时才会被批准；联邦/州级源不受影响，仍走旧的通用批准。

已经 `approved` 的读作 `already_approved`，`blocked` 的读作 `blocked`——批量批准既不重复批准，也**不解除拦截**。被人暂缓的读作 `held`，已停用的读作 `disabled`（8.7）。其余按下面的顺序过检，几项都不满足时只报第一个：

1. **平台审查有效**：该 `provider_family` 的有效审查存在且未到期。缺 → `missing_platform_review`；到期 → `platform_review_expired`。
2. **台账与队列**（8.7）：`requires_login = 1` 而有效平台审查没有 `legalOpinionReference` → `login_requirements_unmet`；已排队等新的预检 → `precheck_queued`。
3. **地址没变**：先要有预检（`live_health_disposition` 或 `live_health_reviewed_at` 为空 → `precheck_missing`）；预检备注里记的 `precheck.baseUrl` 必须与该行**当前** `base_url` 完全相同。预检之后改过 `base_url`，或备注是阶段 3 之前的旧格式（没有记 `baseUrl`）→ `base_url_changed`，不论那次预检的结论是什么。
4. **预检之后没有新情况**：`last_failure_at` 与 `last_approval_reviewed_at` 都不晚于 `live_health_reviewed_at`，否则 → `precheck_superseded`（8.7）。
5. **预检结论可用**：`live_health_reviewed_at` 距今**不超过 14 天**（太旧 → `precheck_stale`），且 `live_health_disposition` 是 `ready` 或 `empty`（结论是 `needs_fix` → `precheck_needs_fix`）。

第 1、3、5 项就是设计稿 §7.3 的三项检查。第 3–5 项是同一条预检证据规则（`precheck-queue.ts` 的 `precheckEvidence`），"为待预检源入队"按的也是它（8.2）。

**写入什么。** 通过的源一次写好。它与第 3 节表单走同一条更新路径（`updateAdminDataSource`），写的台账列几乎相同，只是值取自平台审查，并且**覆盖**行里原有的值（含清空）：

| `data_sources` 列 | 值 |
| --- | --- |
| `approval_status` / `legal_review_status` / `approved_for_ingestion` / `is_enabled` | `approved` / `approved_public` / `1` / `1` |
| `compliance_reviewer` | 平台审查的 `reviewer` |
| `tos_url`、`tos_reviewed`、`tos_reviewed_at` | 平台审查的 `tos_url`；`1`；平台审查的 `tos_reviewed_at`（条款被通读的日期，不是批准时刻） |
| `legal_opinion_reference` | 平台审查的 `legal_opinion_reference`（可为空） |
| `compliance_review_due_at` | 平台审查的 `next_review_at` |
| `approval_notes` | `依据平台审查 #<平台审查 id>；预检 <ready 或 empty> @<live_health_reviewed_at>`，例如 `依据平台审查 #prv_…；预检 ready @2026-10-01T03:12:44.100Z` |

同时自动盖上 `last_approval_reviewed_at`，并写一行 `source_approval_events`（`action = 'approved'`，`reason` 就是上面的 `approval_notes`，`actor_user_id` 是批准的 admin，本地 bypass 下为空）。**不写** `compliance_notes`（保持原值）；逐源的 `robots_txt_*` 由各源自己的预检写入，批量批准不改。

**就绪度与六个分组。** `GET /api/admin/data-sources/approval-readiness?providerFamily=bidnet`（admin / operator / support）由服务端算好每个本地源落在哪一组，面板与运维用的 curl 共用这一个定义；不带 `providerFamily` 则列出所有平台的本地源，`platformReview` 为 `null`。返回 `providerFamily`、`platformReview`（`status` + `review`）、`counts`（六组计数）和 `sources[]`（每个源的 `bucket`、`reason`、当前 `baseUrl`、`suggestedBaseUrl`、`precheckRequestedAt`、`liveHealthDisposition`、`liveHealthReviewedAt`）：

| 分组（面板 / `bucket`） | 含义 | 怎么处理 |
| --- | --- | --- |
| 可批准 `approvable` | 全部检查通过 | "批准全部可批准项"，或 `POST batch` |
| 待预检 `awaiting_precheck` | `precheck_missing`、`base_url_changed`、`precheck_superseded`、`precheck_stale`，以及已在队列里等 worker 的 `precheck_queued` | "为待预检源入队"（`--pending` 选中除 `precheck_queued` 之外的全部，8.2） |
| 需修正 `needs_fix` | 对当前地址、14 天内的预检结论是 `needs_fix`（404、解析不出行、被挑战后放弃……） | 保持未批准。面板列出当前地址和租户探测的**建议地址**（纯文本，绝不自动写入；最多列 50 个，其余读 `approval-readiness`）；核对后按 4.2 节写回 `base_url`，它随即读作 `base_url_changed`，再入队重跑预检 |
| 缺平台审查 `missing_platform_review` | 该平台没有有效审查（缺失或到期） | 先建或续期（8.1）。审查检查排在预检检查之前，所以审查缺失时所有尚未批准、未拦截、未暂缓、未停用的本地源都落在这一组，"需修正"等数字要等审查有效之后才有意义 |
| 已批准 `approved` | `approval_status = approved` | — |
| 已拦截 `blocked` | `approval_status = blocked`（`blocked`），被人暂缓（`held`），已停用（`disabled`），或需登录而平台审查缺法务参考（`login_requirements_unmet`） | 批量批准都不处理：拦截与暂缓走第 3 节单源表单解除；停用的先在源编辑里启用；需登录的续一行带法务参考的平台审查，或走单源表单 |

**批准全部。** "批准全部可批准项（N）"只在平台审查为"有效"、N > 0、且是 admin 时可点。它取最近一次就绪度里 `approvable` 的 id，**按 100 个一批**（`APPROVAL_BATCH_CHUNK_SIZE`）依次提交，显示"已提交 X / N"，最后给"已批准 A，跳过 B。"和按原因分列的跳过数；服务端提交时会重新过一遍全部检查，所以两次读取之间变旧的源会被跳过并说明原因。点一下就开始提交，没有二次确认。某一批失败时前面的批次已经批准了，面板显示"批量批准失败：…"、照常给出已完成部分的统计并重读计数。数据源表勾选若干行再点"批量批准"走的是同一个接口：本地源同样只走台账，被跳过的行保持勾选，提示变成"已批准 A，跳过 B。"。表格每行的"批准"按钮对县/市/镇源不再显示——它写不出台账；要单个批准用第 3 节的表单。

接口应答（脚本化时自己按 100 切块）：

```bash
curl -sS -X POST http://localhost:3000/api/admin/data-sources/batch \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' \
  -d '{"action":"approve","sourceIds":["<id>","<id>"]}'
# {"updatedCount":1,"skippedCount":1,
#  "outcomes":[{"sourceId":"<id>","outcome":"approved","reason":null},
#              {"sourceId":"<id>","outcome":"skipped","reason":"precheck_stale"}],
#  "sources":[…只含已批准的行…]}
```

`outcome` 是 `approved`（`reason` 为 `null`，联邦/州级源也是）或 `skipped`。错误：`sourceIds` 缺失、超过 100 个或 `action` 不是 `approve` / `hold` → 400 `INVALID_REQUEST`；任何一个 id 不存在 → 404 `DATA_SOURCE_NOT_FOUND`（整个请求答 404，但其余 id 已按规则处理过）；非 admin → 403 `FORBIDDEN`。`requires_login = 1` 的**本地**源不会再让请求中断：平台审查没填 `legalOpinionReference` 时，它在写入之前就被跳过（`login_requirements_unmet`），同一请求里的其余 id 照常处理。走通用批准的联邦/州级 id 若 `requires_login = 1` 而台账缺复核人、法务参考或 ToS 复核，仍答 400 `APPROVAL_REQUIREMENTS_UNMET`；批是逐个写的、没有事务，同一请求里排在它前面的源已经批准。`action: "hold"` 不变，仍是通用的"暂缓"，应答只有 `updatedCount` 与 `sources`。

**跳过原因**（`outcomes[].reason` 与就绪度的 `reason`：下表前十三个；最后一行的 `not_local` 不会出现在 HTTP 应答里）：

| `reason` | 管理端文案 | 含义 | 处理 |
| --- | --- | --- | --- |
| `missing_platform_review` | 无有效平台审查 | 该平台从未建过审查 | 8.1 新建 |
| `platform_review_expired` | 平台审查已到期 | 最新一行的 `next_review_at` 已过 | 续期 |
| `precheck_missing` | 尚未预检 | `live_health_disposition` 或 `live_health_reviewed_at` 为空 | 入队 |
| `precheck_stale` | 预检超过 14 天 | 对当前地址的预检，但太旧（不论结论） | 重新入队（`--pending` 会带上它） |
| `precheck_needs_fix` | 预检需修正 | 对当前地址、14 天内的结论是 `needs_fix` | 见"需修正" |
| `base_url_changed` | 预检后地址已变 | 预检记的 `baseUrl` 与当前 `base_url` 不同，或旧备注没有记（不论结论） | 重新入队（`--pending` 会带上它） |
| `already_approved` | 已批准 | `approval_status` 已是 `approved` | 无需处理 |
| `blocked` | 已拦截 | `approval_status` 是 `blocked` | 批量批准不解除；单源表单 / PATCH |
| `held` | 已被人工暂缓——请通过单源审批表单批准 | 被人暂缓：`needs_review` 是治理变更写下的，之后没有更晚的失败（8.7） | 只能走第 3 节单源表单 |
| `disabled` | 数据源已停用 | `is_enabled = 0` | 先启用再批 |
| `login_requirements_unmet` | 需登录的数据源缺少法律意见引用 | `requires_login = 1`，平台审查没有 `legalOpinionReference` | 续一行带法务参考的平台审查，或走单源表单 |
| `precheck_queued` | 已排队等待新的预检 | `precheck_requested_at` 不为空，旧结论在新预检跑完前不作数 | 等 worker |
| `precheck_superseded` | 预检之后发生过失败或治理变更——需重新预检 | `last_failure_at` 或 `last_approval_reviewed_at` 晚于 `live_health_reviewed_at` | 重新入队（`--pending` 会带上它） |
| `not_local` | （无文案） | 只出现在纯函数 `evaluateLedgeredApproval` 里，表示联邦/州级源。批量接口对这类源直接走通用批准，就绪度接口不列它们，所以 HTTP 应答里见不到 | — |

**控制台怎么显示。** 已注册但未批准的县/市/镇源，数据源表里现在读作"待审核"并带"需要批准"标记，与治理门禁一致——此前它们被误显示为"已批准"（管理端 DTO 对空的治理列默认"已批准"，与爬虫门禁相反）。

### 8.4 与单源表单的关系

批量路径不取代第 3 节的表单，两者走同一条更新路径，先后不冲突：表单批准过的源在就绪度里读作"已批准"。联邦/州级源不在本节范围内，仍是旧的通用批准。下面这些**本地源**仍走第 2、3 节：

- **不属于任何平台的源**（`provider_family` 为空，如自有站点的县）：在就绪度接口里读作占位家族 `public_portal`，未批准的都落在"缺平台审查"。**不能为 `public_portal`（以及 `state_portal` / `federal_portal`）建平台审查**——那等于给所有自有站点一并放行，而它们各自的 ToS 与 robots.txt 本来就要逐个看。`POST /api/admin/platform-reviews` 对这三个名字答 400 `INVALID_REQUEST`，批量批准面板也不再把它们列成可选的平台。
- **预检 `needs_fix` 后要人来判断的**：改 `base_url`、重跑预检，再回到批量路径，或者直接在表单里批准。
- **被人暂缓的源**（`held`，8.7）：批量路径永远跳过它，只能在表单里批准。
- **robots.txt 被标记、或 `requires_login = 1` 的源**：表单强制填法务参考（第 3 节）；批量路径不看逐源的 robots 标记（见 8.6），`requires_login = 1` 而平台审查没有法务参考的则跳过（`login_requirements_unmet`）。
- **需要给单个源写专门的 `compliance_notes`** 的例外。

### 8.5 批量接入的操作顺序

1. **迁移**：MySQL 先 `cd frontend && npm run db:mysql:migrate`（新表 `platform_reviews` 与新列 `data_sources.precheck_requested_at`）。
2. **平台审查**（8.1）：先取 robots，再建 `bidnet` 那一行；GET 确认 `effective.bidnet.status` 是 `valid`。
3. **看会入队什么**：`npm run source:precheck -- --provider bidnet --pending --dry-run`，数字合理再去掉 `--dry-run`。
4. **起 worker**，观察前几个 tick 的 `crawler_precheck_queue_processed`：`done` 在涨、`challenge` 是 0，有预检开始的 tick 里 `robotsFetches` 是 1（一个预检都没开始的 tick 是 0，见 8.2）。出现挑战时确认平台被暂停（`skippedPaused` 上升）、暂停期过后恢复。
5. **看就绪度**（面板计数或 `approval-readiness`）。批准前先抽查逐源 robots 分布（见 8.6）。
6. **分轮批准**：每积累一批"可批准"就点一次"批准全部可批准项"，记下"已批准 / 跳过"和各原因。**不要等全部预检完再一次批**：刚批准的源没有 `last_success_at`，下个 tick 起全部到期，而日常列表先于预检花额度（每个源先按最多 4 页预扣，跑完按实际请求数退还），一次批准很多源会让队列里剩下的预检等首跑排完才有额度。
7. **处理"需修正"**：逐个核对建议地址，写回 `base_url`，再按 id 入队重跑预检。
8. **抽查**：随机抽几个已批准的源，核对台账各列与 `approval_notes`，以及 `source_approval_events`：

```sql
SELECT id, approval_status, approved_for_ingestion, is_enabled, legal_review_status, compliance_reviewer, tos_url,
       tos_reviewed_at, legal_opinion_reference, compliance_review_due_at, approval_notes, last_approval_reviewed_at
  FROM data_sources WHERE id = '<源 id>';
SELECT action, previous_approval_status, next_approval_status, reason, actor_user_id, created_at
  FROM source_approval_events WHERE source_id = '<源 id>' ORDER BY created_at DESC;
```

### 8.6 已知限制

- **已批准源的台账续期没有批量入口。** 批准时复制进源行的 `compliance_review_due_at` 是当时平台审查的 `next_review_at`；之后续期平台审查只影响以后的批量批准，**不回写**已批准的源，批量批准对已批准的源又只会答 `already_approved`。到期前要逐个 `PATCH /api/admin/data-sources/<id>` 更新 `complianceReviewDueAt`（以及需要的话 `complianceReviewer` 等）。
- **逐源 robots.txt 标记不在三项检查里。** 平台审查的 `robots_summary` 覆盖同一主机的 robots.txt；某个源的预检把 `robots_txt_status` 记成 `disallow_*` / `unreachable` 时，批量批准照样放行（[合规台账](./data-source-compliance-ledger.md)"What 'approved' requires"第 4 条要求这种情况有法务参考）。批准前看一眼分布，有异常的源走第 3 节表单：

```sql
SELECT robots_txt_status, COUNT(*) FROM data_sources
 WHERE provider_family = 'bidnet' AND jurisdiction_level IN ('county','city','township')
   AND (approval_status IS NULL OR approval_status = 'needs_review')
 GROUP BY 1;
```

- **"待预检"计数包含已在队列里的源。** 读作 `precheck_queued` 的源已经在等 worker，按钮不会再入队一次（计数随预检完成下降）；计数不为 0 而按钮报"已入队 0 个源"时，就是这些。被人暂缓的与已停用的在"已拦截"里，不算待预检，也不会被入队。
- **平台暂停与预检退避只在 worker 内存里**，重启即清零；重启后第一个 tick 就会再试刚被挑战的平台。
- **批准不是事务。** 一次请求里的多个 id 逐个写入，中途失败时前面的已经生效（重读就绪度即可看到真实状态）。

### 8.7 暂缓、停用、需登录、排队与预检后的变化（2026-09-29 修正）

`needs_review` 有三种来历：从没审过（注册后治理列为空）、被人暂缓（单源"暂缓"或批量 `hold`）、被源健康回写降级（`recordSourceFailure*`）。原来批量批准只分得清 `approved` 和 `blocked`，后两种源会凭暂缓或失败**之前**的那次预检重新读作"可批准"，"批准全部可批准项"一点就把它们批回去。现在批量批准（和就绪度）另外跳过五种源，都不写任何东西：

- **`held` 被人暂缓**：`approval_status = needs_review` 是治理变更写下的（它同时盖上 `last_approval_reviewed_at`），且之后没有更晚的失败来解释它（`last_failure_at` 不晚于 `last_approval_reviewed_at`）。注册后治理列为空的源 `last_approval_reviewed_at` 为空，不算暂缓。**人的暂缓只能通过第 3 节的单源表单解除**：之后再预检多少次，批量批准都不会接手它。（唯一的窄缝：点“暂缓”时恰好正在跑的那一次抓取，如果在暂缓之后失败，它会写下更晚的 `last_failure_at`，这个源就读作被降级而不是被暂缓，新的预检之后可能被批量批准收回；暂缓后请确认该源没有正在进行的运行。）
- **`disabled` 已停用**：`is_enabled = 0`。批准会写 `is_enabled = 1`，原来会悄悄重新打开有人关掉的源。
- **`login_requirements_unmet`**：`requires_login = 1`，而有效平台审查没有 `legalOpinionReference`。原来这会在批次中途答 400，挡住同一请求里排在它后面的所有 id。
- **`precheck_queued`**：已有人为它排了新的预检，旧结论在新预检跑完之前不作数。
- **`precheck_superseded`**：预检之后发生过失败（降级会写 `last_failure_at`）或治理变更（`last_approval_reviewed_at`）。要一次**晚于**那次失败或变更的新预检，批量批准才会把它收回来；"为待预检源入队"会带上它。

`blocked` 仍然是拦截，批量批准不解除。"为待预检源入队"与 `--pending` 和就绪度的"待预检"用同一条规则（8.2）。

**发布说明：解析类失败又是"第一次就降级"。** 自 Task 6b（提交 `f46a140`，分类收窄见 `e1d1fc8` / `e80ef84`）起，`runCrawlTask` 报告 crawler 自己的结构化错误类，不再报进程退出码。于是解析类失败——`HtmlPageError` 的 404、非 HTML、空页、缺表头，`*NormalizationError`，`JSONDecodeError`，`KeyError`——**第一次出现**就把源降为 `needs_review`。这条规则一直在，但从 `aa3e6ef`（2026-09-16）起每个失败都被读成退出码 "1"（`unknown`，连续 5 次才降级），它一直没生效；现在它对所有源重新生效，州级源也一样。一次有问题的 crawler 部署（比如到处抛 `KeyError`）可以在一个 tick 里把所有已批准的源降级。被降级的源读作 `precheck_superseded`，要一次晚于那次失败的新预检才能再批量批准；整批重新预检按 8.2 的预算算术，默认 `bidnet=60` 下 952 个源约需 34 小时。部署新的 crawler 前后，盯住 `approval_status` 从 `approved` 变成 `needs_review` 的数量。

## 首轮实测（2026-09-16，本地 MySQL `winbids`）

前提：dev server 在 3000（`ADMIN_UI_LOCAL_BYPASS=true`，回环）；解析 sidecar 8091、浏览器 sidecar 8092 均为宿主机 `run-local.sh`；10 个 BidNet 县市源均为 `approval_status IS NULL`（治理拦截）。

### 前置检查（`POST /api/admin/data-sources/<id>/precheck`，`limit=5`）

| 源 | 判定 | robots | 试抓 | 说明 |
| --- | --- | --- | --- | --- |
| `bidnet_co_city_aurora` | `ready` | clear | 5 行（scrapling） | 页面实有 16 条 |
| `bidnet_co_denver` | `ready` | clear | 5 行 | |
| `bidnet_co_jefferson` | `ready` | clear | 4 行 | |
| `bidnet_mi_washtenaw` | `ready` | clear | 5 行 | |
| `bidnet_co_boulder` | `empty` | clear | 已验证空态 | 页面可见文案 "There are no open bids at this time."，租户名确认 |
| `bidnet_ny_erie` | `empty` | clear | 已验证空态 | 同上 |
| `bidnet_oh_city_columbus` / `bidnet_oh_cuyahoga` / `bidnet_oh_franklin` / `bidnet_wy_laramie` | `needs_fix` | clear | HTTP 404 | 租户探测各试 6 个候选路径（`/ohio/<slug>/…`、`/<slug>/…` 及 slug 变体）全部 404，无建议 `base_url`，留待人工确认租户真实路径 |

三轮实测暴露并修复的缺陷：

1. **隐藏空态模板行导致假空态**：首轮 10 个源全部判 `empty_verified`，包括实有 16 条的 Aurora。BidNet 模板在真实行上方常驻 `<tr class="mets-table-row-empty" aria-hidden="true">There are no open bids…</tr>`。修复：Python 与 sidecar 都只读可见文本（排除 `aria-hidden` / `hidden` / `display:none`），且空态判定放在解析之后（sidecar 与适配器都解析出 0 行才看文案）。
2. **sidecar 行分组按完整 class 分组**：`tr.mets-table-row.odd` 胜出，只取到一半行（8/16）。修复：分组签名排除 `odd/even/first/last` 等表现类；标题启发式只在链接文本是编号（如 `IL-BIDBUY-2026-001`）时才改用"描述"列，否则以链接文本为标题。
3. **robots.txt 全部 `unreachable`**：BidNet 的 WAF 对 Node `fetch` 一律 403（换浏览器 UA 也无效），Python `requests` 正常 200。修复：新增 crawler 子命令 `fetch-robots`，前置检查与 `source:compliance:scan` 默认经 crawler 抓取 robots（`--node-fetch` 可退回）。

### 批准与运行

- 6 个源通过 `PATCH /api/admin/data-sources/<id>` 一次写入：`approvalStatus=approved`、`legalReviewStatus=approved_public`、`approvedForIngestion=true`、`isEnabled=true`、`tosReviewed=true`、`tosUrl=https://www.bidnetdirect.com/tsandcs`、`complianceReviewer`（管理员邮箱）、`complianceReviewDueAt`（+12 个月）、`complianceNotes`/`approvalNotes`。
- 台账记录的证据是：robots.txt 经 crawler 客户端取得，`/<租户>/solicitations/*` 未被 `Disallow`（禁止范围限于 `/private/`、注册、认证与服务流）；前置检查确实到达该租户自己的页面；条款文档位于 `https://www.bidnetdirect.com/tsandcs`（首次填入的 `/public/terms-of-use` 是臆造链接，实测 404，已更正），其内容面向**注册会员**（注册、费用、账号口令、会员义务），而 APSi 不注册账号、不提交任何凭证，只读取公开的招标列表。到 `compliance_review_due_at` 需由人重新通读条款并更新台账。
- 5 个重复占位州源（`cal_eprocure`、`illinois_procurement_bulletin`、`myfloridamarketplace`、`new_york_state_contract_reporter`、`texas_smartbuy`）标记 `approvalStatus=blocked` 并保持禁用。
- `POST /api/crawler/state/run` 运行 6 个批准源（`limit=25`）：

| 源 | 结果 | 入库 | 列表解析 |
| --- | --- | --- | --- |
| Aurora | success | 16 新增 | scrapling |
| Denver | success | 6 新增 / 1 更新 | scrapling |
| Jefferson | success | 3 新增 / 1 更新 | scrapling |
| Washtenaw | success | 7 新增 / 1 更新 | scrapling |
| Boulder | success（零条，`metadata.emptyState.verified=true`） | 0 | scrapling |
| Erie | success（零条，已验证空态） | 0 | scrapling |

6 个源 `consecutive_failures=0`、`last_success_at` 已写入、`last_failure_at` 为空；本批无平台限流，未触发 `deferred`。

## 待确认（2026-09-16 决定先遗留）

`bidnet_oh_city_columbus`、`bidnet_oh_cuyahoga`、`bidnet_oh_franklin`、`bidnet_wy_laramie` 四个租户的 `base_url` 返回 404，`discover-tenant` 依次探测 `/ohio/<slug>/…`、`/<slug>/…` 及 slug 变体共 6 个候选，全部 404，因此**没有**建议路径可写回。它们保持未批准（治理拦截）状态，`live_health_disposition = needs_fix`，不参与调度也不会污染源健康度。

**2026-09-21 结案**：`discover-sources` 全量扫过平台目录（2,036 家机构）后给出了答案——目录里根本没有 Cuyahoga County、City of Columbus、Laramie County；俄亥俄唯一的 "Franklin" 条目是 Franklin County Children Services，那是另一个采购主体，不能把旧行指过去。四行已全部标记 `blocked`、禁用并取消入库批准，`approval_notes` 写明依据与证据文件，`source_approval_events` 留有 `approved → blocked` 的审计记录。复跑手动运行确认四者均被拦下（返回 `disabled`），不再累积失败。

若这些单位将来重新上线 BidNet，正确做法仍是先用 `discover-sources` 查目录拿到真实租户路径，再重跑前置检查与批准表单，而不是手工猜 `base_url`。
