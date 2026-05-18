# APSi Documentation Reorganization Design

## 1. Purpose

This design defines how to reorganize the APSi project documentation under `doc/` so it can serve both product communication and implementation work.

The current `doc/` directory contains overlapping source materials:

- `APSi_需求文档.md`: earlier traditional SRS-style requirements.
- `APSi MVP 完整需求规格书.md`: newer MVP requirements updated from the second discussion.
- `第二次沟通需求.md`: meeting notes and requirement decisions.
- `APSi_原型设计文档.md`: prototype, page structure, and interaction notes.
- `APSi_爬虫架构文档.md`: crawler and data ingestion architecture.

The reorganization will create one authoritative PRD, keep prototype and crawler details as supporting documents, and move original materials into an archive for traceability.

## 2. Goals

- Provide a single current requirements entry point for product, development, and testing.
- Preserve original documents for historical traceability.
- Separate product requirements from implementation detail.
- Make the `doc/` directory easy to navigate for collaborators.
- Keep the scope focused on documentation reorganization only.

## 3. Non-Goals

- Do not implement product features.
- Do not change frontend or crawler code.
- Do not remove historical source documents.
- Do not introduce detailed implementation plans in the PRD.
- Do not treat archived files as current execution references.

## 4. Target Directory Structure

```text
doc/
├── README.md
├── APSi_PRD.md
├── APSi_Prototype.md
├── APSi_Crawler_Architecture.md
└── archive/
    ├── APSi_需求文档.md
    ├── APSi MVP 完整需求规格书.md
    ├── APSi_原型设计文档.md
    ├── APSi_爬虫架构文档.md
    └── 第二次沟通需求.md
```

## 5. Document Responsibilities

### `doc/README.md`

Acts as the documentation index. It explains:

- Which document to read first.
- Which document is authoritative for current requirements.
- Which documents are supporting references.
- That `archive/` contains historical source materials only.

The README will state that the current effective documentation order is:

1. `APSi_PRD.md`
2. `APSi_Prototype.md`
3. `APSi_Crawler_Architecture.md`
4. `archive/` historical materials

### `doc/APSi_PRD.md`

Acts as the single authoritative product requirements document for MVP work.

It will cover:

- Document purpose and scope.
- Product overview and value proposition.
- MVP scope, exclusions, constraints, and assumptions.
- User types and core use paths.
- Functional requirements.
- Data requirements.
- Page and interaction requirements.
- Non-functional requirements.
- Acceptance criteria.
- Phase 2 roadmap.

The PRD will keep technical detail at the boundary level. It will describe what the product needs and how it will be accepted, while detailed crawler implementation remains in the crawler architecture document.

### `doc/APSi_Prototype.md`

Acts as the supporting document for information architecture, page layout, and user interaction.

It will be based on `APSi_原型设计文档.md`, lightly reorganized and renamed. It will preserve:

- Site map.
- Login and registration page behavior.
- Search workspace structure.
- Bid list card content.
- Bid detail page behavior.
- Saved bids page behavior.
- UI/UX guidance and desktop-first priority.

It will include a short note that this document supports the page and interaction requirements in `APSi_PRD.md`.

### `doc/APSi_Crawler_Architecture.md`

Acts as the supporting document for data ingestion, normalization, storage, monitoring, and crawler reliability.

It will be based on `APSi_爬虫架构文档.md`, lightly reorganized and renamed. It will preserve:

- Layered crawling strategy.
- Scheduler responsibilities.
- Scraper node types.
- Data normalization responsibilities.
- Storage design.
- Data flow.
- Error handling, retry, and monitoring expectations.

It will include a short note that this document supports the data acquisition and normalization requirements in `APSi_PRD.md`.

### `doc/archive/`

Contains original source materials. These files remain available for traceability but are no longer current execution references.

No archived content should be deleted during this reorganization.

## 6. PRD Chapter Structure

