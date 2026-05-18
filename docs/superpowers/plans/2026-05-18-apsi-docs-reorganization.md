# APSi Docs Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the APSi `doc/` directory into a clear current documentation set with one authoritative MVP PRD, two supporting documents, and archived source materials.

**Architecture:** The implementation is documentation-only. Current execution documents live at the top of `doc/`, historical source files move into `doc/archive/`, and `doc/README.md` defines document ownership so readers know which file is authoritative.

**Tech Stack:** Markdown, Git file moves, shell verification with `find`, `rg`, `git diff --check`, and `git status`.

---

## File Structure

Create or modify the following files:

- Create: `doc/README.md`
  - Responsibility: documentation index and source-of-truth guide.
- Create: `doc/APSi_PRD.md`
  - Responsibility: authoritative MVP product requirements document.
- Create: `doc/APSi_Prototype.md`
  - Responsibility: supporting page, information architecture, and interaction documentation.
- Create: `doc/APSi_Crawler_Architecture.md`
  - Responsibility: supporting crawler, data ingestion, normalization, and monitoring documentation.
- Create directory: `doc/archive/`
  - Responsibility: historical source material storage.
- Move: `doc/APSi_需求文档.md` to `doc/archive/APSi_需求文档.md`
- Move: `doc/APSi MVP 完整需求规格书.md` to `doc/archive/APSi MVP 完整需求规格书.md`
- Move: `doc/APSi_原型设计文档.md` to `doc/archive/APSi_原型设计文档.md`
- Move: `doc/APSi_爬虫架构文档.md` to `doc/archive/APSi_爬虫架构文档.md`
- Move: `doc/第二次沟通需求.md` to `doc/archive/第二次沟通需求.md`

Do not modify frontend code, crawler code, `README.md` at the repository root, or the design spec.

---

### Task 1: Prepare Archive Directory And Move Source Materials

**Files:**
- Create directory: `doc/archive/`
- Move: `doc/APSi_需求文档.md`
- Move: `doc/APSi MVP 完整需求规格书.md`
- Move: `doc/APSi_原型设计文档.md`
- Move: `doc/APSi_爬虫架构文档.md`
- Move: `doc/第二次沟通需求.md`

- [ ] **Step 1: Confirm the starting source files exist**

Run:

```bash
find doc -maxdepth 1 -type f -print | sort
```

Expected output includes exactly these source files:

```text
doc/APSi MVP 完整需求规格书.md
doc/APSi_原型设计文档.md
doc/APSi_爬虫架构文档.md
doc/APSi_需求文档.md
doc/第二次沟通需求.md
```

- [ ] **Step 2: Create the archive directory**

Run:

```bash
mkdir -p doc/archive
```

Expected: command exits successfully with no output.

- [ ] **Step 3: Move original source files into the archive**

Run:

```bash
git mv "doc/APSi_需求文档.md" "doc/archive/APSi_需求文档.md"
git mv "doc/APSi MVP 完整需求规格书.md" "doc/archive/APSi MVP 完整需求规格书.md"
git mv "doc/APSi_原型设计文档.md" "doc/archive/APSi_原型设计文档.md"
git mv "doc/APSi_爬虫架构文档.md" "doc/archive/APSi_爬虫架构文档.md"
git mv "doc/第二次沟通需求.md" "doc/archive/第二次沟通需求.md"
```

Expected: each command exits successfully with no output.

- [ ] **Step 4: Verify archive contents**

Run:

```bash
find doc -maxdepth 2 -type f -print | sort
```

Expected output:

```text
doc/archive/APSi MVP 完整需求规格书.md
doc/archive/APSi_原型设计文档.md
doc/archive/APSi_爬虫架构文档.md
doc/archive/APSi_需求文档.md
doc/archive/第二次沟通需求.md
```

- [ ] **Step 5: Commit archive move**

Run:

```bash
git add doc/archive
git commit -m "docs: archive original APSi source documents"
```

Expected: commit succeeds and reports five renamed files.

---

### Task 2: Create Documentation Index

**Files:**
- Create: `doc/README.md`

- [ ] **Step 1: Create `doc/README.md`**

