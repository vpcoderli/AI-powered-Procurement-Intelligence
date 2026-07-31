# 阶段 1 爬虫源目录改造 — 全量测试用例清单与交叉测试计划

**日期:** 2026-07-31
**分支:** `worktree-crawler-source-registry-phase1`（HEAD `7ab9f49`）
**基线:** 前端 vitest 301 文件 / 1747 用例全绿；爬虫 pytest 211 全绿；`npm run build` 通过；`npm run lint` 通过。

---

## A. 自动化用例盘点（本阶段新增/改造）

### A1. 前端 Vitest（12 文件 / 107 用例）

| 文件 | 用例 | 覆盖点 | 风险层级 |
|---|---|---|---|
| `db/schema.test.ts` | 14 | jurisdiction/FIPS/fetch_config 七列在 SQLite PRAGMA 中存在 | 数据模型 |
| `db/mysql.test.ts` | 7 | 列迁移 + 索引迁移到达 MySQL DDL；`VARCHAR(191)` 尺寸一致性（新装/存量双路径） | **方言一致性** |
| `lib/state-fips.test.ts` | 5 | 50 州全覆盖、2 位零填充、无重复、大小写不敏感、未知返回 null | 数据正确性 |
| `crawler/source-registry.test.ts` | 9 | 治理门禁（显式拒绝才排除；NULL≠拒绝，含 sam_gov 用例）、fetch_config 解析容错 | **治理语义** |
| `crawler/scheduler.test.ts` | 15 | cadence 间隔、退避 2^n 封顶 7 天、五级辖区排序、平台交错优先于严格到期序（含文档化权衡用例） | 调度算术 |
| `crawler/failure-classifier.test.ts` | 8 | 12 个 Python 异常类名逐字映射、三类阈值（empty=3 其余=5）、重试/降级策略 | 失败语义 |
| `crawler/source-health-repository.test.ts` | 9 | 成功清零/失败累加/两条降级路径（SQLite 真库）+ MySQL fake-pool 断言 SQL 与参数 + **SET 顺序回归守卫** | **方言一致性** |
| `crawler/configured-runner.test.ts` | 16 | 查表驱动、调度闭环（成功后下轮不再 due）、双方言健康写回分派、blocked/disabled 不碰健康列、写回异常不中断循环、limit/query 穿透 | 主循环 |
| `crawler/state-runner.test.ts` | 7 | JSON 任务契约构造（base_url 兜底、limit/query）+ runCrawlTask stdin 写入与 camelCase 解析（成功/失败/EmptyCrawlerResultError） | **跨语言契约** |
| `crawler/contract-fixture.test.ts` | 1 | fixture 陈旧即失败（仅 `UPDATE_CONTRACT_FIXTURE=1` 可重生成） | **跨语言契约** |
| `scripts/migrate-source-registry.test.ts` | 7 | 50 行 upsert、幂等、**人工治理签核零覆写**、provider_family 5/19/26 分类（含 al_state_procurement 非 bidnet 域名用例） | 迁移安全 |
| `api/crawler/state/run/route.test.ts` | 9 | admin 手动触发路由：查表选源、指定 id 过滤、治理门禁、新路径分派（Task 14 迁移后新增） | 待复核 |

### A2. 爬虫 pytest（5 文件 / 21 用例 + 存量 190）

| 文件 | 用例 | 覆盖点 |
|---|---|---|
| `test_adapter_task.py` | 5 | TaskSource 构造、默认值、三条 ValueError 路径（含 match= 精确断言）、真实 normalizer 兼容 |
| `test_adapter_registry.py` | 6 | dedicated 优先于 platform、双未命中显式抛错（含双标识符）、bidnet 通用函数绑定 |
| `test_fetch_task_cli.py` | 4 | 四种结局各自的 JSON 输出与退出码（成功/空即失败/无适配器/异常透传） |
| `test_contract_compatibility.py` | 4 | 契约 9 字段全部值级区分性保护（合成 payload 规避 fallback 碰撞） |
| `test_adapter_coverage.py` | 2 | 迁移脚本产出的每个 provider_family 都有适配器；dedicated 无族名可解析 |
| 存量（spiders/normalizers/archive 等） | ~190 | 41 个 spider 的 fixture 解析、归一化、SAM.gov |

### A3. 质量门禁

| 门禁 | 命令 | 说明 |
|---|---|---|
| 类型检查 | `npm run build` | vitest/lint **不查类型**，build 是唯一类型门禁（本阶段已因此翻车一次） |
| Lint | `npm run lint` | flat config |
| 风控门禁 | `npm run risk:check` | **CI merge gate**；依赖 `state-crawler-sources.ts` 保留的治理元数据 |
| i18n | `npm run i18n:check` | admin UI 文案改动需过 |

