## APSi MVP 完整需求规格书 (V2 - 基于第二次沟通更新)

### **一、执行摘要**

**产品名称**：APSi（AI-powered Procurement Intelligence）
**目标用户**：参与政府采购的各类供应商（特别是中小企业）
**核心价值主张**：
- 解决美国各州县政府招标信息高度碎片化的问题
- 提供 50 个州及联邦政府（SAM.gov）招标信息的统一查询服务
- 极大提升供应商寻找跨平台招标信息的效率，降低人工搜索成本

**MVP 范围与核心决策（基于第二次沟通）**：
- **数据范围**：50 个州政府门户网站 + SAM.gov（暂不包含反爬严格的付费第三方平台）。
- **功能范围**：**只聚焦于“招标聚合引擎”（信息抓取与统一展示）**。暂不预设产品类目，优先全量抓取所有公开信息再进行分类。
- **暂缓功能**：历史数据分析、价格竞争分析、附件深度解析（AI RFP 摘要）及供应商推荐功能延后至第二期（Phase 2）。
- **资源配置**：第一期 MVP 版本由单名单人技术开发者完成，聚焦于核心功能快速落地验证。

---

### **二、核心功能模块详细规格 (MVP 阶段)**

#### **2.1 Bid Aggregation Engine（招标聚合引擎）**

**功能概述**
从 SAM.gov 和 50 个州级公共采购门户自动抓取招标数据，进行清洗和基础标准化。供应商可以通过统一的平台搜索、浏览全美的招标机会及原始附件链接。

**业务流程图**

```
[每日定时任务 / 增量抓取] 
  ↓
[SAM.gov API + 50州门户爬虫] (直接抓取，规避高反爬付费平台)
  ↓
[数据标准化层] (全量提取标题、描述、金额、截止日期、附件链接等)
  ↓
[入库] (PostgreSQL + 全文检索支持)
  ↓
[统一用户仪表板] 
  ↓
[关键词搜索、按州/截止日期筛选、结果展示]
```

**功能需求**

| 需求 ID | 需求描述       | 优先级 | 规则/约束                                                    |
| ------- | -------------- | ------ | ------------------------------------------------------------ |
| BAE-01  | **数据源集成** | P0     | SAM.gov：通过官方 API 或直接抓取，保证高成功率。<br>50州门户：直接抓取公开页面数据。<br>暂不接入 Justin 等付费第三方平台。 |
| BAE-02  | **全量抓取策略** | P0     | 不预设食品等特定产品类目限制，全量抓取所有公开的招标信息，最大化覆盖面，抓取后再考虑基础分类。 |
| BAE-03  | **招标标准化** | P0     | 规范提取核心字段：标题、描述、发布者（州/联邦）、截止日期、金额（如有）、原始URL、附件下载链接。<br>因各州分类方法不一，保留原始分类信息并做基础映射。 |
| BAE-04  | **附件处理**   | P0     | 抓取并提供招标文件（如 PDF/Word/Excel）的原链接或直接下载链接。MVP 阶段暂不对复杂附件内容进行 AI 深度解析。 |
| BAE-05  | **统一查询与筛选** | P0   | 支持用户基于以下维度筛选：<br>- 地区（全美/特定州）<br>- 关键词搜索（标题/描述匹配）<br>- 截止日期范围 |
| BAE-06  | **反爬虫策略** | P1     | 分层处理：政府门户反爬级别较低，可直接请求；对有基础防护的站点采用模拟浏览器技术或代理 IP。极端情况评估第三方数据。 |
| BAE-07  | **错误与重试** | P0     | 爬虫失败自动重试机制；记录各州站点的健康状态、抓取成功率和每日更新量（预计各州每日 <100 条）。 |

**数据模型**

