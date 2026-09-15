# Scrapling 详情补全 Sidecar 设计

Date: 2026-09-15
Status: approved (decisions confirmed with the user on 2026-09-15; awaiting written-spec review)

## 1. 需求

1. 现有爬虫抓到的招标信息不全。集成 [Scrapling](https://github.com/D4Vinci/Scrapling) 与当前系统互补，**现有逻辑不能出差**。
2. 在数据源配置中增加爬虫配置。
3. 整个流程可用无误，全面测试，数据都走 MySQL。

## 2. 现状证据（MySQL，2,510 条真实招标，2026-09-15）

| 字段 | 缺失 |
|---|---|
| description 缺失或等于 title | 2,109（84%） |
| original_category | 1,463（58%） |
| published_date | 618（25%） |
| 有附件记录的招标 | 152（6%） |
| deadline_date | 42（2%） |

根因是架构性的：41 个 spider 中只有 16 个二次请求详情页，25 个只解析列表页；19 个用标题充当描述，20 个固定输出空附件。列表页本身不携带描述、附件、联系人。**缺的是"详情页补全"这一阶段，不是列表抓取。**

## 3. 已确认的决策

| 决策 | 结论 |
|---|---|
| Scrapling 运行方式 | **A：Docker sidecar**，仅安装解析器基础包（`pip install scrapling`，不装 `fetchers` extra） |
| 使用范围 | **仅解析 + 详情补全**。抓取（列表页与详情页）继续走现有 `requests` 路径，沿用治理门禁、浏览器 UA、节流与 WAF 质询处理 |
| 明确排除 | `StealthyFetcher`、`DynamicFetcher`、`curl_cffi` TLS 指纹伪装、browserforge 指纹伪造、任何 Cloudflare/WAF 质询绕过。与治理红线（仅 approved_public 公开源、不绕过机器人校验）一致 |
| 补全字段（按顺序） | 描述正文 → 附件文档 → 分类/NAICS → 联系人 / 发布日期。一期全部实现 |
| 浏览器渲染 | 不在本期范围（二期议题） |

硬约束：Scrapling 要求 Python ≥ 3.10；系统 Python 是 3.9，CI 不跑 Python，生产镜像不含爬虫；Scrapling 依赖 lxml/orjson 等，与 crawler 包"仅 stdlib + requests"约束冲突。Sidecar 方案同时解决这两点：crawler 包零新依赖。

环境补充（2026-09-15 实测）：本机已有 Homebrew 7.0.1，已安装 `python@3.12`（3.12.14）。`pip install scrapling==0.4.15` 基础包只引入 `lxml 6.1.3` 与 `orjson 3.12.0`——**不含** curl_cffi / playwright / patchright / browserforge 等任何反检测组件；在真实 IL 详情页 fixture 上验证了 `Selector.css()`（含 `adaptive`）、`find_by_text()`、`find_similar()` 可用。因此 sidecar 同一份 `server.py` 支持两种运行方式：本地开发用 `python3.12 -m venv` 直接运行（无需 Docker），compose/部署用 Docker 镜像。

## 4. 架构

```
Next.js (state-runner.ts)
  └─ python3 -m apsi_crawler.cli fetch-task   ← stdin JSON，含 fetch_config
        ├─ adapter 抓列表页 → 归一化记录            （现有，不变）
        ├─ _require_non_empty_bids                 （现有，不变）
        ├─ 【新增】enrichment 阶段（fetch_config.enrichment.enabled 时）
        │     对每条记录：requests 拉详情页（browser UA，按源节流）
        │       → POST http://scrapling-extractor:8091/extract {html,url,fields,selectors}
        │       → 仅回填空值：description / full_description / attachments /
        │         original_category / contact_* / published_date；打 detail_fetched_at
        │     单条失败跳过；sidecar 不可达则整段跳过；永不使运行失败（fail-open）
        ├─ apply_date_window                       （现有，不变）
        └─ stdout JSON：metadata.enrichment = {attempted, enriched, failed, skipped, reason}
Next.js persistCrawlTaskResult → sqlite-json-importer / mysql-json-importer（现有双路径）
        └─ 【修改】补全保护式 upsert：空值/等于标题的 description 不覆盖已有更丰富值
```

不新增数据表。`bids` 已有 `full_description`、`original_category`、`contact_name/email/phone`、`published_date`、`detail_fetched_at`；附件走现有 `bid_attachments`。补全统计写入 `crawler_logs.metadata`。

### 4.1 组件

| 组件 | 位置 | 职责 | 依赖 |
|---|---|---|---|
| `scrapling-extractor` sidecar | `services/scrapling-extractor/`（新目录）：`Dockerfile`（python:3.11-slim）、`server.py`、`extractors.py`、`tests/` | 无状态 HTTP 服务：接收 HTML，返回结构化字段 | `scrapling==0.4.15`（PyPI 当前版本，基础包，requires-python ≥3.10）+ Python stdlib `http.server`。**不装** fetchers extra |
| `apsi_crawler/enrichment.py` | crawler（新模块） | 读取 `fetch_config.enrichment`，拉详情页，调用 sidecar，回填记录，产出统计 | stdlib + `requests`（沿用 `html/public_page.py` 的 `BROWSER_REQUEST_HEADERS`） |
| `apsi_crawler/cli.py` | crawler（修改 `fetch_task`） | 在 liveness 检查与日期窗口之间调用 enrichment | — |
| importer 双实现 | `frontend/src/server/crawler/sqlite-json-importer.ts`、`mysql-json-importer.ts`（修改） | 补全保护式 upsert | — |
| 管理端爬虫配置 | `frontend/src/server/admin/data-sources-repository.ts`（`updateAdminDataSource` / `updateAdminDataSourceFromMysql`）、`src/app/api/admin/data-sources/[id]/route.ts`、`src/app/admin/page.tsx`、i18n 字典 | 让 `fetch_config`、`cadence`、`base_url` 可编辑并审计 | — |
| 编排 | `docker-compose.yml`（新增 service）、`frontend/.env.local` 的 `SCRAPLING_EXTRACTOR_URL` | 本地/演示拓扑 | Docker |

### 4.2 Sidecar HTTP 契约

- `GET /health` → `{"ok": true, "scrapling": "<version>"}`
- `POST /extract`
  - 请求：`{"url": str, "html": str, "fields": ["description","attachments","category","contact","published_date"], "selectors": {field: css-or-xpath} | null}`
  - 响应：`{"fields": {"description": str|null, "full_description": str|null, "original_category": str|null, "contact_name": str|null, "contact_email": str|null, "contact_phone": str|null, "published_date": str|null}, "attachments": [{"name": str, "url": str|null, "raw_href": str, "size_label": str|null, "mime_type": str|null, "sort_order": int}], "diagnostics": {field: "selector"|"heuristic"|"not_found"}}`
  - 附件 `url` 只在 `raw_href` 能解析为绝对 http(s) 地址时给出；`javascript:` 等非 http 链接（实测 IL BidBuy 为 `javascript:downloadFile('1703214')`）保留 `raw_href`、`url` 为 null，由 crawler 侧按源配置的 `attachment_url_template` 解析（见 4.3），无模板则不导入该附件并计入 diagnostics——**绝不伪造下载地址**。
  - 错误：非 200 + `{"error": {"code": "INVALID_REQUEST"|"EXTRACT_FAILED", "message": str}}`
- 抽取策略：显式 `selectors` 优先（Scrapling `Selector` 的 `adaptive=True` + `auto_save=True`，网站改版后自动重定位；自适应存储挂载在 compose volume `scrapling-data:/data/scrapling`）；无选择器时走启发式：描述取"Description/Summary/Scope"标签相邻或页面最大正文块（剔除导航/页脚），附件取文档后缀链接（pdf/doc/docx/xls/xlsx/zip）与"Attachments/Documents"容器内链接，分类取"Category/Commodity/NAICS/UNSPSC"标签相邻值，联系人取 `mailto:`/`tel:` 与"Contact"标签相邻文本，发布日期取"Posted/Published/Issue Date"标签相邻值。
- 限制：HTML 上限 2 MB；单请求超时 10 s；返回文本截断 20,000 字符。

### 4.3 `fetch_config.enrichment` 配置结构

```json
{
  "base_url": "https://...",
  "enrichment": {
    "enabled": false,
    "fields": ["description", "attachments", "category", "contact", "published_date"],
    "max_details_per_run": 25,
    "min_interval_seconds": 3,
    "timeout_seconds": 20,
    "detail_selectors": { "description": "div.bid-body", "attachments": "//a[contains(@href,'.pdf')]" },
    "attachment_url_template": "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?downloadFileNbr={id}&docId={source_bid_id}&currentPage=1&mode=download&parentUrl=close"
  }
}
```

- `attachment_url_template` 可选：当 sidecar 返回的附件 `url` 为 null 时，crawler 用 `raw_href` 中的第一个数字串作为 `{id}`、记录的 `source_bid_id` 作为 `{source_bid_id}` 填充模板；模板必须是绝对 http(s) 地址。IL BidBuy 的现有蜘蛛已内置同样的拼接规则，该配置让其它门户无需改代码即可复用。

- `enabled` 默认 `false`：未显式开启的源行为与今天完全一致（"现有逻辑不能出差"的第一道保证）。
- `max_details_per_run` 默认 25（与默认抓取 limit 一致，一次运行内全部补全）。
- `min_interval_seconds` 沿用 BidNet 节流思路，按源生效；BidNet 家族仍叠加其自身 3 秒间隔。
- `detail_selectors` 可选，键为字段名。
- 服务端校验：字段名白名单、数值范围（1–200 / 0–60 / 5–60）、选择器为非空字符串、整体 JSON ≤ 8 KB。

### 4.4 Enrichment 阶段行为（`apsi_crawler/enrichment.py`）

1. 读取 `fetch_config.enrichment`；未开启或 `SCRAPLING_EXTRACTOR_URL` 未设置 → 返回原记录，`metadata.enrichment = {"skipped": n, "reason": "disabled"|"extractor_not_configured"}`。
2. 先 `GET /health`（3 s 超时）；失败 → 整段跳过，`reason: "extractor_unavailable"`。
3. 记录未带 `source_url`、或 `source_url` 与列表页同址、或已含真实描述且 fields 全满 → 跳过（`skipped`）。
4. 逐条：节流 → `requests.get(source_url, headers=BROWSER_REQUEST_HEADERS, timeout)`；非 200 / 非 HTML / 超 2 MB → `failed` 计数并继续。
5. 调用 `/extract`；**只填空值**：`description` 仅当当前为空或等于 `title`；`full_description`、`original_category`、`contact_*`、`published_date` 仅当为空；`attachments` 仅当当前为空列表。写入 `detail_fetched_at=now_iso()`、`raw_payload["enrichment"]={"fields": diagnostics}`。
6. 任何异常都被捕获为 `failed`，绝不抛到 `fetch_task`。
7. 统计：`{"attempted", "enriched", "failed", "skipped", "reason", "extractor": "<version>"}`。

### 4.5 补全保护式 upsert（两种方言）

现有 importer 在 `ON DUPLICATE KEY UPDATE`（MySQL）/ `onConflictDoUpdate`（SQLite Drizzle）中无条件覆盖 `description` 等列。补全开启后若某次运行因 `max_details_per_run` 或详情页失败而回落为列表页数据，会把已补全的描述覆盖回标题。规则：

- `description`：仅当传入值非空且 ≠ 传入 `title` 时覆盖，否则保留现值。
- `full_description`、`original_category`、`contact_name/email/phone`、`published_date`、`detail_fetched_at`：仅当传入值非空时覆盖（`COALESCE(NULLIF(VALUES(col),''), col)` / Drizzle `sql` 等价写法）。
- `bid_attachments`：仅当传入附件列表非空时替换该 bid 的附件集（现有 delete + re-insert 逻辑保留）；传入空列表时**跳过**删除步骤，已有附件保持不变——这是对现有"空列表也清空"行为的唯一改变。
- 其余列（title、deadline、状态、last_seen_at 等）保持现有覆盖语义。

### 4.6 管理端"爬虫配置"

- `UpdateAdminDataSourceInput` 新增 `fetchConfig?: Record<string, unknown>`、`cadence?: "hourly"|"daily"|"weekly"|"manual"`、`baseUrl?: string | null`；`updateAdminDataSource` 与 `updateAdminDataSourceFromMysql` 同步实现；写入前用 4.3 的规则校验；写审计事件 `data_source.crawler_config_updated`（含 actorUserId、变更前后 JSON），走现有 `writeAuditEvent` / `writeAuditEventFromMysql`（`src/server/events/event-log.ts`）。
- PATCH 路由 `parsePatchBody` 扩展；非法 → 400 `{error:{code:"INVALID_CRAWLER_CONFIG"}}`。`baseUrl` 变更同步写 `fetch_config.base_url`。
- 管理端数据源表每行新增"爬虫配置"展开面板：补全开关、字段多选、每次上限、最小间隔、超时、选择器（高级：按字段的文本框）、cadence 下拉、base_url 输入；保存后刷新该行；所有文案进 en/zh 字典（`i18n:check`）。
- 不新增 API 路由，四个结构覆盖测试注册表不变。

### 4.7 编排与环境

- `docker-compose.yml` 新增：
  - `scrapling-extractor`：`build: ./services/scrapling-extractor`，`ports: "8091:8091"`，`volumes: scrapling-data:/data/scrapling`，`healthcheck: GET /health`，`restart: unless-stopped`。
  - `app` 增加 `environment: SCRAPLING_EXTRACTOR_URL: http://scrapling-extractor:8091` 与 `depends_on`（`condition: service_healthy`）。
- 本地开发：`frontend/.env.local` 设 `SCRAPLING_EXTRACTOR_URL=http://localhost:8091`。起 sidecar 二选一：`docker compose up scrapling-extractor`，或本机 venv（`services/scrapling-extractor/` 提供 `requirements.txt` 与 `run-local.sh`：`python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python server.py`）。state-runner 以 `env: process.env` 启动子进程，变量自然透传到 Python。
- Sidecar 的 pytest 在本机 venv 下直接可跑（不再只能在容器里跑）。
- 文档：`docs/transferability/environment-variables.md`、`CLAUDE.md` 爬虫小节、README 功能列表同步。

## 5. 错误处理与安全边界

- Sidecar 不可达、超时、5xx：跳过补全，运行仍 success；metadata 记录原因。
- 详情页 403 / WAF 202：按现有分类（BidNet 202 走 `BidNetChallengeError` 语义，此处仅计 `failed`），不重试、不绕过。
- 详情页 HTML 只在内存中传给 sidecar，不落盘；sidecar 只监听 compose 内网/本机端口，无认证需求（一期，本地/演示拓扑；生产拓扑在 AWS runbook 中作为私有服务部署）。
- 与治理一致：只对 `approved_for_ingestion` 且 `legal_review` 通过的源执行（enrichment 处于 orchestrator 治理门禁之后）。

## 6. 测试

- **Sidecar**（`services/scrapling-extractor/tests/`，pytest，需 scrapling 可导入，否则 skip）：健康检查；固定 3 个真实详情页 fixture（CA event、IL bidDetail、FL advertisement）各字段抽取——fixture 须在实施时从门户**现场抓取**并保留描述、分类、联系人、附件区块（现有 `il_bidbuy_detail.html` 只裁剪了附件区，不能复用为完整样本）；选择器优先于启发式；`javascript:` 附件链接返回 `url: null` + `raw_href`；超大 HTML / 非法 JSON 返回 4xx。
- **Crawler**（`tests/test_enrichment.py`，离线）：禁用/未配置/不可达三种跳过路径；只填空值语义；节流函数；失败开放（sidecar 抛错、详情页 500、超时）；`fetch_task` 契约测试更新（`fetch_task_v1.json` 增加可选 `fetch_config.enrichment`；metadata 增加 `enrichment`）。
- **Importer**（TS）：SQLite 用 `createTestDatabase` 真实验证保护式 upsert；MySQL 断言生成的 SQL 含 `COALESCE(NULLIF(...))` 并用 fake pool 验证参数。
- **管理端**：PATCH 路由校验与双方言测试；`data-sources-repository` 双实现测试；`page.test.ts` 静态断言；`i18n:check`；`lint`、`build`、全量 `vitest`、全量 `pytest`。
- **MySQL 真实验证**（手动，纳入交付）：`docker compose up scrapling-extractor`；对 CA / IL / FL / NY / TX 五源开启补全并批量运行；用第 2 节 SQL 对比补全前后的字段完整率；抽查 10 条详情与门户页面一致；`npm run db:mysql:smoke`、`npm run risk:check` 通过。

## 7. 分阶段实施

1. Sidecar 服务 + compose + 契约测试。
2. Crawler enrichment 模块 + `fetch_task` 接入 + 契约/fixture 更新。
3. Importer 保护式 upsert（双方言）。
4. 管理端爬虫配置（API 双实现 + UI + i18n）。
5. MySQL 真实验证、基线对比、文档更新。

## 8. 范围外

- 浏览器渲染（纯 JS 门户）、任何反检测能力。
- 自适应选择器学习结果的跨环境同步。
- 对 SAM.gov 联邦源的补全（其 API 已返回完整字段）。
- 修改列表页 spider 的现有解析逻辑。
