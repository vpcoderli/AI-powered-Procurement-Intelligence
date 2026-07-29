# 爬虫源目录数据化与规模化抓取 — 设计文档

**日期:** 2026-07-29
**范围:** 阶段 1（源目录数据化 + 50 州迁移）。阶段 2–4 在此文档中只定边界，各自另出 spec。

---

## 1. 背景

APSi 当前抓取 50 个州级采购门户 + SAM.gov。业务要求向下扩展到郡、县、市三级（目标 2000+ 源），并接入部分付费数据平台，通过统一的自动化任务补充数据。

现状调研（2026-07-29）发现三个会直接阻断扩展的约束：

**其一，源目录是编译期常量。** 源清单硬编码在两处：`crawler/apsi_crawler/sources/state_sources.py` 的 `STATE_SOURCES`（Python frozen dataclass）和 `frontend/src/lib/state-crawler-sources.ts` 的 `STATE_CRAWLER_SOURCE_DEFINITIONS`（TS，473 行）。两侧靠结构化测试强制一致。新增一个源需要改两个文件并可能新增一个 spider 模块。50 个源可控，2000 个源不可行。

**其二，`data_sources` 表已有完整治理元数据，但大部分是死字段。** 表中 `cadence`、`provider_family`、`access_mode`、`requires_login`、`approved_for_ingestion`、`robots_txt_status`、`tos_reviewed`、`consecutive_failures` 均已存在。实际消费情况：

| 字段 | 现状 |
|---|---|
| `is_enabled` | 生效（`orchestrator.ts` 读取决定是否运行） |
| `cadence` | 仅在 admin 表格展示，调度器不读 |
| `provider_family` | 仅用于展示与 `risk:check`，不驱动适配器选择 |
| `requires_login` / `access_mode` | 仅标注 |
| `consecutive_failures` | 累加但无消费方 |

**其三，抓取执行体是一次性子进程。** `state-runner.ts` 通过 `execFile("python3", ...)` 每源启动一个进程。Python 冷启动加 import 约 200–400ms，51 源可接受；2000 源仅进程开销即 7–13 分钟/轮。

此外，`crawler-worker.ts` 固定每 15 分钟全量顺序轮询全部源，无优先级、无分片、无并发控制。

### 1.1 数据现状

调研时数据库中 1147 条 bid 记录经核验为真实数据（`source_url` 全部指向真实政府门户域名，无占位/测试数据），但：

- 最后一次成功抓取：2026-06-03（8 周前）
- 1127 条有截止日期的记录中，978 条（87%）已过期
- 50 个源中 45 个为 `beta` 成熟度，仅 5 个为 `verified`（CA/FL/IL/NY/TX）
- 468 条（41%）来自 `bidnetdirect.com`，即单一第三方聚合平台

## 2. 已确认的决策

| 议题 | 决策 |
|---|---|
| 本轮目标 | 源目录数据化 + 平台适配器 + cadence 调度 + 付费源，目标不变、分阶段交付 |
| 覆盖量级 | 2000+ 源（尽可能全覆盖郡县市） |
| 源发现策略 | 自动发现候选 + 人工审核入库 |
| 付费源形态 | API 型与登录抓取型均支持，按源配置 |
| 执行体架构 | 方案 A：Python 常驻 worker + 数据库任务队列 |
| 交付节奏 | 分四阶段，按 1→2→3→4 顺序 |
| `STATE_SOURCES` | 直接退役，不双写过渡 |
| `fips_code` | 阶段 1 即引入 |
| `fetch_config` | JSON 列 |
| `--fallback-fixture` | 生产路径删除，仅保留于测试 |

### 2.1 合规立场

付费源支持登录抓取型，是明确的产品决策。设计上将合规责任显式化：`requires_login = 1` 的源必须填写 `compliance_reviewer`、`legal_opinion_reference`、`tos_reviewed`，否则不得进入 `approval_status = 'approved'`。该门禁从「建议」提升为硬校验。现有 compliance ledger（`docs/operations/data-source-compliance-ledger.md`）承载此流程，不新建机制。

## 3. 目标架构（四阶段完成态）

