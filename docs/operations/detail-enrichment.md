# 详情补全（Scrapling extractor）运维

## 组件

- `services/scrapling-extractor`：解析 sidecar（Python 3.12，scrapling 0.4.15 基础包，无抓取/反检测组件）。只接收 HTML 字符串并返回解析结果，自身不发起任何外部请求。
- `crawler/apsi_crawler/enrichment.py`：`fetch-task` 内的可选补全阶段，默认关闭、失败开放（任何异常只计入 `failed`，不会让整次抓取失败）。
- 管理端 → 数据源 → 爬虫配置（`CrawlerConfigPanel`）：按源开关、字段、上限、间隔、超时、选择器、附件 URL 模板；落到 `data_sources.fetch_config.enrichment`，经 `PATCH /api/admin/data-sources/[id]` 写入。
  - 注意：`ADMIN_UI_LOCAL_BYPASS=true` 只放行服务端的 `/api/admin/*` 守卫，`/admin` 页面本身仍然要求前端有已登录的 admin 会话（`useAuth()` 无 user 时直接渲染"需要登录"）。没有会话时改走 API：`PATCH` **必须带完整的 `fetchConfig`**（服务端整体替换，不做合并），并带 `Origin: http://localhost:3000` 以通过 CSRF。

## 启动

- **本机（宿主机跑 `npm run dev` 时的标准路径）**：`services/scrapling-extractor/run-local.sh`；
  `frontend/.env.local` 设 `SCRAPLING_EXTRACTOR_URL=http://localhost:8091`。
  健康检查：`curl -s http://localhost:8091/health` → `{"ok": true, "scrapling": "0.4.15"}`。
- **compose：sidecar 只在 compose 网络内可达，不发布宿主机端口**（`docker-compose.yml` 里没有
  `ports:`）。`docker compose up -d scrapling-extractor` 后由 `app` 容器通过 compose DNS 访问
  `http://scrapling-extractor:8091`（URL 已自动注入）；宿主机不要去连 `localhost:8091`，要验健康
  就进容器：`docker compose exec scrapling-extractor python -c "import urllib.request;
  print(urllib.request.urlopen('http://127.0.0.1:8091/health').read())"`。
  sidecar 没有任何鉴权，**永远不要对外暴露**；需要从宿主机直接调用时改用 `run-local.sh`。

## 观测

- `crawler_logs.metadata.enrichment`：`{attempted, enriched, failed, skipped, reason, extractor}`；`reason` 取值 `disabled | extractor_not_configured | extractor_unavailable | enrichment_crashed | null`。
- `bids.detail_fetched_at`、`bids.raw_payload.enrichment.fields`（每字段 `selector` / `heuristic` / `not_found`）。
- 注意语义：`enriched` 统计的是**实际写入了至少一个字段**的记录条数（2026-09-15 修正；此前它统计的是"抓取 + 解析成功"，CA 那种全 `not_found` 的 SPA 外壳会虚报 `enriched: 24`）。详情页抓到了、解析器也答了，但没有任何字段被写入（返回值全为 `not_found`，或都已存在）的记录现在计入 `skipped`，`attempted` 含义不变。因此 `attempted = enriched + failed + (本次抓取但未写入的 skipped)`，逐字段收益仍以 `raw_payload.enrichment.fields` 为准。

常用 SQL：

```sql
SELECT source, JSON_EXTRACT(raw_payload,'$.enrichment.fields') diag, COUNT(*)
FROM bids WHERE detail_fetched_at IS NOT NULL GROUP BY source, diag;
```

## 基线与结果（2026-09-15，五源 CA/IL/FL/NY/TX）

两列均为实测值：左列取自补全开启前（2026-09-15 06:50 UTC），右列取自五源运行 + IL 选择器修正重跑之后
（07:10 UTC，同一条 SQL）。之后为验证保护式 upsert 又跑了几次"关闭补全"的复跑，每次还会再导入
至多 25 条纯列表页记录，所以现在重跑同一条 SQL 得到的总行数会比右列更大 —— 右列是当时的快照，不是最新值。

| 指标 | 补全前 | 补全后 |
|---|---|---|
| description 缺失或等于标题 | 246 / 307 | 296 / 404 |
| original_category 缺失 | 154 / 307 | 154 / 404 |
| published_date 缺失 | 180 / 307 | 229 / 404 |
| 有附件的招标数（全库 `bid_attachments` distinct bid_id） | 152 | 177 |

**绝对值必须结合行数一起读。** 每次运行在补全之外还会新导入至多 25 条纯列表页记录，五源总行数因此从 307 涨到 404（+97）。分母变了，`desc_missing` 这类"缺失计数"的绝对值会同时被"新增缺失行"抬高和被"补全填充"压低。真正干净的对照是同一源内部的两个队列：

