# 县/市级数据源的治理拦截、前置检查与批准

背景、实测数据与设计取舍见[县/市级数据源"治理拦截"的修复可行性](../superpowers/specs/2026-09-16-local-source-governance-recovery-design.md)；采集与详情补全的上游链路见[爬虫与 Scrapling 逻辑梳理](../architecture/crawler-enrichment-flow.md)；附件归档见[附件归档与修复](./attachment-repair.md)。本文只讲：治理拦截是什么规则、批准前怎么检查、批准表单每一栏代表谁的责任、批准之后那些"看起来像失败"的结果各自是什么意思。

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

- 6 个源通过 `PATCH /api/admin/data-sources/<id>` 一次写入：`approvalStatus=approved`、`legalReviewStatus=approved_public`、`approvedForIngestion=true`、`isEnabled=true`、`tosReviewed=true`、`tosUrl`、`complianceReviewer`（管理员邮箱）、`complianceReviewDueAt`（+12 个月）、`complianceNotes`/`approvalNotes`（注明为集成运行时代为录入，ToS 阅读需人工确认）。
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