Use `apply_patch` to add this exact file:

```markdown
# APSi 文档索引

本目录保存 APSi MVP 阶段的产品、原型和数据采集文档。

当前有效需求以 `APSi_PRD.md` 为准。原型和爬虫架构文档用于支撑 PRD 中的页面交互、数据采集和标准化要求。`archive/` 目录仅用于历史追溯，不作为当前开发依据。

## 当前文档

| 文档 | 用途 | 读者 |
| --- | --- | --- |
| `APSi_PRD.md` | MVP 主需求文档，定义产品目标、范围、功能需求、数据需求、非功能需求和验收标准 | 产品、开发、测试、合作沟通 |
| `APSi_Prototype.md` | 原型与交互支撑文档，定义信息架构、核心页面和 UI/UX 方向 | 产品、前端、设计 |
| `APSi_Crawler_Architecture.md` | 爬虫与数据采集支撑文档，定义数据源、抓取策略、标准化、存储、日志和监控 | 后端、数据采集、运维 |

## 阅读顺序

1. 先读 `APSi_PRD.md`，理解当前 MVP 要做什么、为什么做、如何验收。
2. 再读 `APSi_Prototype.md`，理解用户界面和关键交互。
3. 再读 `APSi_Crawler_Architecture.md`，理解数据如何采集、标准化和监控。
4. 只有需要追溯历史决策时才阅读 `archive/`。

## 历史材料

`archive/` 保留以下原始材料：

- `APSi_需求文档.md`
- `APSi MVP 完整需求规格书.md`
- `APSi_原型设计文档.md`
- `APSi_爬虫架构文档.md`
- `第二次沟通需求.md`

这些文件记录早期需求、第二次沟通结论、旧版原型和旧版爬虫架构。它们可以用于追溯需求来源，但不应覆盖当前 PRD 的判断。
```

- [ ] **Step 2: Verify README authority statement**

Run:

```bash
rg -n "当前有效需求以 `APSi_PRD.md` 为准|archive/.*历史追溯" doc/README.md
```

Expected output includes both authority and archive statements.

- [ ] **Step 3: Commit documentation index**

Run:

```bash
git add doc/README.md
git commit -m "docs: add APSi documentation index"
```

Expected: commit succeeds and creates `doc/README.md`.

---

### Task 3: Create The Authoritative MVP PRD

**Files:**
- Create: `doc/APSi_PRD.md`
- Reference: `doc/archive/APSi MVP 完整需求规格书.md`
- Reference: `doc/archive/第二次沟通需求.md`
- Reference: `doc/archive/APSi_需求文档.md`
- Reference: `doc/archive/APSi_原型设计文档.md`
- Reference: `doc/archive/APSi_爬虫架构文档.md`

- [ ] **Step 1: Create `doc/APSi_PRD.md`**

Use `apply_patch` to add this exact file:

