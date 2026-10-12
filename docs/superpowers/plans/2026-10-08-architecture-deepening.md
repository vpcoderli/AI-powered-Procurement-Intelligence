# Architecture Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 按架构报告深化四个 module，并修复平台轮次中已复现的组合缺陷。

**Architecture:** 领域规则集中拥有，真实 adapter 保留差异。通过完整执行 interface 验证组合，保留已有深度 implementation；不新增通用框架、队列或表。

**Tech Stack:** TypeScript / Next.js 16.2.6 / Vitest；Python；SQLite / MySQL。工作分支 `codex/data-usability-20261001`。既有改动保留，当前不提交混合工作区或部署。

## Task 1：平台采集轮次（先实施）

**Files:** `frontend/src/server/crawler/worker-tick.ts` 与测试；`configured-runner.ts`、`precheck-queue-runner.ts`、`retrying-runner.ts`、`platform-budget.ts`、`frontend/scripts/crawler-worker.ts` 及受影响测试。

- [x] 用模拟时钟与真实预算写完整 tick 的失败反例：总额度 3，503 后重试成功，各报告一次请求，后续成本 2 的工作不得开始；列表后同平台预检等待 5,000 ms。
- [x] 运行新测试并记录断言失败，再实施 tick module。增加必要的内部共享控制，但 worker 只调用完整 tick。
- [x] 每次重试观察实际成本；请求成本未知时保守计费，未联系来源免费；预算用完不追加尝试，保持限流终止。
- [x] 顺序为列表→预检→可选正文补采；三步共用预算、时间线和暂停。列表健康和正文补采语义保持。
- [x] 运行目标与相关回归（8 个套件、162 项）；需求复审、代码质量复审均通过。另验证停止信号在等待期间到达时不再发起联系并退款。

## Task 2：招标接纳

**Files:** 新 `frontend/src/server/crawler/bid-intake.ts` 与测试；SQLite/MySQL JSON importer、`crawl-task-persistence.ts` 和接纳集成测试。

- [x] 从真实 SQLite 接纳和 MySQL adapter 场景建立行为反例；以整批结果、数据库内容、日志、下架和 metadata 为断言。
- [x] 一个共同 module 负责候选→合并→质量→附件→下架→日志的顺序；adapter 负责数据库差异、事务和租约检查。
- [x] 保持 importer 兼容调用、同步 SQLite、异步 MySQL、提交后公布结果以及单连接池失败日志规则；避免强制同步路径转异步。
- [x] 失败日志和返回的失败 payload 重新生成质量账，不能沿用上游“可用”或成功接纳数；原候选数保留为失败前证据，失败调用的原 metadata 不变。
- [x] 132 项目标回归通过，顺序完成两项独立复审；控制者 Node 20 真实 SQLite/MySQL 链路 26 项通过（含 3 项新增 MySQL 场景）。

## Task 3：手动抓取执行

**Files:** 新 `frontend/src/lib/manual-crawl.ts` 与行为测试；三个管理入口、`source-bulk-actions.ts`、`frontend/src/lib/api/admin.ts` 与相关测试。

- [x] 先写多批、缺项响应、失败后部分完成、state/SAM 混合及发布时间窗口反例，运行观察失败。
- [x] 接纳来源目标、窗口与明确的停止/继续策略，隐藏分块与日期转换。逐来源执行状态由同一 module 产生。
- [x] 明确辖区优先于旧广义 issuerType：县/市/乡镇/特别区通过自身登记 ID，不能误运行州 alias；联邦不进入 state route，州 alias 兼容保留。
- [x] 三个入口改为调用 module，不再复制执行循环；纯结果解释不再反向导入视图。
- [x] 保留选择上限、每批五个、权限、进度与重读；只删除被完整行为测试替代的源码 wiring 断言。
- [x] 需求复审追加反例：SAM HTTP 200 的错误/缺失来源、矛盾 ok/status 不得记成功；11 项 RED 反例修复后重新复审通过。
- [x] 目标及相关回归 11 个套件、277 项通过；需求复审补修后通过，随后独立代码质量复审通过。

## Task 4：来源身份

**Files:** 新 `frontend/src/lib/source-identity.ts` 与测试；`server/bids/registered-source-identity.ts`、`server/crawler/data-quality.ts`、`detail-history.ts`、`source-validity/source-data-quality.ts` 及集成测试。

组合核查补充：允许修改 `bid-intake.ts`，检查去重后实际保存的主键归属；这是来源门禁必须覆盖的实际写入目标。

- [x] 先写 canonical ID 优先、唯一/歧义 label、辖区回退、可选字段缺失和各用途差异的契约反例，运行观察失败。
- [x] 补测空 ID 从错误 namespace 的 dedupe key 派生后误接纳：检查实际派生 ID，隔离且不下架；合法缺 ID 回退保持。真实接纳和 SQLite 的 RED→GREEN 已验证。
- [x] 集中归属和字段比较；不同用途的额外约束显式保留，不做机械统一 boolean。
- [x] 四处 caller 通过同一 module；保持历史未注册行兼容与补采稳定编号规则。
- [x] 补修已复现的跨来源去重命中：正确输入 ID 不得覆盖另一来源旧主键；检查实际存储 ID，隔离且不下架，保留同来源去重与历史兼容。7 项 RED 反例修复后通过；真实 SQLite/MySQL 分别验证有效和缺陷旧记录的完整招标及附件快照不变。
- [x] 最终 12 个相关套件、259 项目标回归通过；去重修复后独立需求复审重审通过，随后独立代码质量复审通过，无待修发现。控制者真实数据库链路共 28 项通过。

## Task 5：最终验证与交付

- [x] Node 20.20.2 隔离依赖环境全量 Vitest 398 套件、3,674 项通过，2 套件/10 项默认跳过；Lint 和生产构建通过。未重建当前 Node 24 native dependencies。
- [x] crawler 951 项、HTML extractor 133 项、browser downloader 153 项全量 pytest 通过，之后 Python 源码与验证副本完全一致；真实 Python→解析→SQLite/MySQL 集成 2 套件、28 项通过。仅用临时数据库和回环专用容器。
- [x] 全库 TypeScript 仍为 276 条既有诊断，按文件与错误码对比无新增、无减少；新增生产诊断零。未将其称为全库通过。
- [x] 完整 45 文件变更的最终独立复审通过，复审者另运行 24 套件、559 项通过，无待修的重要发现。`git diff --check` 通过；本轮测试/构建进程已结束，专用 MySQL 容器已清理。
- [x] 更新执行记录与架构报告、术语和采集/补采文档；验收口径、修复证据、兼容决策及验证限制均已记录。