`APSi_PRD.md` will use this structure:

```text
# APSi 产品需求文档（MVP）

1. 文档说明
   - 文档目的
   - 当前版本
   - 适用范围
   - 关联支撑文档

2. 产品概述
   - 产品名称
   - 目标用户
   - 核心问题
   - 核心价值主张

3. MVP 范围
   - 本期目标
   - 本期包含
   - 本期不包含
   - 关键约束与假设

4. 用户与场景
   - 主要用户：供应商/中小企业
   - 次要用户：系统管理员/开发维护者
   - 核心使用路径

5. 功能需求
   - 用户账户管理
   - 招标聚合与标准化
   - 统一搜索与筛选
   - 招标列表展示
   - 招标详情展示
   - 收藏夹管理
   - 爬虫运行日志与基础监控

6. 数据需求
   - 数据来源
   - 标准字段
   - 附件链接处理
   - 去重与更新策略
   - 数据时效性

7. 页面与交互需求
   - 登录/注册
   - 主搜索工作台
   - 招标详情页
   - 我的收藏
   - 响应式优先级

8. 非功能需求
   - 性能
   - 可用性
   - 安全性
   - 可维护性
   - 合规与抓取边界

9. 验收标准
   - 数据覆盖
   - 检索体验
   - 核心流程
   - 爬虫稳定性
   - 文档一致性

10. Phase 2 路线图
   - 历史成交数据与价格竞争分析
   - AI RFP Summary
   - 供应商智能推荐
   - 付费/高反爬平台接入评估
```

## 7. Migration Rules

- Extract latest MVP decisions from `APSi MVP 完整需求规格书.md` and `第二次沟通需求.md`.
- Reuse clearer SRS phrasing from `APSi_需求文档.md` where it improves precision.
- Keep the PRD focused on requirements, boundaries, and acceptance criteria.
- Preserve prototype details in `APSi_Prototype.md` rather than duplicating all UI detail in the PRD.
- Preserve crawler architecture details in `APSi_Crawler_Architecture.md` rather than duplicating all implementation detail in the PRD.
- Move the original source documents into `doc/archive/` after their current content has been represented in the new document set.
- Do not delete original documents.
- Use the new English filenames for current documents to make paths consistent and easy to reference.

## 8. Key Requirements To Preserve

- APSi MVP focuses on government bid aggregation and search.
- MVP data sources are SAM.gov and 50 US state government procurement portals.
- Paid third-party platforms and strict anti-scraping platforms are out of MVP scope.
- MVP should not restrict data to a specific product category such as food; it should prioritize broad public bid coverage.
- Attachments are exposed as source links or direct download URLs in MVP.
- AI attachment parsing, historical award analysis, price competition analysis, and supplier recommendation are Phase 2 items.
- MVP is expected to be feasible for a single full-stack developer.
- The core user journey is registration, login, search, filter, inspect detail, open source or attachment, and save bid.
- Acceptance should include data coverage, search usability, core workflow completion, crawler reliability, and documentation consistency.

## 9. Acceptance Criteria For The Documentation Reorganization

- `doc/README.md` exists and clearly identifies `APSi_PRD.md` as the authoritative current requirements document.
- `doc/APSi_PRD.md` exists and consolidates current MVP requirements without unresolved placeholders.
- `doc/APSi_Prototype.md` exists and supports the PRD page and interaction sections.
- `doc/APSi_Crawler_Architecture.md` exists and supports the PRD data ingestion sections.
- `doc/archive/` exists and contains the original source documents.
- The new document set does not contradict the key MVP decisions from the second discussion.
- The old current-level documents are not left beside the new current documents in a way that makes ownership ambiguous.

## 10. Review Notes

Before implementation, review this design for:

- Placeholder text.
- Contradictions between directory structure and migration rules.
- Ambiguous document ownership.
- Scope creep beyond documentation work.

Implementation should begin only after the user approves this design spec.