```markdown
# APSi 产品需求文档（MVP）

## 1. 文档说明

### 1.1 文档目的

本文档定义 APSi（AI-powered Procurement Intelligence）MVP 阶段的产品需求、范围边界、核心功能、数据需求、非功能需求和验收标准。它是当前阶段产品沟通、开发实现和测试验收的主需求依据。

### 1.2 当前版本

- 版本：MVP PRD v1.0
- 更新日期：2026-05-18
- 来源材料：早期需求文档、第二次沟通纪要、MVP 完整需求规格书、原型设计文档、爬虫架构文档

### 1.3 适用范围

本文档适用于 APSi MVP 阶段。MVP 聚焦于美国政府公开招标信息的聚合、标准化、统一检索、详情查看和收藏管理。

### 1.4 关联支撑文档

- `APSi_Prototype.md`：页面信息架构、核心交互和 UI/UX 规范。
- `APSi_Crawler_Architecture.md`：爬虫、数据标准化、存储、错误处理和监控方案。
- `archive/`：历史需求与会议材料，仅用于追溯，不作为当前开发依据。

## 2. 产品概述

### 2.1 产品名称

APSi（AI-powered Procurement Intelligence）。

### 2.2 目标用户

主要目标用户是参与美国政府采购的供应商，尤其是缺少专门投标信息团队的中小企业。次要用户是负责系统维护、数据采集健康检查和问题排查的开发或管理员。

### 2.3 核心问题

美国联邦、州、县市政府的招标信息分散在多个门户和采购平台中。供应商需要跨站点注册、搜索、筛选和下载材料，信息获取效率低，覆盖不完整，且人工跟进成本高。

### 2.4 核心价值主张

APSi 通过统一聚合 SAM.gov 和 50 个州级政府采购门户的公开招标信息，让供应商在一个工作台完成跨地区搜索、筛选、查看详情、访问原始附件和保存关注项目，从而降低信息搜索成本并提高机会发现效率。

## 3. MVP 范围

### 3.1 本期目标

MVP 的目标是验证“公开政府招标信息统一聚合与检索”这一核心价值。系统应能采集公开来源数据，统一展示招标机会，并支持供应商完成从搜索到保存项目的核心流程。

### 3.2 本期包含

- SAM.gov 招标信息采集。
- 50 个美国州级政府采购门户的公开招标信息采集。
- 招标信息清洗、去重和基础标准化。
- 招标标题、描述、来源、发布日期、截止日期、金额、机构、原始链接和附件链接展示。
- 统一关键词搜索。
- 按地区、发布时间、截止日期、发布机构类型筛选。
- 招标列表、详情页和收藏夹。
- 邮箱密码注册、登录、登出和基础账户能力。
- 爬虫运行日志、失败记录和基础健康状态。

### 3.3 本期不包含

- 付费第三方平台数据接入。
- 对高反爬平台的深度模拟人工操作。
- 历史成交数据分析。
- 价格竞争分析。
- AI RFP Summary 或复杂附件内容解析。
- 供应商智能推荐。
- 面向移动端的完整深度体验。

### 3.4 关键约束与假设

- MVP 由单名全栈开发者主导完成，需要优先保证范围收敛和快速验证。
- 只采集公开可访问的政府门户信息，不绕过付费墙或严格访问控制。
- 不预设食品等特定产品类目，优先全量抓取公开招标信息，再保留原始分类并做基础映射。
- 附件在 MVP 阶段以原始链接或直接下载链接形式提供，不做 AI 深度解析。
- 某个州数据源失败不能影响其他数据源的更新。

## 4. 用户与场景

### 4.1 主要用户：供应商/中小企业

供应商希望用关键词和地区筛选快速找到可投标项目，查看截止日期、发布机构、项目金额、原始公告和附件链接，并保存值得后续跟进的机会。

### 4.2 次要用户：系统管理员/开发维护者

维护者需要确认各数据源是否按计划更新，识别抓取失败、页面结构变化和数据异常，保证用户看到的数据尽可能完整和及时。

### 4.3 核心使用路径

1. 用户注册或登录。
2. 用户进入统一搜索工作台。
3. 用户输入关键词，并按州、来源类型、发布时间或截止日期筛选。
4. 用户浏览招标列表并查看摘要、来源和关键日期。
5. 用户进入详情页查看完整描述、联系人、原始链接和附件链接。
6. 用户打开原始来源或附件链接继续处理投标材料。
7. 用户收藏感兴趣的项目，并在收藏夹中继续管理。

## 5. 功能需求

### 5.1 用户账户管理

| ID | 优先级 | 需求 |
| --- | --- | --- |
| ACC-01 | P0 | 用户可以使用邮箱和密码注册账户。 |
| ACC-02 | P0 | 用户可以使用邮箱和密码登录。 |
| ACC-03 | P0 | 用户可以登出当前账户。 |
| ACC-04 | P1 | 用户可以通过邮箱发起密码重置。 |
| ACC-05 | P1 | 用户可以查看基础账户信息并修改密码。 |

### 5.2 招标聚合与标准化

| ID | 优先级 | 需求 |
| --- | --- | --- |
| BAE-01 | P0 | 系统采集 SAM.gov 和 50 个州级政府采购门户的公开招标信息。 |
| BAE-02 | P0 | 系统不按产品类目预先限制采集范围，优先全量抓取公开招标信息。 |
| BAE-03 | P0 | 系统将不同来源数据标准化为统一招标字段。 |
| BAE-04 | P0 | 系统保留原始站点分类，并可做基础分类映射。 |
| BAE-05 | P0 | 系统提取并展示附件原始链接或直接下载链接。 |
| BAE-06 | P0 | 系统对重复招标执行去重或更新，避免同一来源同一公告重复展示。 |
| BAE-07 | P0 | 系统记录每个数据源的抓取状态、抓取数量、失败原因和运行时间。 |
| BAE-08 | P1 | 对需要 JavaScript 渲染或基础防护的政府门户，系统可使用浏览器模拟方案抓取。 |

### 5.3 统一搜索与筛选

| ID | 优先级 | 需求 |
| --- | --- | --- |
| SRCH-01 | P0 | 用户可以通过统一搜索框搜索招标标题和描述。 |
| SRCH-02 | P0 | 用户可以按地区筛选，包含全美、SAM.gov/Federal 和特定州。 |
| SRCH-03 | P0 | 用户可以按发布时间范围筛选。 |
| SRCH-04 | P0 | 用户可以按截止日期范围筛选。 |
| SRCH-05 | P0 | 用户可以按发布机构类型筛选 Federal 或 State。 |
| SRCH-06 | P1 | 搜索结果支持按最新发布时间、截止日期或相关性排序。 |
| SRCH-07 | P0 | 搜索结果支持分页，每页默认展示 20 条，并支持 50 条分页尺寸。 |

### 5.4 招标列表展示

| ID | 优先级 | 需求 |
| --- | --- | --- |
| LIST-01 | P0 | 列表展示招标标题、来源、发布机构、发布日期、截止日期和金额。 |
| LIST-02 | P0 | 列表展示描述摘要，帮助用户快速判断是否相关。 |
| LIST-03 | P0 | 列表展示来源徽章，例如 SAM.gov 或 State of CA。 |
| LIST-04 | P0 | 用户可以从列表进入招标详情。 |
| LIST-05 | P0 | 用户可以在列表中收藏或取消收藏招标。 |

### 5.5 招标详情展示

| ID | 优先级 | 需求 |
| --- | --- | --- |
| DETAIL-01 | P0 | 详情页展示完整标题、描述、来源、发布机构、发布日期、截止日期和金额。 |
| DETAIL-02 | P0 | 详情页展示原始公告链接，并在新窗口或新标签打开。 |
| DETAIL-03 | P0 | 详情页展示联系人信息。 |
| DETAIL-04 | P0 | 详情页展示附件链接列表。 |
| DETAIL-05 | P0 | 用户可以在详情页收藏或取消收藏招标。 |
| DETAIL-06 | P1 | 详情页保留原文换行或基础 Markdown 格式，提升长文本可读性。 |

### 5.6 收藏夹管理

| ID | 优先级 | 需求 |
| --- | --- | --- |
| SAVE-01 | P0 | 用户可以查看已收藏的招标项目。 |
| SAVE-02 | P0 | 用户可以从收藏夹进入招标详情。 |
| SAVE-03 | P0 | 用户可以从收藏夹移除不再关注的项目。 |

### 5.7 爬虫运行日志与基础监控

| ID | 优先级 | 需求 |
| --- | --- | --- |
| OPS-01 | P0 | 系统记录每次抓取任务的来源、运行时间、状态、抓取条数和错误信息。 |
| OPS-02 | P0 | 网络超时或非成功响应时，系统执行有限次数自动重试。 |
| OPS-03 | P1 | 当关键字段为空比例异常升高时，系统记录页面结构可能变化的错误。 |
| OPS-04 | P1 | 系统可展示或提供最近 24 小时各来源的抓取健康状态。 |

## 6. 数据需求

### 6.1 数据来源

MVP 数据来源包括 SAM.gov 和 50 个美国州级政府采购门户。付费第三方平台、需要严格登录授权的平台和高反爬平台不属于 MVP 数据范围。

### 6.2 标准字段

标准招标数据至少包含：

- `id`：系统内部唯一 ID。
- `source`：来源标识，例如 `sam_gov`、`ca_portal`。
- `title`：招标标题。
- `description`：招标描述。
- `original_category`：原始站点分类。
- `amount_min` 和 `amount_max`：金额范围，来源未提供时可为空。
- `published_date`：发布日期。
- `deadline_date`：截止日期。
- `issuer_name`：发布机构名称。
- `issuer_type`：发布机构类型，取值为 `federal` 或 `state`。
- `source_url`：原始公告链接。
- `attachments`：附件名称与链接列表。
- `is_active`：是否仍为活跃招标。

### 6.3 附件链接处理

MVP 只要求提取附件原始链接或直接下载 URL。系统不要求下载、解析、摘要或理解 PDF、Word、Excel 等附件内容。

### 6.4 去重与更新策略

系统应优先使用来源标识和原始站点唯一 ID 去重。若来源未提供稳定唯一 ID，可使用来源、标题、发布机构、截止日期和原始链接组合判断同一招标。重复数据应更新现有记录，而不是创建重复展示项。

### 6.5 数据时效性

SAM.gov 可以高频增量更新。州级门户至少每日更新一次。MVP 目标是公开新增招标信息在 24 小时内反映到统一数据库中。

## 7. 页面与交互需求

### 7.1 登录/注册

登录和注册页面采用简单居中布局，包含 APSi 标识、邮箱输入、密码输入、登录或注册按钮和忘记密码入口。登录成功后进入主搜索工作台。

### 7.2 主搜索工作台

主搜索工作台是 MVP 的核心页面，采用左侧筛选和右侧列表布局。顶部提供全局搜索框和用户菜单。左侧筛选包含地区、截止日期、发布日期和发布机构类型。右侧列表展示结果数量、排序方式、招标卡片和分页控件。

### 7.3 招标详情页

招标详情页用于承载完整招标信息，建议使用独立页面或全屏模态。页面包含返回入口、标题、收藏按钮、查看原文按钮、核心元数据、完整描述和附件链接列表。

### 7.4 我的收藏

我的收藏页面展示用户已保存的招标项目，列表样式与主搜索结果保持一致。用户可以进入详情或直接移除收藏。

### 7.5 响应式优先级

MVP 优先保证桌面端体验，因为目标用户主要在办公电脑上搜索和处理招标信息。移动端需要支持基础浏览，但不是 MVP 的主要优化对象。

## 8. 非功能需求

### 8.1 性能

- 页面首屏加载目标不超过 2 秒。
- 常规搜索请求 P95 响应目标不超过 1 秒。
- 列表分页避免一次性加载大量数据。

### 8.2 可用性

- 用户应能在一个工作台完成搜索、筛选、查看详情和收藏。
- 招标截止日期、来源和原始链接必须醒目。
- 数据为空、搜索无结果、抓取失败和附件缺失时应有清晰状态提示。

### 8.3 安全性

- 用户密码必须使用强哈希算法存储。
- 生产环境必须使用 HTTPS。
- 用户只能访问自己的收藏数据。

### 8.4 可维护性

- 各来源爬虫应模块化隔离，单个来源失败不能阻塞全局任务。
- 数据标准化逻辑应独立于页面展示。
- 抓取日志需要支持定位来源级失败。

### 8.5 合规与抓取边界

- 只采集公开可访问信息。
- 遵守公开网站的访问限制和合理请求频率。
- 不绕过付费墙、验证码或明确禁止自动化访问的控制措施。

## 9. 验收标准

### 9.1 数据覆盖

- 系统能够稳定采集并展示 SAM.gov 最新公开招标信息。
- 系统能够稳定采集并展示至少 80%（40 个以上）州级政府采购门户的最新公开招标信息。

### 9.2 检索体验

- 用户可以通过关键词和州筛选找到相关招标。
- 用户可以按发布时间和截止日期过滤结果。
- 搜索结果展示关键元数据，页面无明显卡顿。

### 9.3 核心流程

用户可以完成以下路径：

1. 注册或登录。
2. 搜索招标。
3. 使用筛选器缩小结果。
4. 查看招标详情。
5. 打开原始公告或附件链接。
6. 收藏招标。
7. 在收藏夹中查看并移除收藏。

### 9.4 爬虫稳定性

- 每个数据源的抓取任务有运行日志。
- 某个州数据源失败时，其他州和 SAM.gov 任务仍可继续运行。
- 抓取失败有错误信息记录，便于后续排查。

### 9.5 文档一致性

- `APSi_PRD.md` 是当前需求依据。
- `APSi_Prototype.md` 支撑页面与交互需求。
- `APSi_Crawler_Architecture.md` 支撑数据采集与标准化需求。
- `archive/` 只用于历史追溯。

## 10. Phase 2 路线图

### 10.1 历史成交数据与价格竞争分析

后续版本可采集和解析历史中标数据、报价记录和 tabulation of bids，帮助供应商理解竞争对手报价和价格趋势。

### 10.2 AI RFP Summary

后续版本可下载并解析 PDF、Word、Excel 等复杂附件，通过 AI 提取关键需求、交付条件、合规要求和风险点。

### 10.3 供应商智能推荐

后续版本可建立供应商画像，并结合项目相似度、历史胜率、报价区间和履约能力，为招标推荐潜在供应商。

### 10.4 付费/高反爬平台接入评估

后续版本可评估付费第三方平台、人工授权数据源或商业数据采购方案，但不作为 MVP 的必要条件。
```

