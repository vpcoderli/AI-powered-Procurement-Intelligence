# 县/市级数据源"治理拦截"的修复可行性（2026-09-16，待确认）

## 1. "治理拦截"到底是什么

管理端批量运行面板的 `batchRunStatus_blocked` 文案就是"治理拦截"。它来自 `orchestrator.ts` 的 `blockedReasonFor()`，在**任何一次抓取开始前**检查 `data_sources` 的治理列，命中即返回 `status: "blocked"`，Python 根本不会启动：

| 触发条件 | 提示 | 本地命中的源 |
| --- | --- | --- |
| `jurisdiction_level ∉ {federal, state}` 且 `approval_status ≠ 'approved'` | Local source governance requires explicit approval before ingestion | 10 个 BidNet 县/市源（`approval_status IS NULL`） |
| `approved_for_ingestion = 0` 或 `approval_status ∈ {needs_review, blocked}` | Source governance has not approved ingestion | 0 |
| `legal_review_status ∉ {approved_public, approved}`（且非空） | Source legal review has not approved ingestion | 0 |

这不是抓取失败，而是产品在 2026-07-29 数据源注册表设计里**有意设置的合规门禁**：州/联邦源沿用历史兼容规则，县/市级批量注册源必须由人显式批准并在合规台账（`docs/operations/data-source-compliance-ledger.md`）留痕。2026-09-15 加固后，手动运行入口和定时入口执行同一门禁，所以这些源现在在任何入口都显示"治理拦截"（此前手动入口曾绕过门禁，因此 8 月能跑出结果）。

另有 5 个 `is_enabled = 0` 的州级占位源（`cal_eprocure`、`illinois_procurement_bulletin`、`myfloridamarketplace`、`new_york_state_contract_reporter`、`texas_smartbuy`）显示的是"已禁用"，与治理无关，它们是与正式州源重复的早期占位行。

## 2. 被拦截源的现状（本地 MySQL，2026-09-16 实测）

| 源 | 8 月历史 | 今日探测 | 判断 |
| --- | --- | --- | --- |
| `bidnet_co_city_aurora`、`bidnet_co_denver`、`bidnet_co_jefferson`、`bidnet_mi_washtenaw` | 各 4 次成功（6–7 条/次），已入库 26 条县市招标 | — | 技术上可用，只差审批 |
| `bidnet_co_boulder`、`bidnet_ny_erie` | 6 次 `CoBidnetError: page did not contain open solicitations` | HTTP 200，服务端渲染 60 KB，页面明确写着 "There are no open bids at this time" | **误判失败**：合法空结果被当成解析失败 |
| `bidnet_oh_city_columbus`、`bidnet_oh_cuyahoga`、`bidnet_oh_franklin`、`bidnet_wy_laramie` | 404 | 仍 404 | `base_url` 租户路径过期/错误 |
| 全部 10 个 | 8 月 21 日 05:38 集中 403 | robots.txt 允许 `/…/solicitations/*` 公共页，只禁 `/private/`、注册/认证/服务流 | AWS WAF 对同平台密集请求的限流；需跨源节流 |

关键事实：BidNet Direct 的县市列表页**至今是服务端渲染**（HTML 内含租户名、空态文案、有招标时含 `mets-table-row` 行），不是 SPA。

## 3. Scrapling 能做什么、不能做什么

- **不能**：治理门禁是策略层，Scrapling（或任何抓取/解析手段）都不应也不能绕过。批准必须由管理员操作并写入合规台账。
- **能**：批准之后的技术可达性问题里，"解析脆弱"这一类正好是 Scrapling 的强项——当前 BidNet 适配器用正则匹配 `mets-table-row`，任何改版都会变成"未包含招标"的失败。把列表解析交给 sidecar（自适应选择器 + 每源 CSS/XPath），可以显著降低改版脆弱性。
- **条件可行**：若某租户将来改为 XHR 加载列表，Scrapling 解析器拿到的静态 HTML 里没有行；这时需要先用已有的 `browser-downloader`（Playwright）渲染页面再交给 Scrapling 解析。今天 BidNet 不需要这一步。

## 4. 方案（三层，可分期）

### 4.1 治理层：县/市源"审批前置检查 + 批准"工作流（人工决策，工具辅助）

