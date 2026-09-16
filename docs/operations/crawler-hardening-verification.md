# 爬虫补全加固：修复验证记录（2026-09-16）

对应逻辑文档：[爬虫与 Scrapling 详情补全全链路逻辑](../architecture/crawler-enrichment-flow.md)；实施计划：`docs/superpowers/plans/2026-09-15-crawler-enrichment-hardening.md`。本记录只写实际运行过的命令与结果；线上门户的历史实测见[详情补全运维](detail-enrichment.md)。

## 1. 起因

外部测试（GPT-6）在 `19286e8` 上报告五项问题，随后在工作区完成了修复初稿：

| # | 问题 | 修复落点 |
| --- | --- | --- |
| 1 | 标准化器把标题填入长描述，阻止补全，页面仍显示标题 | `normalizers/state_bids.py`、`content_quality.py`、`enrichment.py` 完整度判断、`src/lib/bid-description.ts`（详情页、列表卡片、意向页共用） |
| 2 | 入库失败仍可能返回成功；合法的日期筛选零条结果被拒 | `persistence-errors.ts`（`CrawlerPersistenceError`、`validateCrawlerImport`）、`crawl-task-persistence.ts` 返回失败结果并写失败日志、`sam-gov-runner.ts`、健康回写在持久化之后 |
| 3 | 非空列表描述覆盖详情；非空附件列表整组替换旧附件 | `persistence-merge.ts`（按 `applied_fields` / `persisted_fields` 来源保护，附件按 URL 再按稳定 ID 合并，不删未观察项，不清成功归档），两种数据库同一事务读-合并-写 |
| 4 | 补全可能超过十分钟锁有效期造成重复执行 | `orchestrator.ts` 每 TTL/3 续租、每次尝试唯一 owner、AbortSignal 传给 Python 子进程、导入事务内复核租约、`CRAWLER_TASK_TIMEOUT_MS` |
| 5 | 应用镜像缺少 Python crawler 执行环境 | `frontend/Dockerfile` 改为仓库根上下文的 `crawler-runtime` / `runner` / `worker` 三目标，compose 增加 `workers` profile，CI 增加 Python、容器、集成三个 job |

## 2. 独立审查（三路并行，Opus 5）

### 2.1 Python 补全逻辑（`crawler/`、`services/scrapling-extractor/`）

| 严重度 | 位置 | 缺陷 | 修复 | 覆盖测试 |
| --- | --- | --- | --- | --- |
| 中 | `enrichment.py` 附件去重 | 只比对原始 URL 字串，`https://Portal.gov/a.pdf` 与 `https://portal.gov:443/a.pdf#page=2` 被当作两份 | `_attachment_key()`：scheme/host 小写、去默认端口与 fragment、去路径尾斜杠，保存的 URL 不变 | `test_same_document_is_not_appended_twice_when_the_detail_url_only_differs_cosmetically` |
| 中 | `detect_off_target_redirect` | apex→`www` 或显式 `:443` 被判脱靶，导致整源每条详情 `failed` | `_comparable_host()`（`hostname` + 去前缀 `www.`） | `test_cosmetic_host_redirects_stay_on_target` 等 |
| 中 | `content_quality.is_login_html` | 含站点级登录组件的公开详情页（`Solicitation Description:` 等标签）被判登录墙 | 标签匹配改为有界正则，登录说明守卫不变 | `test_public_bid_page_with_a_site_wide_login_widget_is_not_a_login_wall` 等 4 个 |
| 中 | `date_window.py` | 缺 `%m/%d/%Y %I:%M %p`，IL 列表的 `06/30/2026 02:00 PM` 不可解析，日期窗口形同虚设 | 补格式 | `TestFourDigitYearWithTwelveHourClock` |
| 中低 | 标题回显判断 | 不忽略首尾标点，`Road repair.` 仍被当成正文 | `echo_key()` / `same_text()`，Python 与 TS 同一套标点集 | 3 个 normalizer / merge 测试 |
| 低 | `resolve_attachment_url` | `{source_bid_id}` 未编码 | `quote(..., safe="")` | `test_attachment_template_percent_encodes_the_portal_supplied_id` |

另新增 stdout 纯 JSON 回归（单条补全失败时）。模糊测试 90 组畸形响应 × 畸形记录：无异常逃出 `enrich_bids`，`enriched + failed + skipped == len(bids)` 恒成立。

### 2.2 TS 持久化与租约（`frontend/src/server/crawler/**`）