- [ ] **Step 2: Verify PRD preserves key decisions**

Run:

```bash
rg -n "SAM.gov|50 个美国州级|付费第三方|不预设|附件|AI RFP Summary|80%" doc/APSi_PRD.md
```

Expected: output includes matches for MVP data sources, excluded paid platforms, no category pre-filtering, attachment link handling, Phase 2 AI summary, and 80% state coverage.

- [ ] **Step 3: Verify PRD has no unresolved markers**

Run:

```bash
rg -n "TB[D]|TO[D]O|待[定]|未[定]|占[位]|placeholde[r]|[?][?]" doc/APSi_PRD.md || true
```

Expected: no output.

- [ ] **Step 4: Commit PRD**

Run:

```bash
git add doc/APSi_PRD.md
git commit -m "docs: consolidate APSi MVP PRD"
```

Expected: commit succeeds and creates `doc/APSi_PRD.md`.

---

### Task 4: Create Prototype Support Document

**Files:**
- Create: `doc/APSi_Prototype.md`
- Reference: `doc/archive/APSi_原型设计文档.md`

- [ ] **Step 1: Create `doc/APSi_Prototype.md` from the archived prototype**

Run:

```bash
cp "doc/archive/APSi_原型设计文档.md" "doc/APSi_Prototype.md"
```