```
┌─ Node (frontend/) ─────────────────────────────┐
│  scheduler        读 data_sources.cadence       │
│                   + last_success_at → 产出任务   │
│         ↓                                       │
│    crawl_tasks 表  (SKIP LOCKED 队列)           │
│         ↓                          ↑            │
│  importer  ← 结果 JSON ────────────┼─── 治理层  │
│         ↓                          │   approval │
│    bids / crawler_logs             │   compliance│
└────────────────────────────────────┼────────────┘
                                     │
┌─ Python (crawler/) ─────────────────┼───────────┐
│  常驻 worker × N  ──拉任务──────────┘           │
│      ↓                                          │
│  ADAPTER_REGISTRY: provider_family → fetcher    │
│   bidnet │ bonfire │ ionwave │ periscope │ ...  │
│      ↓            (~12 个适配器,不是 2000 个)    │
│  令牌桶按 provider_family 限流                   │
└─────────────────────────────────────────────────┘
```

核心思想：**源的身份从「代码中的一个条目」变为「表中的一行」**，代码中只保留按平台组织的约 12 个适配器。2000 个郡市 = 2000 行数据 + 复用同一组适配器。

美国地方政府 e-procurement 高度集中于少数 SaaS 平台（BidNet Direct、Bonfire、Periscope/BidSync、OpenGov Procurement、Ionwave、eBid Exchange、DemandStar、Vendor Registry、Bid Express、PlanetBids、ProcureWare），适配器数量收敛。仅少数自建门户的大型行政区需要专用 spider。此模式已在 `state_bidnet.py` 得到验证——单一 fetcher 加 URL 映射表服务 16 个州。

### 3.1 队列选型

使用 MySQL 表加 `SELECT ... FOR UPDATE SKIP LOCKED`，不引入 Redis/SQS。

依据：2000 源 × 每日一次 = 每分钟 1.4 个任务，数据库表队列容量充裕；与现有 `event_outbox` / `notification_outbox` 的 outbox 模式心智一致，`retrying-*` 装饰器与 `lock-repository` 可复用；不改变现有 AWS 部署拓扑。

### 3.2 阶段边界

| 阶段 | 内容 | 产出 |
|---|---|---|
| 1（本 spec） | 源目录数据化 + 50 州迁移 | `data_sources` 成为唯一真源，`cadence` 生效 |
| 2 | Python 常驻 worker + 队列调度 | 替换轮询，按平台限流 |
| 3 | 平台适配器 + 自动发现 + 人工审核队列 | 郡县市规模化入库 |
| 4 | 付费源凭据层 + 配额计量 | API 型与登录型双支持 |

阶段 1+2 完成后，现有 50 州的新鲜度问题即解决；阶段 3 开始上量。

## 4. 阶段 1 设计

### 4.1 范围

**做：**

1. `data_sources` 表升格为源目录唯一真源。`CONFIGURED_CRAWLER_SOURCES` 常量删除，改为查表（`is_enabled = 1 AND approved_for_ingestion = 1`）。
2. Python 侧 registry 从「按源」改为「按平台」。`STATE_SOURCES` 退役，代之以适配器注册表。源的 URL、租户 ID、能力标记由任务参数传入。
3. `cadence` 生效。调度器依 `cadence` 与 `last_success_at` 决定本轮运行哪些源。
4. 数据模型引入行政层级与 FIPS 码。
5. 50 州数据迁移，现有一致性测试改造。

**不做：** 任务队列（阶段 2）、自动发现（阶段 3）、付费凭据（阶段 4）。阶段 1 结束时调度仍为单进程顺序执行，但已是 cadence 驱动、查表取源。

### 4.2 数据模型

`data_sources` 新增列：

```
jurisdiction_level   TEXT     -- federal | state | county | city | special_district
jurisdiction_name    TEXT     -- "Fulton County" / "City of Austin"
fips_code            TEXT     -- 州 2 位 / 郡 5 位 / 市 7 位
fetch_config         TEXT     -- JSON,适配器参数
```

`fips_code` 采用标准 GEOID：`06` = California，`06037` = LA County，`0644000` = Los Angeles city。作为跨平台去重、地理筛选、行政区归属查询的锚点。

`fetch_config` 使适配器参数化，替代当前硬编码于 spider 中的 URL 与租户信息：

```json
{ "tenant": "fultoncountyga", "base_url": "https://fultoncountyga.bonfirehub.com", "list_path": "/opportunities" }
```

选择 JSON 而非结构化列：2000 源、十余个平台，各家参数差异大，拆列会产生大量稀疏列，且新增平台需要迁移。

`bids` 表同步新增 `jurisdiction_level` / `jurisdiction_name` / `fips_code`，从源继承。