| 严重度 | 位置 | 缺陷 | 修复 |
| --- | --- | --- | --- |
| 中 | `components/bids/BidCard.tsx` | 列表卡片直接渲染 `bid.description`，合并后标题回显被归一为空串，卡片出现空白 | 改用 `getBidDescription` |
| 中 | SQLite 与 MySQL upsert 查找不一致 | SQLite 只按 `id` 查找，`dedupe_key` 与另一 `id` 冲突时整批回滚；MySQL 用 `OR` 跨两个唯一索引可能退化为扫描 + 间隙锁 | 两端统一：先按 `id`、再按 `dedupe_key` 两次点查，更新既有行，附件挂到既有行 |
| 中 | MySQL 导入全程持有 `crawler_locks` 行锁 | 心跳续租 `UPDATE` 被阻塞，超过 `innodb_lock_wait_timeout` 后自我中止 | 开头为普通读，只在提交前做一次短暂 `FOR UPDATE` 复核 |
| 中 | 锁丢失被计入源健康失败 | `CrawlerLeaseLostError` 触发 `consecutive_failures` 与退避锚点 | 健康回写跳过锁丢失 |
| 中 | 子进程非零退出但 stdout 为 success 文档 | 状态路径会写成功日志 | `state-runner.ts` 把该 payload 转为 failure（`fetchedBeforeProcessFailure` 保留计数） |
| 低 | `sam-gov-runner.ts` 托管导入忽略 `DATABASE_PATH` | 与 worker 脚本写不同文件 | 与 `db/client.ts` 同一解析规则 |
| 低 | `failure-classifier.ts` | 缺 `ChunkedEncodingError` / `ProxyError` / `RetryError` / `ContentDecodingError` / `RemoteDisconnected` | 补入网络类；同时断言持久化与锁丢失不重试 |
| 低 | `intents/[id]/page.tsx` | 检索追踪查询用原始 `description` | 改用 `getBidDescription` |
| 低 | MySQL 测试假池 | 模拟 `ON DUPLICATE KEY UPDATE` 更新所有列，按 `dedupe_key OR id` 匹配 | 与真实列清单和点查语义一致 |

审查确认无误（未改）：无来源标记的旧行只在 `detail_fetched_at` 或诊断存在时受保护，纯列表旧行被列表值刷新是正确行为；`validateCrawlerImport` 的零条接受条件与 `date_window.py` / `_require_non_empty_bids` 恒等；`ERR_CHILD_PROCESS_STDIO_MAXBUFFER` 不会被误判为超时；`id` 不在 MySQL 更新列中；跨招标附件 ID 冲突两端都会回滚整批；`persisted_fields` 幂等；`run-authorization.ts` 的 `local-bypass` 类型真实存在；county/city 治理门禁不会排除任何合法源。

### 2.3 容器、CI 与运行时

| 严重度 | 位置 | 缺陷 | 修复 |
| --- | --- | --- | --- |
| 高 | `frontend/Dockerfile` `RUN npm run build` | `next build` 的多 worker 同时打开不存在的 `data/apsi.sqlite` 并切 WAL，间歇 `SQLITE_BUSY`（17 核机器 2 次中 1 次） | Dockerfile 构建前预建 WAL 文件；应用侧 `db/client.ts` 增加 `busy_timeout = 5000` |
| 高 | `.dockerignore` | 上下文 80.9 MB，其中 `.claude/` 68 MB、含密码的 `start-mysql.sh`、`.patch` | 排除后 9.5 MB，构建输入完整；删除失效的 `frontend/.dockerignore`（BuildKit 只读上下文根） |
| 中 | CI `crawler-runtime` | 只构建 `worker`，`runner`（compose 与 ECS web 使用、唯一在 Docker 内跑 `next build` 的目标）从未验证 | 增加 `runner` 构建、镜像内 crawler 链路冒烟、`/api/health` 等待并 curl |
| 中 | `aws-deployment-runbook.md` | 声称一个共享 task definition 可通过 command override 跑 worker；runner 是精简 standalone，无 `tsx` | 改为双镜像双 task definition |
| 中 | `docker-compose.yml` | 两个服务继承 `.env.local` 的 `DATABASE_URL=mysql://…@127.0.0.1`，容器指向自身，`/api/health` 503 | 两服务把 `DATABASE_URL` / `MYSQL_DATABASE_URL` 钉为空（SQLite），`COMPOSE_DATABASE_URL` 环境变量可覆盖 |
| 低 | worker 镜像 1.68 GB，venv 装了 `pytest` | 生产镜像含测试工具 | 新增 `crawler/requirements-runtime.txt`（仅 `requests`），镜像只装它；`requirements.txt` 通过 `-r` 引用 |
| 低 | CI `crawler-integration` 无 pip 缓存 | — | 补 `cache: pip` |