Expected: command exits successfully with no output.

- [ ] **Step 2: Update the title and support note**

Use `apply_patch` to change the top of `doc/APSi_Prototype.md` from:

```markdown
# APSi 原型设计文档 (MVP 阶段)
```

to:

```markdown
# APSi 原型与交互支撑文档（MVP）

本文档支撑 `APSi_PRD.md` 中的页面与交互需求，描述 APSi MVP 的信息架构、核心页面、关键交互和 UI/UX 方向。当前有效需求以 `APSi_PRD.md` 为准。
```

- [ ] **Step 3: Verify prototype document references the PRD**

Run:

```bash
rg -n "支撑 `APSi_PRD.md`|当前有效需求以 `APSi_PRD.md` 为准" doc/APSi_Prototype.md
```

Expected output includes the support note and authority statement.

- [ ] **Step 4: Commit prototype support document**

Run:

```bash
git add doc/APSi_Prototype.md
git commit -m "docs: add APSi prototype support document"
```

Expected: commit succeeds and creates `doc/APSi_Prototype.md`.

---

### Task 5: Create Crawler Architecture Support Document

**Files:**
- Create: `doc/APSi_Crawler_Architecture.md`
- Reference: `doc/archive/APSi_爬虫架构文档.md`

- [ ] **Step 1: Create `doc/APSi_Crawler_Architecture.md` from the archived architecture document**