`cadence` 取值收敛为 `hourly | daily | weekly | manual`，对应间隔 1 小时 / 24 小时 / 7 天。`manual` 表示不参与自动调度，仅可由 admin 手动触发。迁移时现有值均为 `daily`，无需转换；遇到非法值按 `daily` 处理并记录告警。

### 4.3 任务契约

Node → Python 的接口定为 JSON。阶段 1 经 stdin 传递，阶段 2 改为从队列读取，**适配器接口不变**。

```json
{
  "task_id": "tsk_01H...",
  "source_id": "ga_fulton_county",
  "provider_family": "bonfire",
  "fetch_config": { "tenant": "fultoncountyga", "base_url": "..." },
  "limit": 25,
  "query": null
}
```

现有 `buildArgs()` 的 argv 拼装退役。argv 无法承载 `fetch_config` 这类结构化参数，且每增加一项能力需同时修改两侧。

CLI 新增 `fetch-task` 子命令读取 stdin JSON。阶段 2 的常驻 worker 复用同一执行路径。

### 4.4 适配器注册表与解析链

现有 41 个 spider 分两类，注册表同时容纳（以下为最终形态示意；阶段 1 只需 `bidnet` 加现有专用适配器，`bonfire`/`ionwave` 等在阶段 3 补充）：

```python
# 商业平台:一个适配器服务 N 个租户
PLATFORM_ADAPTERS = {
    "bidnet":   fetch_bidnet,      # 已有,现服务 16 州,将服务数百郡市
    "bonfire":  fetch_bonfire,     # 阶段 3 新增
    "ionwave":  fetch_ionwave,     # 阶段 3 新增
}

# 自建门户:一源一适配器(仅大型行政区值得)
DEDICATED_ADAPTERS = {
    "ca_caleprocure": fetch_ca_caleprocure,
    "tx_esbd":        fetch_tx_esbd,
}
```

解析顺序：先查 `source_id` 的专用适配器，未命中则按 `provider_family` 取平台适配器，仍未命中则**任务显式失败并将源标记为 `needs_review`**。不静默跳过——2000 源规模下静默跳过会导致无法感知哪些源未在运行。

迁移后，现有 45 个 `*_state_procurement` 源（多数走 BidNet）从「45 个 registry 条目」变为「45 行数据 + 1 个适配器」。

### 4.5 组件划分

| 位置 | 模块 | 职责 |
|---|---|---|
| Node | `crawler/source-registry.ts` 新增 | 查 `data_sources` 取启用源，SQLite/MySQL 双分支 |
| Node | `crawler/scheduler.ts` 新增 | 按 `cadence` + `last_success_at` 计算本轮任务 |
| Node | `crawler/configured-runner.ts` 改造 | 删除常量，改查表 |
| Node | `crawler/state-runner.ts` 改造 | argv 拼装 → JSON 契约 |
| Python | `apsi_crawler/adapters/` 新增 | 注册表与解析链 |
| Python | `cli.py` 新增 `fetch-task` | 读 stdin JSON |
| Python | `spiders/` 保留 | 零改动，由适配器包装 |

`lib/state-crawler-sources.ts` 退役，治理元数据迁入 `data_sources`，仅保留「州码 ↔ 名称」静态查表供 UI 使用。

### 4.6 调度逻辑

```
due_at = last_success_at + interval(cadence)
入选条件: is_enabled = 1
        AND approved_for_ingestion = 1
        AND (last_success_at IS NULL OR now >= due_at)
```

排序按 `jurisdiction_level`（州级优先）与 `due_at` 升序，并对同一 `provider_family` 的任务打散——阶段 1 为单进程顺序执行，打散的作用是避免连续向同一平台发起请求（礼貌性间隔）；阶段 2 引入并发后，该排序与按 `provider_family` 的令牌桶共同构成限流基础。

调度决策抽为纯函数 `selectDueSources(sources, now)`，不访问数据库，便于测试。

### 4.7 失败处理

现有代码仅区分 success/failure，不足以支撑规模化。三类失败分开处理：

| 类型 | 判定 | 处置 |
|---|---|---|
| 网络失败 | 超时、连接拒绝、5xx | 指数退避重试，`consecutive_failures++` |
| 解析失败 | 取得 HTML 但无法抽取记录 | 平台改版信号，标记 `needs_review` 并告警，不重试 |
| 静默空结果 | 成功返回但 0 条 | 连续 3 轮为 0 触发告警并标记 `needs_review` |