```sql
CREATE TABLE bids (
  id UUID PRIMARY KEY,
  source VARCHAR(50),  -- 'sam_gov', 'ca_portal', 'tx_portal' 等51个来源
  title VARCHAR(500) NOT NULL,
  description TEXT,
  original_category VARCHAR(200), -- 原始站点分类名称
  amount_min DECIMAL(15,2),
  amount_max DECIMAL(15,2),
  published_date TIMESTAMP,
  deadline_date TIMESTAMP NOT NULL,
  issuer_name VARCHAR(200),
  issuer_type VARCHAR(50),  -- 'federal', 'state'
  source_url TEXT,
  attachments JSONB,  -- 附件列表 [{"name": "document.pdf", "url": "https..."}]
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  INDEX idx_deadline, idx_source
);

CREATE TABLE scraper_logs (
  id UUID PRIMARY KEY,
  source VARCHAR(50),
  run_time TIMESTAMP,
  status VARCHAR(20), -- 'success', 'failed', 'partial'
  items_scraped INT,
  error_message TEXT
);
```

**API 规范**

```text
GET /api/v1/bids/search
Query Parameters:
  - page: int (default=1)
  - limit: int (default=20)
  - keyword: string
  - states: varchar[] (comma-separated, e.g., "CA,TX,NY")
  - published_after: ISO8601 date
  - deadline_before: ISO8601 date

Response:
{
  "total_count": 15000,
  "results": [
    {
      "id": "uuid",
      "title": "State of CA - IT Services",
      "source": "ca_portal",
      "deadline_date": "2026-05-15T23:59:59Z",
      ...
    }
  ]
}

GET /api/v1/bids/{bid_id}
Response: 详细招标信息及 attachments 附件下载列表
```

---

### **三、第二期规划 (Phase 2 Roadmap)**

根据第二次会议决策，为确保 MVP 快速上线，以下高阶功能延后至系统上线稳定后（或引入更多研发资源时）迭代：

#### **3.1 历史成交数据与价格竞争分析**
- **背景**：帮助用户不仅“找到”招标，还能基于历史成交表（Tabulation of bids）“赢下”招标。
- **规划**：抓取并解析过往中标数据，提供竞争对手的报价分析和价格趋势，辅助优化定价策略。

#### **3.2 AI RFP Summary（附件深度解析与摘要）**
- **背景**：各州招标文件附件结构复杂，且下载解析技术难度大。
- **规划**：集成大语言模型（如 GPT-4o），自动解析复杂的 PDF/Excel 附件，提取关键需求、交付条件、合规要求和风险点。

#### **3.3 Supplier Connection（供应商智能推荐）**
- **规划**：建立结构化的供应商画像，利用多因子算法（相似度 + 历史胜率 + 价格匹配）为特定招标推荐最合适的供应商池。

---

### **四、系统级需求 (MVP 阶段)**

#### **4.1 用户认证与基础功能**
- 支持供应商通过邮箱/密码注册与登录。
- 提供简单的仪表板供用户保存/收藏特定的招标信息。

#### **4.2 性能与架构**
- **前端展示**：快速输出原型并实现响应式 Web 界面。
- **爬虫架构**：保证 50 个州及联邦数据源的定时任务可靠执行，支持单点故障隔离，某个州的爬虫失败不影响其他州数据更新。
- **部署**：MVP 阶段优先采用轻量级部署方案，适应单人开发和快速迭代的节奏。

---

### **五、验收标准和关键指标 (MVP)**

**成功指标与验收标准**
- **覆盖率**：能够稳定抓取并展示 SAM.gov 以及至少 80% (40+ 个) 州门户网站的最新公开招标信息。
- **可用性**：提供一个直观的统一查询界面，用户无需跳转 50 个不同的网站即可检索到目标信息。
- **时效性**：各州每日新增的招标信息（预计单州 <100 条）能及时反映在统一数据库中。

**项目约束**
- **团队限制**：第一期 MVP 不进行额外招聘，由现有 1 名 AI/技术开发者主导完成全栈（爬虫+后端+前端展示）开发。
- **时间期望**：尽快输出原型交互并验证核心抓取能力。