Run:

```bash
cp "doc/archive/APSi_爬虫架构文档.md" "doc/APSi_Crawler_Architecture.md"
```

Expected: command exits successfully with no output.

- [ ] **Step 2: Update the title and support note**

Use `apply_patch` to change the top of `doc/APSi_Crawler_Architecture.md` from:

```markdown
# APSi 爬虫架构文档 (MVP 阶段)
```

to:

```markdown
# APSi 爬虫与数据采集架构支撑文档（MVP）

本文档支撑 `APSi_PRD.md` 中的数据采集、标准化、存储、错误处理和监控需求，描述 APSi MVP 阶段的爬虫架构方案。当前有效需求以 `APSi_PRD.md` 为准。
```

- [ ] **Step 3: Verify crawler document references the PRD**

Run:

```bash
rg -n "支撑 `APSi_PRD.md`|当前有效需求以 `APSi_PRD.md` 为准" doc/APSi_Crawler_Architecture.md
```

Expected output includes the support note and authority statement.

- [ ] **Step 4: Commit crawler support document**

Run:

```bash
git add doc/APSi_Crawler_Architecture.md
git commit -m "docs: add APSi crawler architecture support document"
```

Expected: commit succeeds and creates `doc/APSi_Crawler_Architecture.md`.

---

### Task 6: Verify Final Documentation Set