第三类为当前系统的隐患：`crawler_logs` 中所有源均记为 `success`，但每源条数停滞在 25/26，最后成功时间集中于 2026-06-03，无法区分「无新数据」与「解析器已失效」。

`consecutive_failures` 本轮生效：连续失败则按 `2^n` 延长 cadence（退避上限 7 天），连续 5 次失败自动降级为 `needs_review` 并停止调度，进入人工队列。否则死源将持续空转消耗配额。上述阈值（3 轮空结果、5 次失败、7 天退避上限）为初始默认值，应可经 admin config 调整而非硬编码。

### 4.8 迁移路径

`data_sources` 表现有 53 行（seed 写入），迁移脚本必须 upsert 补字段而非 insert：

1. 将 `STATE_CRAWLER_SOURCE_DEFINITIONS` 的 50 条及治理元数据 upsert 入表，补 `jurisdiction_level = 'state'`、`fips_code`（50 州 FIPS 为固定标准表，硬编码于脚本）、`fetch_config`（从现有 spider 提取 URL）
2. 幂等：重跑无副作用，已有人工签核字段（`approval_status`、`legal_review_status`、`compliance_*`）不覆盖
3. 脚本执行、查表路径验证通过后，再删除 `state-crawler-sources.ts` 与 `STATE_SOURCES`

删除动作置于验证之后——虽然决策为直接退役不双写，但中间态需要可验证。

### 4.9 测试策略

现有结构化测试改造：`state-crawler-sources.test.ts` 中「50 条」断言失效，改为**适配器覆盖测试**——「每个 `is_enabled = 1` 的源都能解析到适配器」。该断言在 2000 源规模下依然成立且更具价值。

新增三类测试：

- **调度纯函数测试** — `selectDueSources` 覆盖各 cadence 与失败态组合，无数据库、无网络
- **适配器解析链测试** — source_id 优先、fallback 至 provider_family、均未命中则显式失败
- **跨语言契约测试** — Node 侧写出契约样本 JSON 至 `crawler/tests/fixtures/contracts/`，Python 侧读取同一文件解析。JSON 契约跨语言边界，任一侧改字段而另一侧未跟进只会在运行时暴露，共享 fixture 是成本最低的防线。

`--fallback-fixture` 从生产路径移除后，fixture 仍保留于 pytest 作为解析器单元测试输入。测试用固件，生产要真相。

### 4.10 现有架构约束

以下为 codebase 既有硬性约束，实现时必须遵守：

- **双 dialect**：所有新增查询须实现 SQLite（Drizzle）与 MySQL（手写 SQL）两条分支。MySQL 模式下导出的 `db` 是抛 `MysqlRuntimeDatabaseGuardError` 的 Proxy，只实现 Drizzle 分支会在运行时硬失败。新增 API 路由须在 `mysql-route-coverage.test.ts` 登记。
- **迁移位置**：新表与索引必须置于 `migrate.ts` 的**第一个** `sqlite.exec()` 模板字面量块内。`mysql.ts` 以正则提取该块生成 MySQL DDL，块外的语句不会到达 MySQL。

## 5. 验收标准

阶段 1 的验收口径为**调度与治理链路跑通、失败被正确分类和上报**，而非「50 个源全绿」。

移除 fixture 回退后，现有 50 州的真实成功率将暴露。预期该数字不佳——45 个源为 beta 成熟度、8 周未运行、平台大概率已改版。阶段 1 完成时可能观察到相当比例的源报解析失败。这是设计意图内的结果：使真实健康度可见。修复各源解析器是随后的独立工作，不阻塞阶段 1。

具体验收项：

1. `data_sources` 表为源目录唯一真源，`STATE_SOURCES` 与 `state-crawler-sources.ts` 已删除
2. 调度按 `cadence` 生效，可通过修改表中 `cadence` 改变源的运行频率而无需改代码
3. 三类失败被正确分类并写入 `crawler_logs`，`consecutive_failures` 触发退避与降级
4. 新增源仅需插入一行数据（前提是其 `provider_family` 已有适配器）
5. 全部测试通过，包含跨语言契约测试
6. SQLite 与 MySQL 两条路径均验证

## 6. 不在阶段 1 范围

- 任务队列与常驻 worker（阶段 2）
- 新平台适配器（Bonfire、Ionwave 等）与自动发现（阶段 3）
- 付费源凭据金库、配额计量、License 到期告警（阶段 4）
- 现有各州解析器的修复（独立工作）
- 郡县市 FIPS 目录数据的填充（阶段 3 由发现器带入）