- 扩展 `source:compliance:scan` 覆盖 `data_sources` 中所有启用的县/市源（现只扫州源定义），把 `robots_txt_status` 写回台账。
- 新增"审批前置检查"（admin API + 面板按钮）：对单个源做 **dry-run** 抓取（复用 `fetch-task` 契约，`limit=5`，不入库），返回 HTTP 状态、是否 WAF 挑战、解析到的条数或空态标记、robots 结论；结果写入 `approval_notes` / `live_health_*`。
- 批准仍走现有 `PATCH /api/admin/data-sources/[id]`（admin 角色），一次写入 `approval_status=approved`、`legal_review_status=approved_public`、`approved_for_ingestion=true`、`tos_reviewed`、`compliance_reviewer`、`compliance_review_due_at`，并落 `source_approval_events`。面板上把这几项做成一个"批准县/市源"表单，前置检查未通过时给出原因但不阻止（合规判断权在人）。
- 5 个禁用占位州源：标记 `approval_status='blocked'` + 备注"duplicate placeholder"，或直接删除；不再出现在批量运行面板。

### 4.2 crawler 层：修复批准后仍会失败的三类技术问题

1. **合法空结果**：`co_bidnet` 识别空态文案（"There are no open bids at this time" 及租户名存在）→ 返回空列表并带 `metadata.emptyState = {verified: true, marker: "…"}`；`_require_non_empty_bids` 对带有已验证空态的结果放行；Node 侧 `validateCrawlerImport` 接受 `emptyState.verified === true` 的零条成功（与 `dateFilter` 同一处理），健康回写为成功，不降级。
2. **租户路径 404**：新增 `discover-tenant` 探测（`validate-state-live` 风格，只读）：按 `/<state>/<slug>/…`、`/<slug>/…` 等候选路径试探并用标题中的租户名确认，输出建议 `base_url`；由管理员在 Crawler config 面板确认写回（不自动改）。
3. **平台级节流**：`co_bidnet` 已有进程内 3 秒间隔；增加 `data_sources.fetch_config.platform_throttle` 或调度器层"同 `provider_family` 的源在一批内串行 + 最小间隔 N 秒 + 遇 202/403 立即停止本批同平台后续源"，避免 8 月那种集中 403。

### 4.3 Scrapling 层：列表解析回退（sidecar 扩展）

- `services/scrapling-extractor` 新增 `POST /extract-list {url, html, item_selector?, fields: {title, url, published_date, deadline_date, source_bid_id}, selectors?, auto_save: true}`，返回 `items[]` + 每字段诊断（`selector | heuristic | not_found`），复用现有请求体上限与校验。
- crawler 侧 `fetch-task`：专用适配器解析到 0 条且非已验证空态时，若 `fetch_config.list_extraction.enabled`，把同一份 HTML 交给 sidecar 解析；成功则用解析结果并在 `metadata.listExtraction` 记录 `method: "scrapling"`，失败仍按原错误上报。**不额外发请求**，不改变礼貌策略。
- 每源可配置 `list_selectors`（与 `detail_selectors` 同一套管理面板风格）。
- 可选二期：`browser-downloader` 增加 `POST /render {page_url, wait_for, allowed_hosts}` 返回渲染后 HTML，用于将来改成 XHR 的租户；沿用其登录墙/跨主机/超时守卫。

## 5. 预期效果与验证

- 4 个技术上已可用的县市源：前置检查通过 → 管理员批准 → 下一轮调度即恢复入库（历史 26 条继续更新）。
- Boulder、Erie：批准后不再"失败"，以"已验证空结果"成功落日志，健康不降级。
- 4 个 404 租户：探测到正确路径后由管理员改 `base_url`，再批准。
- 验证：pytest（空态识别、路径探测、Scrapling 回退），vitest（`validateCrawlerImport` 空态分支、审批 API 字段、面板），离线 fixture 用今日保存的 Boulder/Erie 页面；真机对每个县市源做一次 `limit=5` 的 dry-run（遵守 3 秒平台间隔）。

## 6. 需要确认的决策

1. 治理层：做"审批前置检查 + 一键批准表单"（推荐），还是只用现有 PATCH 接口手工批准？合规复核人（`compliance_reviewer`）由谁填写？
2. 已验证的空态页面按"零条成功"处理、不降级健康——确认？
3. Scrapling 列表解析作为**回退**（专用解析失败时才用，推荐）还是所有源的主路径？
4. 是否本期就做 `browser-downloader` 的 `/render` 端点（BidNet 今天不需要，属于前瞻）？
5. 4 个 404 租户：自动探测后由管理员确认写回（推荐），还是允许探测结果自动写入 `base_url`？
6. 5 个禁用的重复占位州源：标记 `blocked` 保留，还是删除？
