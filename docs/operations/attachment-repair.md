# 附件归档与修复（attachment repair worker）运维

原因分析、实测基线与设计决策见[附件异常自动修复设计](../superpowers/specs/2026-09-16-attachment-repair-design.md)；采集与详情补全的上游链路见[爬虫与 Scrapling 逻辑梳理](../architecture/crawler-enrichment-flow.md)。本文只讲怎么跑、怎么配、怎么看结果。

目标：每条公开 http(s) 附件在发现后 ≤ 1 个调度周期内被归档成**经内容校验**的本地文件；坏归档能被发现并重下；归不了档的给出稳定原因并停止反复打门户。

## 组件

- `frontend/scripts/attachment-repair-worker.ts`（`npm run worker:attachments`）：调度与选取。每轮复核已归档文件、按源分组选取异常、取 `crawler_locks` 租约、调用 Python 执行下载、在一个事务里写回 `bid_attachments` 并追加一条 `crawler_logs`。SQLite / MySQL 双实现。
- `frontend/src/server/attachments/`：`policy.ts`（每源策略解析/校验）、`anomaly.ts`（异常分类与退避，纯函数）、`repository.ts` / `mysql-repository.ts`（候选选取与写回）、`repair-service.ts`（`runAttachmentRepairOnce`）。
- `crawler` 的 `python -m apsi_crawler.cli archive-attachments`：stdin JSON → stdout JSON，所有对外请求都走 crawler 既有的礼貌策略（浏览器 UA、`Referer`、每源节流、超时、流式下载与大小上限），并做魔数校验后落**相对路径**。
- `services/browser-downloader`：可选的无头浏览器 sidecar（Python 3.12 + Playwright/Chromium），只为 `mode=browser` 的门户在**公开详情页**上点击下载控件。
- 管理端 → 数据源 → 爬虫配置（`CrawlerConfigPanel`）的"附件归档"分组：按源开关、下载方式、每轮上限、间隔、超时、大小上限、浏览器链接选择器；落到 `data_sources.fetch_config.attachments`，经 `PATCH /api/admin/data-sources/[id]` 写入。
  - 注意与详情补全同一个坑：`ADMIN_UI_LOCAL_BYPASS=true` 只放行服务端 `/api/admin/*` 守卫，`/admin` 页面本身仍要求前端有已登录的 admin 会话。没有会话时直接调 API：`PATCH` **必须带完整的 `fetchConfig`**（服务端整体替换，不做合并），并带 `Origin: http://localhost:3000` 以通过 CSRF。

## 异常分类

分类在 `anomaly.ts` 里做，两种方言共用：

| 类别 | 判定 | 处理 |
| --- | --- | --- |
| `never_archived` | `archive_status='not_archived'` 且链接是公开 http(s) | 下载 |
| `archive_failed` | `archive_status='failed'` 且 `next_repair_at <= now` | 按退避重试 |
| `archive_missing` | 记为 `archived`，但文件不在任何允许根目录 | 重下 |
| `archive_corrupt` | 文件存在但 0 字节 / checksum 不一致 / 魔数与 `content_type` 不符 / 内容其实是 HTML | 重下；重下仍是 HTML → `unavailable` |
| `path_not_portable` | `archived`，`storage_path` 是绝对路径，但同一相对路径在允许根目录下可解析且 checksum 一致 | 只改元数据，把 `storage_path` 改写成相对路径（不发网络请求） |
| `unavailable` | 链接非 http(s) / 站内相对链接 / 源策略 `archive=false` / 重试耗尽 | 记录原因，停止重试，30 天后允许再入队一次 |

下载侧的失败原因（`bid_attachments.failure_kind`）：`network`、`timeout`、`http_4xx`、`http_5xx`、`html_response`、`login_wall`、`off_target`、`too_large`、`unsupported_type`、`unavailable`、`browser_unavailable`、`browser_error`、`link_not_found`。