| Illinois BidBuy 队列 | 行数 | description 缺失或等于标题 | original_category 缺失 | 有联系人姓名 | 有附件 |
|---|---|---|---|---|---|
| 仅列表页（`detail_fetched_at IS NULL`） | 155 | 154（99.4%） | 154（99.4%） | 1（0.6%） | 1（0.6%） |
| 已补全（`detail_fetched_at IS NOT NULL`） | 25 | 3（12.0%） | 0（0%） | 21（84.0%） | 25（100%） |

附件同理：全库 distinct bid_id 从 152 涨到 177（+25），五源口径从 6 涨到 31（+25），增量全部来自 IL —— IL 25 条补全记录共解析出 72 条附件，URL 由 `attachment_url_template` 从 `javascript:downloadFile('1806557')` 这类链接还原为真实下载地址，没有任何一条是凭空拼出来的（解析器对无法定位数字 id 的链接返回 `url: null`）。

### 每源运行结果（`crawler_logs.metadata.enrichment`）

| 源 | 运行状态 | fetched | enrichment | 实际收益 |
|---|---|---|---|---|
| `ca_caleprocure` | success | 25 | `{"attempted":25,"enriched":24,"failed":1,"skipped":0,"reason":null,"extractor":"0.4.15"}` | **0 字段**：24 条诊断全部 `not_found` |
| `il_bidbuy`（启发式首跑） | success | 25 | `{"attempted":25,"enriched":25,"failed":0,"skipped":0,"reason":null,"extractor":"0.4.15"}` | 分类 25、附件 25、联系人 25（含 4 条脏值）、描述=标题 |
| `il_bidbuy`（选择器重跑） | success | 25 | `{"attempted":25,"enriched":25,"failed":0,"skipped":0,"reason":null,"extractor":"0.4.15"}` | 描述 24（`selector`）、联系人 21（`selector`）、分类 25、附件 25 |
| `fl_mfmp` | success | 25 | `{"attempted":25,"enriched":0,"failed":25,"skipped":0,"reason":null,"extractor":"0.4.15"}` | **0 字段**：详情页 TLS 握手被门户直接重置 |
| `ny_contract_reporter` | success | 25 | `{"attempted":25,"enriched":25,"failed":0,"skipped":0,"reason":null,"extractor":"0.4.15"}` | **负收益**：抓到的是登录页，见"已知偏差"；已改回关闭 |
| `tx_esbd` | failure | 0 | `NULL` | 列表页阶段就因 TLS `SSLEOFError` 失败，补全阶段未执行 |
| `ny_contract_reporter`（关闭补全后复跑） | success | 25 | `{"attempted":0,"enriched":0,"failed":0,"skipped":25,"reason":"disabled","extractor":null}` | 抓回的是另外 25 条新记录，未与已补全行重叠 |
| `il_bidbuy`（关闭补全后复跑） | success | 25 | `{"attempted":0,"enriched":0,"failed":0,"skipped":25,"reason":"disabled","extractor":null}` | 保护式 upsert 验证，见下 |

IL 最终配置的选择器（BuySpeed 系门户通用）：

```
description : //td[normalize-space(.)='Bulletin Desc:']/following-sibling::td[1]
contact     : //td[normalize-space(.)='Info Contact:']/following-sibling::td[1]
attachment_url_template :
  https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?downloadFileNbr={id}&docId={source_bid_id}&currentPage=1&mode=download&parentUrl=close
```

### 10 条抽查（逐条对照门户页面）

对 `detail_fetched_at` 最新的 10 条（全部为 IL BidBuy）逐条抓取 `source_url` 原页做字段比对：

- description：10/10 与页面 "Bulletin Desc:" 单元格一致。
- original_category：10/10 与页面 "NIGP Code:" 行一致。
- contact：8/10 与页面 "Info Contact:" 一致；2 条不一致，见"已知偏差"。
- published_date：10/10 为空，且页面确实没有发布日期（只有 "Bid Opening Date"，那是截止日），`not_found` 是正确结果。

### 保护式 upsert 验证（IL，真实 MySQL）

把 IL 的 `enrichment.enabled` 改回 `false` 后原样再跑一次 `il_bidbuy`：

```
crawler_logs.metadata.enrichment
= {"attempted": 0, "enriched": 0, "failed": 0, "skipped": 25, "reason": "disabled", "extractor": null}
status = success, fetched_count = 25
```

这一跑抓回的正是之前那 25 条 docId（`Illinois BidBuy` 总行数保持 180 不变，说明 25 条全是 update
而不是 insert），并且携带的是**纯列表页字段**（描述=标题、无分类、无联系人、无附件）。复跑前后：

| | 复跑前 | 复跑后 |
|---|---|---|
| 已补全行数 | 25 | 25 |
| `description` 非空且不等于标题 | 22 | 22 |
| `original_category` 非空 | 25 | 25 |
| `contact_name` 非空 | 21 | 21 |
| `contact_email` 非空 | 15 | 15 |
| `MD5(GROUP_CONCAT(id~description~category~contact_*))` | `f0c86cb6faf8548982179845a35c7b0f` | `f0c86cb6faf8548982179845a35c7b0f` |
| `bid_attachments` 行数 / 覆盖招标数 | 72 / 25 | 72 / 25 |

