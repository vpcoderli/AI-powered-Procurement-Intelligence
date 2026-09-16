# 附件异常自动修复：原因分析与设计（2026-09-16，已确认）

## 1. 现状测量（本地 MySQL `winbids`，2026-09-16）

| 指标 | 数值 |
| --- | --- |
| `bid_attachments` 行数 / 涉及招标 | 464 / 229 |
| `archived`（有 storage_path / byte_size / checksum） | 150（MS 125、MO 24、ME 1） |
| `not_archived` | 314（其中 258 条是公开 https 链接，56 条是 seed/demo 的站内相对链接） |
| `failed` / `unavailable` | 0（因为从未有人尝试过） |
| 已归档文件磁盘存在 / 抽样 20 条 checksum / 抽样 40 条魔数与 content_type | 150/150 存在、0 不一致、0 不一致 |
| 已归档 `storage_path` | 全部是宿主机绝对路径 `/Users/sakya/.../frontend/data/attachments/...` |
| `bids.detail_archive_status` | 3565 条全部 `not_archived` |

用户侧表现：点开 314 条未归档附件时，下载到的是一份 `*-download-note.txt` 说明文件，不是文档（`api/bids/[id]/attachments/[attachmentId]/route.ts` 的 `source_download_note` 分支）；一旦部署到容器或换机器，150 条"已归档"因绝对路径失效，会退化为 `archive_missing` 说明文件。

## 2. 根因

### R1 生产采集路径没有归档阶段（主因，占 68%）

`fetch-task` JSON 契约只输出附件**链接**；归档（`storage/archive.py` 的 `archive_bid_documents`）只挂在已退役的 `import-fixture` 和 `fetch-sam-gov --archive-documents` 两条命令上。Scrapling 详情补全新发现的附件同样只有链接。因此除 SAM.gov 和历史遗留的 MS/MO/ME 外，所有州源附件永远停留在 `not_archived`。

### R2 没有校验与修复闭环

没有任何任务会：重试 `failed`、复核 `archived` 文件是否还在 / checksum 是否一致 / 内容是否真的是文档、或对新出现的 `not_archived` 主动下载。`risk:check` 的 `state-data-quality` 只在门禁时**报告** P0（`attachment_archive_invalid` / `attachment_missing_or_failed`），不修。

### R3 归档写入器本身的质量缺陷（`crawler/apsi_crawler/storage/archive.py`）

1. **不校验内容**：只要 HTTP 200 且非空就记 `archived`。门户返回的登录页 / 错误页 HTML 会被以 `.pdf` / `.docx` 扩展名落盘，`content_type=text/html`，这正是"附件内容异常"的直接来源。实测：Illinois BidBuy 的 `bidDetail.sdo?downloadFileNbr=…` 不带会话直接 GET 返回 83 KB 的 `ERROR IN … session` HTML（先访问详情页再带 cookie 下载也一样，说明它是表单/JS 驱动的会话下载，不是可直接 GET 的链接）；Missouri 的直链 PDF 正常。
2. **绝对路径**：`storage_path` 写宿主机绝对路径，跨机器/容器全部失效（读取侧其实支持相对路径，`relativeAttachmentPath` 会剥掉 `data/attachments/` 前缀）。
3. **URL 黑名单用子串匹配**（`auth`、`sso`、`login`…）：`…/authority/…`、`…/associations/…` 这类正常 URL 会被误判 `unavailable`。
4. UA 与 crawler 浏览器 UA 不一致、无 Referer、无大小上限、无每源节流、不检查重定向是否落到登录页。
5. `content_type` 直接信任响应头，不与魔数比对。

### R4 数据模型缺字段

`bid_attachments` 没有 `verified_at`、`repair_attempts`、`next_repair_at`、`failure_kind`，无法做退避重试、防止对同一个坏链接每小时打一次门户、也无法观测修复进度。

## 3. 目标

- 所有公开 http(s) 附件在发现后 ≤ 1 个调度周期内被归档为**经内容校验**的本地/对象存储文件；无法归档的给出**准确、稳定**的原因，不反复打门户。
- 已归档文件定期复核（存在、checksum、魔数），损坏即重下。
- 修复过程可观测（`crawler_logs`）、可配置（每源）、可在容器 worker 中运行，SQLite 与 MySQL 双实现。
- 边界：不登录、不输入凭证、不绕过 WAF/验证码。交互式（表单/JS 驱动）下载允许用 headless 浏览器在公开页面上点击下载（用户 2026-09-16 决策），实现为独立 sidecar，不进入 app / worker 镜像。

## 4. 方案

### 4.1 异常分类（`frontend/src/server/attachments/anomaly.ts`，纯函数，双方言共用）