**HTML 永远不落盘**：响应 `Content-Type: text/html` 或魔数判为 HTML 时记 `failed` + `html_response`（登录页则是 `login_wall`），不会再出现"扩展名是 .pdf、内容是登录页"的坏归档。

## 调度与默认参数

| 参数 | 默认值 | 来源 |
| --- | --- | --- |
| 运行周期 | 6 小时 | `ATTACHMENT_WORKER_INTERVAL_MS`（毫秒，默认 `21600000`） |
| 每源每轮条数 | 50 | 源策略 `attachments.max_per_run`；`ATTACHMENT_REPAIR_MAX_PER_SOURCE` 只能**向下**覆盖 |
| 请求间隔 | 3 秒 | 源策略 `attachments.min_interval_seconds` |
| 单文件上限 | 50 MB | 源策略 `attachments.max_bytes` |
| 下载超时 | 30 秒 | 源策略 `attachments.timeout_seconds` |
| 退避 | `1h × 2^attempts`，上限 7 天 | `anomaly.ts` |
| 放弃阈值 | 6 次后判 `unavailable`（30 天后再入队一次） | `anomaly.ts` |
| 连续 `login_wall` / `html_response` | 2 次即判 `unavailable`（属于站点机制，不是抖动） | `anomaly.ts` |
| 已归档文件复核间隔 | 7 天 | `repair-service.ts` |

每源用 `crawler_locks` 的 `attachment_repair:<source_id>` 租约，与 `crawler-worker` 的采集任务互不阻塞；已被别人持有的源本轮记 `locked` 并跳过。

## 每源策略

写在 `data_sources.fetch_config.attachments`：

```json
{
  "attachments": {
    "archive": true,
    "mode": "direct",
    "max_per_run": 50,
    "min_interval_seconds": 3,
    "timeout_seconds": 30,
    "max_bytes": 52428800,
    "browser_link_selector": null
  }
}
```

- `mode: "direct"` 是默认；只有当门户的下载由表单 / JavaScript 驱动（直连 GET 拿不到文件）时才改成 `"browser"`。Illinois BidBuy 是已知的 `browser` 源：不带会话直接 GET `bidDetail.sdo?downloadFileNbr=…` 只会返回 `ERROR IN … session` 的 HTML。
- `browser_link_selector` 只在 `browser` 模式生效，留空则按链接地址中的附件号或链接文本匹配下载控件。
- `archive: false` 的源不下载，候选直接记 `unavailable`。
- 面板范围与服务端校验一致：`max_per_run` 1–200、`min_interval_seconds` 0–60、`timeout_seconds` 5–120、大小上限 1–200 MB（面板按 MB 编辑，落库是字节）。越界由 `validateAttachmentPolicyInput` 拒绝，面板原样显示服务端的报错。

## 运行

```bash
cd frontend
npm run worker:attachments:check      # 环境预检，只打印解析结果，不连数据库
npm run attachments:repair:once       # 单次运行（等价于 ATTACHMENT_WORKER_RUN_ONCE=1）
npm run worker:attachments            # 常驻循环（6 h）
npm run workers:check                 # 三个原有 worker + 附件 worker 的预检
```

小范围试跑：

```bash
ATTACHMENT_REPAIR_MAX_PER_SOURCE=3 npm run attachments:repair:once
```

`--check` 会打印解析后的数据库方言、归档根目录、周期、每源上限、owner 和 sidecar 地址；生产/预发运行时（`NODE_ENV` / `APP_ENV` 等为 `production` / `prod` / `staging`）要求 `DATABASE_URL` 或 `MYSQL_DATABASE_URL` 是 `mysql://`，否则直接失败。未配置 `BROWSER_DOWNLOADER_URL` 时会给一条 warning（不是错误）：`browser` 模式的源会一直停在 `browser_unavailable` 并按退避重试。