**Files:**
- Verify: `doc/README.md`
- Verify: `doc/APSi_PRD.md`
- Verify: `doc/APSi_Prototype.md`
- Verify: `doc/APSi_Crawler_Architecture.md`
- Verify: `doc/archive/*`

- [ ] **Step 1: Verify final file layout**

Run:

```bash
find doc -maxdepth 2 -type f -print | sort
```

Expected output:

```text
doc/APSi_Crawler_Architecture.md
doc/APSi_PRD.md
doc/APSi_Prototype.md
doc/README.md
doc/archive/APSi MVP 完整需求规格书.md
doc/archive/APSi_原型设计文档.md
doc/archive/APSi_爬虫架构文档.md
doc/archive/APSi_需求文档.md
doc/archive/第二次沟通需求.md
```

- [ ] **Step 2: Verify top-level doc directory has no old current-level documents**

Run:

```bash
find doc -maxdepth 1 -type f -print | sort
```

Expected output:

```text
doc/APSi_Crawler_Architecture.md
doc/APSi_PRD.md
doc/APSi_Prototype.md
doc/README.md
```

- [ ] **Step 3: Verify all current documents point to the PRD authority model**

Run:

```bash
rg -n "当前有效需求以 `APSi_PRD.md` 为准|APSi_PRD.md" doc/README.md doc/APSi_Prototype.md doc/APSi_Crawler_Architecture.md
```

Expected: matches appear in all three files.

- [ ] **Step 4: Verify no unresolved markers exist in current docs**

Run:

```bash
rg -n "TB[D]|TO[D]O|待[定]|未[定]|占[位]|placeholde[r]|[?][?]" doc/README.md doc/APSi_PRD.md doc/APSi_Prototype.md doc/APSi_Crawler_Architecture.md || true
```

Expected: no output.

- [ ] **Step 5: Verify Markdown whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 6: Review staged and unstaged changes**

Run:

```bash
git status --short
```

Expected: no unexpected files outside `doc/` and the plan file.

- [ ] **Step 7: Commit verification cleanup if there are remaining documentation changes**

Run this only if Task 6 fixes or cleanup changes were made:

```bash
git add doc
git commit -m "docs: verify APSi documentation structure"
```

Expected: commit succeeds only when there are remaining changes. If `git status --short` is clean, skip this step.

---

## Self-Review Checklist

- Spec coverage: Tasks 1-6 cover the target directory structure, document responsibilities, PRD structure, migration rules, preserved requirements, and acceptance criteria from `docs/superpowers/specs/2026-05-18-apsi-docs-reorganization-design.md`.
- Placeholder scan: The plan contains no open-ended implementation markers for future authors to invent.
- Type and path consistency: All paths use the approved `doc/` layout and current documents consistently reference `APSi_PRD.md`.