### A4. E2E / 环境级（人工或控制器执行）

| 用例 | 断言 | 状态 |
|---|---|---|
| 迁移脚本双跑（SQLite） | 50 upsert、幂等、治理字段存活 | ✅ 已验（Task 13） |
| 迁移脚本（MySQL 真库） | 同上，`ON DUPLICATE KEY` 分支 | ⬜ **从未跑过**（此前仅 fake-pool） |
| `crawler:once`（SQLite，limit 3） | 调度选源、失败分类落库、**bids/crawler_logs 增量** | ⬜ 本轮执行 |
| `crawler:once`（MySQL） | 同上走 MySQL 分支 | ⬜ 本轮执行 |
| `db:mysql:smoke` | 55 表 37 项 | ⬜ 本轮执行 |
| admin「运行州级爬虫」路由 | 指定源触发、治理拦截 | 有 9 个新单测，无实机验证 |

---

## B. 已知缺口（按严重度）

### B1 · Critical：新路径不落库（本轮梳理时发现）

`fetch-task` 契约**有意**不带 `--database`（解耦），但没有任何任务补上 Node 侧的持久化：`runCrawlTask` 解析 stdout 后只取 `bids.length` 记 `fetchedCount`，**bid 记录被整体丢弃**；`crawler_logs` 同样无人写入。`mysql-json-importer` 现仅剩 SAM.gov 在用。

后果：`crawler:once` 表面成功（健康列正常更新、日志打印 fetched=N），但 `bids` 表零增量、admin 爬虫日志页面永远空白。**Task 15 原验收步骤只查健康列，抓不到这个。** 这是 plan 级缺陷——15 个任务没有一个负责持久化。

附带缺口：`bids.jurisdiction_level/jurisdiction_name/fips_code` 三列（Task 1 加的）至今无人写入——spec 4.2 要求"从源继承"，恰好应由这个缺失的导入器在导入时盖章。

### B2 · 待复核：Task 14 的两个提交未经任务级 review

实现 agent 提交后卡死（watchdog 600s），review 从未发生。重点疑点：`test_state_live_cli.py` 被整体删除（757 行）——`validate-state-live` 子命令仍然保留，其行为是否还有覆盖？`state-runner.test.ts` 从 16 例砍到 7 例，砍掉的是否全是 argv 死路径？

### B3 · 结构性弱点（ledger 中 deferred 的 13 项 minor 汇总）

- MySQL 侧全部是 fake-pool 断言，**SQL 从未在真 MySQL 上执行**（SET 顺序 bug 正是这么漏的）→ 由 A4 的 MySQL E2E 补
- 空串治理值（`""` vs NULL）在 orchestrator 与 source-registry 间语义分歧，当前无写入方、潜伏
- `execFile` 默认 1MB maxBuffer，大 payload 会截断（limit 25 下不触发）
- `idx_bids_fips_code` 未镜像进 Drizzle 表配置（migrate.ts 是真源，仅风格不一致）

---

## C. 跨模型交叉测试矩阵

| # | 维度 | 执行 | 复核 | 产出 |
|---|---|---|---|---|
| X1 | 爬虫套件全量 + 契约 fixture 一致性 | **haiku** | sonnet 抽查 | 通过/失败清单 |
| X2 | 方言一致性对抗审查：逐条比对本阶段全部手写 SQL 与 Drizzle 孪生（source-registry WHERE、health 双写、迁移 upsert 列集、mysql.ts 列/索引迁移） | **sonnet** | fable 裁定 | findings |
| X3 | Task 14 追补 review + 全分支终审（merge-base `810da1d`..HEAD，含 13 项 deferred triage） | **opus** | — | 终审报告 |
| X4 | E2E 双方言实跑（B1 取证 → 修复后回归） | **fable**（控制器） | opus 终审覆盖 | 实测数据 |
| X5 | B1 修复实现（SQLite 导入器 + 双方言接线 + 辖区盖章） | **sonnet**（TDD） | 独立 re-review | 修复提交 |

执行顺序：X1/X2 并行起 → X4 取证 → X5 修复 → X4 回归 → X3 终审（最后，覆盖全部修复）→ 全量回归收尾。

## D. 修复预案（B1）

新建 `src/server/crawler/sqlite-json-importer.ts` 镜像 `mysql-json-importer.ts`（Drizzle upsert bids + 写 crawler_logs），`configured-runner` 按方言把导入器传给 `runCrawlTask`；导入时从 `CrawlableSource` 把 `jurisdiction_level/jurisdiction_name/fips_code` 盖章到每条 bid。契约输出的 camelCase 键与 `CrawlerJsonRunPayload` 类型正好复用——当初保持 camelCase 兼容就是为此。