| 类别 | 判定 | 处理 |
| --- | --- | --- |
| `never_archived` | `archive_status='not_archived'` 且 `original_url ?? url` 是公开 http(s) | 下载 |
| `archive_failed` | `archive_status='failed'` 且 `next_repair_at <= now` | 按退避重试 |
| `archive_missing` | `archived` 但文件不在任何允许根目录 | 重下 |
| `archive_corrupt` | 文件存在但 0 字节 / checksum 不一致 / 魔数与 `content_type` 不符 / `content_type` 为 `text/html` 而扩展名不是 `.html` | 重下；若重下仍是 HTML → `unavailable` |
| `path_not_portable` | `archived`，绝对路径但同一相对路径在允许根目录下能解析且 checksum 一致 | 只改元数据：`storage_path` 改为相对路径 |
| `unavailable` | URL 非 http(s)、站内相对链接、源策略 `archive=false`、或重试耗尽 | 记录原因，不再重试（30 天后重新入队一次） |

### 4.2 下载执行放在 Python（新增 CLI 子命令 `archive-attachments`）

理由：所有对外 HTTP 请求都应走 crawler 既有的礼貌策略（浏览器 UA、每源节流、超时），和 `fetch-task` 保持同一契约风格（stdin JSON → stdout JSON），复用并加固 `archive.py`。Node 侧负责选取、锁、写库。

加固 `archive.py`：
- 内容校验：魔数白名单（`%PDF`、`PK\x03\x04`（docx/xlsx/zip）、`\xD0\xCF\x11\xE0`（doc/xls）、纯文本/CSV 放行），响应 `Content-Type: text/html` 或魔数判为 HTML 时返回 `failed_html_response`（不落盘）。
- 重定向最终 URL 复用 `enrichment.detect_off_target_redirect` 与 `content_quality.is_login_html` 的登录页判定。
- 相对 `storage_path`（相对归档根，如 `illinois_bidbuy/il_bidbuy_27-444/att_<id>.pdf`），文件名用附件 id 而不是序号，避免重跑覆盖错位。
- 黑名单改为路径段精确匹配；请求头与 `html/public_page.py` 同一套 `BROWSER_REQUEST_HEADERS` + `Referer = bid.source_url`；大小上限默认 50 MB（流式读取，超限中止）；每源 `min_interval_seconds` 默认 3。
- 输出：`{id, archive_status, storage_path, byte_size, content_type(sniffed), checksum_sha256, archive_error, failure_kind}`，`failure_kind ∈ {network, http_4xx, http_5xx, html_response, login_wall, too_large, unsupported_type, unavailable}`。

### 4.3 修复 worker（Node，`frontend/scripts/attachment-repair-worker.ts`）

- `npm run worker:attachments`（循环，默认 6 h）、`--once`、`--check`；加入 `workers:check`；容器 worker 镜像可用命令覆盖运行；compose `workers` profile 增加 `attachment-worker`。
- 每轮：(1) 本地复核阶段：对 `archived` 且 `verified_at` 超过 7 天的行做文件存在 + checksum + 魔数校验，产出 `archive_missing` / `archive_corrupt` / `path_not_portable`；(2) 选取阶段：按源分组，每源最多 `max_per_run`（默认 50），优先 `never_archived` 再 `archive_failed`；(3) 对每个源获取 `crawler_locks` 租约 `attachment_repair:<source_id>`（复用 `orchestrator.ts` 的续租机制），spawn Python 执行；(4) 事务写回（`bid_attachments` 更新 + 一条 `crawler_logs`，source=`attachment_repair`，metadata=`{verified, repaired, failed, unavailable, skipped, byKind}`）。
- 退避：`next_repair_at = now + 1h × 2^attempts`，上限 7 天；`attempts ≥ 6` → `unavailable`（`failure_kind` 保留最后一次原因），30 天后允许再入队一次。`login_wall` / `html_response` 连续 2 次即判 `unavailable`（说明是站点机制，不是抖动）。
- 每源策略：`data_sources.fetch_config.attachments = {archive: true|false, mode: "direct"|"browser", max_per_run, min_interval_seconds, timeout_seconds, max_bytes, browser_link_selector}`，在现有 Crawler config 面板上增加一组字段（校验函数由 `src/server/attachments/policy.ts` 提供，`crawler-config.ts` 调用）。Illinois BidBuy 初始设为 `browser`（实测直接 GET 与带 cookie GET 都只返回 "ERROR IN … session" HTML，下载由 `javascript:downloadFile('<nbr>')` 提交 `bidDetail` 表单触发），SAM.gov 沿用现有 `--archive-documents`。