归档根目录：`CRAWLER_ATTACHMENT_DIR` 的**第一项**是写入根，其余条目只作为可读根（读取侧 `allowedAttachmentDirs` 用）；未配置时是 `<cwd>/data/attachments`。落库的 `storage_path` 始终是相对这个根的相对路径，换机器 / 进容器不会失效。

## 观测

每轮写一条 `crawler_logs`，`source = 'attachment_repair'`：

| 列 | 含义 |
| --- | --- |
| `run_id` | 本轮 run id |
| `status` | `success` / `failure` |
| `fetched_count` | 本轮候选数 |
| `inserted_count` | 成功归档（含重下）条数 |
| `updated_count` | 只改元数据的条数（主要是 `path_not_portable` 改相对路径） |
| `skipped_count` | 跳过（源被锁、策略关闭、未到 `next_repair_at`） |
| `failed_count` | 本轮失败条数 |
| `metadata` | `{verified, unavailable, byKind, bySource}` |

常用 SQL：

```sql
-- 最近 5 轮
SELECT run_id, status, fetched_count, inserted_count, updated_count, skipped_count, failed_count, metadata
FROM crawler_logs WHERE source = 'attachment_repair' ORDER BY id DESC LIMIT 5;

-- 当前全库归档状态分布
SELECT archive_status, failure_kind, COUNT(*) FROM bid_attachments GROUP BY archive_status, failure_kind;

-- 还在排队重试的（按下次重试时间）
SELECT id, bid_id, failure_kind, repair_attempts, next_repair_at
FROM bid_attachments WHERE archive_status = 'failed' ORDER BY next_repair_at LIMIT 20;
```

用户侧：详情页附件徽标沿用现有 `archiveStatus`；`unavailable` 的文案明确告诉用户"门户要求交互式下载，请使用原始链接"，不再给一份 `*-download-note.txt` 当文档。

## 浏览器 sidecar 的边界与启动

**边界（不可放宽）**：只访问公开页面；**不输入任何凭证、不过验证码、不绕过 WAF**；页面出现密码输入框且标题/表单指向登录时返回 `LOGIN_WALL`；导航离开 `allowed_hosts` 立即中止（`OFF_HOST`）；单并发；下载只进内存，sidecar 自身不落盘；无任何鉴权，**永远不要对外暴露**。

启动：

- **本机**：`services/browser-downloader/run-local.sh`（首次会下载 Chromium，约 150 MB），只监听 `127.0.0.1:8092`；`frontend/.env.local` 设 `BROWSER_DOWNLOADER_URL=http://localhost:8092`。健康检查：`curl -s http://localhost:8092/health` → `{"ok": true, "browser": "chromium", ...}`。
- **容器**：`docker compose --profile workers up -d --build browser-downloader attachment-worker`。compose 里**没有 `ports:`**，sidecar 只在 compose 网络内可达，`attachment-worker` 通过 compose DNS 访问 `http://browser-downloader:8092`（URL 已注入）。宿主机不要去连 `localhost:8092`，要验健康就进容器：
  ```bash
  docker compose exec browser-downloader python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8092/health').read())"
  ```
- sidecar 不可达不会让整轮失败：相关条目记 `browser_unavailable`，按退避重试。

## 容器拓扑

`docker-compose.yml` 的 `workers` profile（本地 / demo 用，生产拓扑见 [AWS 部署手册](aws-deployment-runbook.md)）：

- `attachment-worker`：与 `crawler-worker` 同一个镜像（`frontend/Dockerfile` 的 `worker` 目标，内含 Node + Python + crawler 代码），通过 `command: ["npm", "run", "worker:attachments"]` 覆盖启动命令；挂载 `apsi-data:/app/data`，与 `app`、`crawler-worker` 共享归档根，修好的附件立刻能通过 `/api/bids/[id]/attachments/[attachmentId]` 下载。
- `browser-downloader`：独立镜像（Playwright 官方 Python 镜像），`depends_on: service_started`（不是 `service_healthy`，因为附件修复对 sidecar 是可降级的）。
- 单次运行：`docker compose --profile workers run --rm attachment-worker npm run attachments:repair:once`。
- 只做预检：`docker compose --profile workers run --rm attachment-worker npm run worker:attachments:check`。

