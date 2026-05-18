# APSi 爬虫架构文档 (MVP 阶段)

## 1. 架构概述

APSi 平台 MVP 阶段的爬虫架构，旨在**全量、稳定、定时**地从 50 个美国州级公共采购门户及联邦 SAM.gov 抓取招标信息。

考虑到 MVP 阶段的资源限制（单名开发者）与反爬虫风险，架构设计遵循以下原则：
- **分层策略**：优先直接抓取（API/HTML 解析），对有基础防护的站点使用模拟浏览器。
- **模块化与隔离**：各州爬虫脚本独立，单点故障不影响全局。
- **增量更新**：支持基于时间戳的增量拉取，减少服务器压力和被封禁风险。
- **无状态设计**：爬虫节点可随时重启或横向扩展。

---

## 2. 技术栈选型

| 组件 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **编程语言** | Python 3.10+ | 爬虫生态最完善的语言。 |
| **核心框架** | Scrapy / BeautifulSoup4 | Scrapy 用于结构化站点的批量抓取；BS4 用于简单页面的快速解析。 |
| **动态渲染/反爬** | Playwright (或 Selenium) | 应对需要执行 JavaScript 或有基础 Cloudflare/Captcha 防护的站点。 |
| **任务调度** | Celery + Redis (或 APScheduler) | Celery 提供分布式任务队列；APScheduler 适合轻量级单机定时任务。 |
| **数据存储** | PostgreSQL 15+ | 关系型数据库，支持 JSONB（存附件列表）和全文检索（Full-Text Search）。 |
| **日志与监控** | Python `logging` + Sentry | 记录抓取成功率、失败原因，并在连续失败时触发告警。 |

---

## 3. 架构组件设计

### 3.1 调度器 (Scheduler)
- **职责**：按设定的频率（如每天凌晨 2 点、每 4 小时一次）触发各个数据源的抓取任务。
- **策略**：
  - **SAM.gov**：调用官方 API，支持高频增量拉取（如每 2 小时）。
  - **州级门户**：每日 1 次全量或增量拉取（部分州由于更新频率低，每日抓取即可）。
- **任务分发**：将抓取指令（包含 `source_id`, `start_date`, `end_date` 等参数）推送到消息队列（Redis/RabbitMQ）。

### 3.2 爬虫节点 (Scraper Nodes / Spiders)
- **职责**：执行具体的网页请求、HTML 解析或 API 调用。
- **类型**：
  - **API 型 Spider**：直接请求 JSON/XML 数据（如 SAM.gov，或某些州开放的 OpenAPI）。
  - **静态 HTML Spider**：使用 `requests` + `BeautifulSoup`，解析 DOM 树提取字段。
  - **动态渲染 Spider**：使用 `Playwright` 驱动无头浏览器（Headless Browser），等待页面渲染完成后提取数据，或模拟点击“下一页”。
- **防封禁措施 (Anti-Scraping)**：
  - **User-Agent 轮换**：使用真实的浏览器 UA 列表。
  - **请求延迟 (Delay)**：遵守 `robots.txt`，在请求之间加入随机的 `sleep`（例如 1-3 秒）。
  - **代理 IP 池 (Proxy Pool)**：若某个州封锁了服务器 IP，则启用代理池进行轮换（MVP 阶段视具体情况启用）。

### 3.3 数据清洗与标准化层 (Data Normalization Layer)
- **职责**：将各个爬虫节点抓取到的异构数据，转换为统一的 `bids` 数据模型格式。
- **处理逻辑**：
  - **日期格式化**：将不同格式的日期（如 "04/15/2026", "April 15th, 2026"）统一转换为 ISO 8601 标准的 `TIMESTAMP`。
  - **金额提取**：从文本中正则匹配出预估金额（如有），存储为 `amount_min` 和 `amount_max`。
  - **分类映射**：保留原始站点分类 (`original_category`)。
  - **附件处理**：提取所有附件的直链（URL）和文件名，组装成 JSON 数组存入 `attachments` 字段。
  - **去重机制**：使用 `source` + 原始站点的唯一 ID（或标题 Hash）作为业务主键，执行 `UPSERT`（插入或更新）操作，避免重复数据。

### 3.4 存储层 (Storage Layer)
- **PostgreSQL**：
  - `bids` 表：存储清洗后的核心招标数据。建立 `idx_deadline`, `idx_source` 索引加速查询。
  - `scraper_logs` 表：记录每次抓取任务的运行时间、来源、抓取条数、状态（成功/失败/部分失败）及错误堆栈。

---

## 4. 数据流向 (Data Flow)

```text
[Cron / APScheduler] 触发定时任务
        │
        ▼
[Celery Task Queue] 任务入队 (如 task_scrape_ca, task_scrape_sam)
        │
        ▼
[Celery Worker (Scraper Nodes)] 执行任务
        ├─ API 请求 -> SAM.gov
        ├─ Requests/BS4 -> 静态州门户
        └─ Playwright -> 动态州门户
        │
        ▼
获取 Raw Data (HTML / JSON)
        │
        ▼
[Data Normalization Layer] 清洗、格式化、提取附件链接
        │
        ▼
[UPSERT Logic] 业务主键去重检测
        │
        ▼
[PostgreSQL Database] 存入 bids 表，记录 scraper_logs
```

---

## 5. 错误处理与监控 (Error Handling & Monitoring)
- **重试机制**：网络超时或非 200 响应时，采用指数退避算法（如 2s -> 4s -> 8s）自动重试 3 次。
- **页面结构变更**：若抓取结果的关键字段（如标题、截止日期）为空比例异常升高，判定为“页面结构可能已变更”，记录 `partial_failure` 日志并触发 Sentry 告警，提示开发者人工介入修复 XPath/CSS Selector。
- **健康检查**：提供一个简单的 `/api/health/scrapers` 接口或内部 Dashboard，展示各州爬虫最近 24 小时的成功率和抓取数量。