### 4.3b 交互式门户：headless 浏览器下载 sidecar（`services/browser-downloader`，用户决策）

- 独立 Python 3.12 + Playwright/Chromium 服务（官方 `mcr.microsoft.com/playwright/python` 镜像），HTTP 契约：`GET /health`；`POST /download {page_url, link: {href_contains|text|selector}, timeout_seconds, max_bytes, allowed_hosts}` → 成功返回二进制正文 + `X-Download-Filename / X-Download-Content-Type / X-Download-Final-Url / X-Download-Byte-Size`；失败返回 `{error: {code, message}}`，`code ∈ LOGIN_WALL | LINK_NOT_FOUND | TIMEOUT | TOO_LARGE | OFF_HOST | NAVIGATION_FAILED | BROWSER_ERROR | INVALID_REQUEST`。
- 行为：打开公开详情页 → 定位与附件匹配的链接/按钮（按 `href` 含附件号、链接文本等于附件名、或每源 `browser_link_selector`）→ 点击并等待 Playwright `download` 事件 → 读入内存（超过 `max_bytes` 中止）→ 返回。
- 边界：只访问公开页面，**不输入任何凭证、不过验证码、不绕过 WAF**；页面含密码输入框且标题/表单指向登录时返回 `LOGIN_WALL`；导航离开 `allowed_hosts` 即中止；单并发（进程内锁），浏览器 UA 与 crawler 相同；默认只监听 127.0.0.1，compose 内不发布宿主机端口，无认证故不得公网暴露。
- 由 Python `archive.py` 在 `mode=browser` 时调用（`BROWSER_DOWNLOADER_URL`），下载结果走与直连完全相同的魔数校验、相对路径落盘、checksum 流程；sidecar 不可达时 `failure_kind=browser_unavailable`，按退避重试。

### 4.4 数据模型（追加列，两种方言）

`bid_attachments`：`verified_at TEXT`、`repair_attempts INTEGER NOT NULL DEFAULT 0`、`next_repair_at TEXT`、`failure_kind TEXT`；索引 `(archive_status, next_repair_at)`。放进 `migrate.ts` 的 `addXColumn` 和 MySQL 派生路径（索引需进第一段 `sqlite.exec` 块）。

### 4.5 读取侧配合

- `bids/attachments.ts` 与 `state-data-quality.ts` 已支持相对路径，不改逻辑；`allowedAttachmentDirs` 增加对象存储本地根。
- 详情页附件徽标复用现有 `archiveStatus`；新增 `unavailable` 文案（en/zh）："门户要求交互式下载，请使用原始链接"。

### 4.6 历史数据一次性修正（由 worker 首轮自动完成，不写脚本）

- 150 条绝对路径 → `path_not_portable` → 改为相对路径。
- 258 条公开链接进入 `never_archived` 队列，按源限流逐轮归档（IL 83 条走 `browser` 模式，需 browser-downloader 在线；离线时按 `browser_unavailable` 退避）。
- 56 条 seed/demo 站内链接 → `unavailable(seed)`，不打网络。

## 5. 验证计划

- Python：`archive.py` 单测（魔数校验、HTML 拒收、相对路径、黑名单精确匹配、大小上限、`failure_kind`）、`archive-attachments` CLI 契约测试、stdout 纯 JSON。
- Node：分类器纯函数测试；worker 选取/退避/租约/事务在 SQLite 临时库与 MySQL 假池上的测试；`mysql-route-coverage` 等结构测试；`--check`。
- 集成：扩展 `enrichment-pipeline.integration.test.ts`——离线 HTTP 服务提供一个真 PDF 和一个 HTML 错误页，验证前者归档、后者判 `html_response` 且不落盘；真实 MySQL 事务回滚。
- 真机：对 MO 直链与 MS `PHIOGET` 链接各 ≤ 5 条做一轮实测（遵守 3 s 间隔）。

## 6. 决策记录（2026-09-16 用户确认）

1. 下载在 Python 执行（`archive-attachments` CLI 子命令），统一 crawler 礼貌策略。
2. 存储沿用 `data/attachments` 本地根 + 相对路径；S3 后续通过 object-storage 抽象接入。
3. Illinois 这类会话/表单驱动的下载：**做 headless 浏览器自动化**（独立 `services/browser-downloader` sidecar，只点公开页面上的下载控件，不登录、不过验证码）。
4. 默认参数：6 h 周期、每源每轮 50 条、3 s 间隔、50 MB 上限、退避 1h×2ⁿ 至 7 天、6 次后放弃、7 天复核一次。
5. 独立 worker 进程（`worker:attachments`）。

实施计划：`docs/superpowers/plans/2026-09-16-attachment-repair.md`。