## 历史数据首轮行为

首轮不需要任何一次性脚本，worker 自己会把存量收敛（基线见设计文档第 1 节，2026-09-16 本地 MySQL `winbids` 实测）：

- 150 条写着宿主机绝对路径的 `archived` → 判 `path_not_portable` → 改写成相对路径，**不发任何网络请求**，计入 `updated_count`。
- 258 条公开 http(s) 链接进入 `never_archived` 队列，按源节流逐轮归档；其中 IL 的 83 条走 `browser` 模式，sidecar 不在线时记 `browser_unavailable` 退避。
- 56 条 seed/demo 的站内相对链接一次性判 `unavailable`，**不打网络**。

因此首轮 `crawler_logs` 的 `updated_count` 会明显大于 `inserted_count`，之后几轮才轮到真正的下载量；`bids.detail_archive_status` 随附件状态收敛而更新。

## 首轮实测（2026-09-16，本地 MySQL `winbids`）

前提：`npm run db:mysql:migrate`（新增 4 列 + 索引）；`services/browser-downloader/run-local.sh` 在 127.0.0.1:8092；Illinois BidBuy 通过 `PATCH /api/admin/data-sources/il_bidbuy` 设为 `attachments.mode=browser`。

| 轮次 | 命令 | 结果 |
| --- | --- | --- |
| 1（全部源，每源 3 条） | `ATTACHMENT_REPAIR_MAX_PER_SOURCE=3 BROWSER_DOWNLOADER_URL=http://127.0.0.1:8092 npm run attachments:repair:once` | 候选 314；`metadataFixed` 150（全部历史绝对路径改为相对路径，`verified_at` 写入）；`repaired` 9（IL 2 走浏览器、IN 2、ME 1、MS 2、MO 2）；`failed` 58（`http_4xx` 39 —— 全部是 seed/demo 行的占位链接 404/403；`off_target` 10 —— 重定向到别的主机或非目标页；`html_response` 7 —— SAM.gov / HI 返回 HTML 页；`network` 2）；用时 3 分 18 秒 |
| 2（仅 IL） | `… ATTACHMENT_REPAIR_SOURCE_IDS=il_bidbuy …` | 修复链接匹配缺陷后重跑：`repaired` 3，checksum 各不相同 |
| 3（仅 IL） | 同上 | 两条被标记 `archive_corrupt` 的行优先重下：PDF 466 KB、PNG 1.4 MB，与同招标另两份 DOCX 四者 checksum 互不相同 |

通过 `/api/bids/<id>/attachments/<attachmentId>` 下载浏览器归档的 IL PDF：HTTP 200、`content-type: application/pdf`、`x-winbids-attachment-availability: archived_openable`、字节数与磁盘一致、魔数 `%PDF-`。

首轮发现并修复的缺陷：浏览器下载的链接标识取的是 URL 中最后一个数字参数（IL 模板的 `currentPage=1`），导致同一招标的多个附件都下到第一份文件。修复为按参数名（`downloadFileNbr` 等）优先、其次最长数字值、排除分页参数；sidecar 侧改为整词匹配并在多个控件命中同一标识时按附件名消解，无法消解则返回 `LINK_NOT_FOUND`。选取顺序改为"已归档但缺失/损坏 → 从未归档 → 其余失败重试"。

已知但保留：seed/demo 行的占位 https 链接会按退避重试 6 次后转 `unavailable`（约 63 小时）；SAM.gov 附件链接本身是 HTML 页面，两次 `html_response` 后转 `unavailable`；PNG/JPEG 等图片没有魔数白名单，按响应头类型归档（`application/octet-stream`）。