审查后保留、已在逻辑文档 §7 记录的边界：补全候选缺少历史视角（列表描述缺失的源每次重抓前 N 条）；附件只增不删（带随机参数的 URL 会累积）；更短的权威详情可替换旧长正文；本地放行以 `Host` 头判断回环；解析器附件回退没有噪声祖先过滤；runner 镜像因 Next standalone 文件追踪仍带完整 `src/`（`vitest.config.ts` 的 include 收窄即为此）。

## 3. 门禁结果（合并全部修复后）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| crawler pytest | `cd crawler && python3 -m pytest -q` | 330 passed（基线 311，新增 19） |
| extractor pytest | `cd services/scrapling-extractor && .venv/bin/python -m pytest -q` | 43 passed |
| 前端单测 | `cd frontend && npx vitest run` | 297 文件 / 1837 passed，2 skipped（发现范围收窄到 `src/`、`scripts/`、根目录，`.next/standalone` 复制品不再重复执行） |
| ESLint | `npm run lint` | 0 error / 0 warning |
| 生产构建 | `npm run build` | 通过 |
| 类型检查 | `npx tsc --noEmit -p tsconfig.json` | 82 个文件报错，全部为本分支未触碰的既有 `*.test.ts`（vitest Mock 类型漂移）；与 `git status` 交集为空。`next build` 是生效的类型门禁 |
| i18n / 风险门禁 / 密钥扫描 | `npm run i18n:check`、`npx tsx scripts/risk-check.ts`、`npm run secrets:scan` | 与基线一致（`winbids-demo/page.tsx` 的既有 i18n 发现；`npm audit` 16 条上游通告与本分支无关） |
| compose | `docker compose config --quiet` | 通过 |
| 跨语言集成（SQLite + 真实 MySQL 8） | `CRAWLER_INTEGRATION_MYSQL_URL=mysql://root:***@127.0.0.1:3306/ CRAWLER_INTEGRATION_PYTHON=<py3.12, 同时装两份 requirements> npm run test:crawler-integration` | 6 passed：真实 IL 列表 fixture → 真实 adapter → HTTP sidecar → CLI JSON → 两种导入器 → 读取/展示/关键词查询；关闭补全重导入后正文、附件、检索均保留；日期筛选零条成功落日志；最终日志写失败时招标与附件回滚；单连接池下租约过期回滚并写失败日志。测试库 `apsi_crawler_test_*` 用后即删，`winbids` 未触碰 |
| 容器构建与冒烟 | `docker build -f frontend/Dockerfile --target worker|runner .` + CLI `--help`、venv 导入、`worker:crawler:check`、runner 内 crawler 链路、`/api/health` | 见 §4 |

## 4. 容器冒烟（最终版 Dockerfile / requirements-runtime）

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| worker 构建 | `docker build -f frontend/Dockerfile --target worker -t apsi-worker:final .` | 成功（缓存后 16.5 s） |
| runner 构建 | `docker build -f frontend/Dockerfile --target runner -t apsi-web:final .` | 成功 |
| worker：CLI | `docker run --rm -w /crawler apsi-worker:final python -m apsi_crawler.cli --help` | 列出 `import-fixture / fetch-sam-gov / fetch-task / validate-state-live` |
| worker：venv | `python -c "import requests, apsi_crawler"` | `requests 2.32.3`，`pytest_installed False`（runtime 依赖生效） |
| worker：健康探针 | `npm run worker:crawler:check`（`NODE_ENV=development`） | `"ok": true` |
| runner：crawler 链路 | `cd $CRAWLER_DIRECTORY && $CRAWLER_PYTHON_BIN -m apsi_crawler.cli --help && ... import requests` | 通过（`/crawler`、`/opt/crawler-venv/bin/python` 由镜像注入） |
| runner：Web | `docker run -d -p 3101:3000 -e ADMIN_UI_LOCAL_BYPASS=false apsi-web:final` → `GET /api/health` | HTTP 200；以 `nextjs`（uid 1001）运行，`/app/data` 可写 |
| compose worker | `docker compose --profile workers run --rm crawler-worker npm run worker:crawler:check` | `"ok": true`，无需先迁移（审查阶段验证） |

审查阶段（修复 Dockerfile 前后）的测量：worker 冷构建约 359 s（`npm ci` 200 s、`apk add python3 make g++` 132 s），缓存后 18 s；runner 在 deps/crawler-runtime 缓存后 15–29 s，冷约 6.5 min。CI 的 `crawler-runtime` job 在 2 核 runner 上预计 8–15 min。

## 5. 未验证 / 不在本记录范围

- 线上门户（IL/OR/PA 之外）当前是否可抓，未做新的实网抓取。
- 生产 MySQL（RDS）与 ECS 任务定义未实际部署。
- 历史脏数据（NY 登录页描述、IL 误提取联系人）未清理。