导入器只在目标字段为空（或 `description` 恰好等于 `title`）时才写入，所以纯列表页的复跑不会冲掉已补全的值。

## 已知偏差

1. **New York State Contract Reporter：详情页需要 vendor 账号，必须保持关闭。**
   `https://www.nyscr.ny.gov/Ads/Details/{id}` 会 302 到 `/Account/Login`。补全阶段抓到的是登录页，
   启发式把登录页的导航条文案（"New York State Contract Reporter Find Bids Advertise Bids …"）
   当成描述写进了 14 条记录。发现后已把 NY 的 `enrichment.enabled` 改回 `false`。
   **本项目不会为了绕过登录做任何事**；这类门户属于"需要 vendor 账号，不抓取"。
   已写入的 14 条脏描述因为字段非空、受保护式 upsert 保护，不会被后续运行自动覆盖，需要单独清理
   （`SELECT COUNT(*) FROM bids WHERE source='New York State Contract Reporter'
   AND description LIKE 'New York State Contract Reporter Find Bids Advertise Bids%'` → 14）。
2. **California Cal eProcure / MyFloridaMarketPlace / Texas ESBD：详情页不是服务端渲染，补全零收益。**
   CA 是 InFlight SPA 外壳（24 条诊断全 `not_found`）；FL 的详情页在 TLS 握手阶段就被门户重置
   （25 条全部计 `failed`）；TX 在列表页阶段就失败，补全阶段根本没跑。这三个源目前开着补全只是白白
   发请求，建议在解析型 sidecar 之外补上浏览器渲染阶段之前保持关闭。
3. **IL 联系人：启发式在 "Info Contact:" 单元格为空时会往下抓到无关内容。**
   首跑（无选择器）在 4 条记录上把 "Purchase Method: Open Market" 写进了 `contact_name`。
   改用 `//td[normalize-space(.)='Info Contact:']/following-sibling::td[1]` 之后，空单元格返回
   `not_found`（4/25），不再产生脏值。但那 4 条旧脏值同样受保护式 upsert 保护而保留了下来 ——
   这是"只填空值"策略的代价：错误值一旦写入就不会被自动修正，需要人工清理。
4. **IL 联系人姓名偶尔带残留后缀。** 页面写作 "Contact Sinead Robinson at (815) 727-3607 Ext. 5523" 时，
   电话被正确切出为 `(815) 727-3607`，但姓名留下了 "Sinead Robinson at Ext. 5523"。信息无误，格式不洁。
5. **`published_date` 在 BuySpeed 系门户恒为 `not_found`。** 页面只有 "Bid Opening Date"（截止日），
   没有发布日期，不能拿截止日冒充发布日。上表 `published_date` 缺失数因此只随新增行上涨。
6. **门户限流会把补全和列表抓取一起挡掉。** 30 分钟内对 `bidbuy.illinois.gov` 连跑 5 次之后，
   连同普通 `curl` 在内的所有 HTTPS 连接都开始返回 `SSLEOFError`。这不是 bug，是门户在限流；
   正确处理是降低 cadence / 等待，而不是换 UA、加代理或重试绕过。

## 边界

- 详情页 403 / WAF 挑战 / TLS 重置只计 `failed`，不重试、不绕过、不做浏览器渲染、不解验证码。
- 登录后才能看的详情页不抓取；发现某个源的详情页 302 到登录页，正确做法是把该源的补全关掉。补全阶段本身也会拦截这类跳转：抓取后比对最终 URL，出现"换了 host / 路径新增 `/login`、`/signin`、`/sign-in`、`/account/login`、`/auth` 标记 / 跳转后丢掉了原路径末段（详情 id）"三者之一，就判定抓到的不是目标详情页，**不调用解析器、不合并任何字段**，直接计 `failed` 并向 stderr 打印 `RedirectedOffTarget: final url …`。这是拦截，不是绕过 —— 项目不会为登录墙做任何绕过。
- 补全只填空值；关闭补全后的运行不会覆盖已补全数据（importer 保护式 upsert）。反过来说，
  补全写错的值也不会被自动修正，所以上线新源前应先用少量样本核对选择器。
  **保护范围有限**：importer 只在传入值为空、或 `description` 恰好等于标题时才保留已补全的值；
  如果某个源的列表页本身带有一段真实的简短说明，关闭补全后的复跑仍会用这段列表页文案刷新
  `description`（IL 的复跑之所以完全等价，是因为它的列表页描述恰好等于标题）。
- sidecar 只做解析：它不发起外部请求，HTML 由 crawler 自己按既有礼貌策略（默认 3 秒间隔、
  每源每次最多 25 条详情页）抓取后 POST 进去。
