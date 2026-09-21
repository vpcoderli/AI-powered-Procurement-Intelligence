# 郡/县数据源主动发现：设计（2026-09-21，决策已确认）

## 1. 要解决的问题

现在新增一个县市源全靠人工找 URL。2026-09-16 的四个 404 源证明了猜路径不可行：BidNet 同一平台的租户路径至少三种形态且无规律。

| 形态 | 实例 |
| --- | --- |
| 根级 + 连字符 | `/city-of-aurora/solicitations/open-bids` |
| 分组 + 连字符 | `/colorado/boulder-county/...` |
| 分组 + 无连字符压缩 | `/ohio/franklincountychildrensservices`、`/colorado/alamosacounty` |

`discover-tenant` 只试连字符变体，六个候选全部 404。正确做法是**读平台自己公布的机构目录**。

## 2. 实测到的事实（2026-09-21）

| 事实 | 证据 |
| --- | --- |
| 全局机构目录 | `https://www.bidnetdirect.com/participating-buyers` HTTP 200，每页约 50 家，含 `Next` 控件 |
| 分页端点 | `GET /participating-buyers/changePage?target=paginationChange&purchasingGroupContext=true&pageNumber=N` HTTP 200，返回完整 HTML，含下一批租户链接 |
| 采购组清单 | `/purchasing-groups` 列出约 50 个组，多数是州名 slug（`/ohio`、`/colorado`），另有 `/mitn`、`/bgis` 等非州组 |
| 租户列表页 | `<租户路径>/solicitations/open-bids` HTTP 200，标题带机构名；现有解析器与空态判定直接可用 |
| robots.txt | 禁止范围仅 `/private/`、`/favorites`、注册、认证、`/public/info`、服务流、`/dev-tools/`、`/ws/`；上述目录与分页路径**均不在禁止范围** |
| 目录内容 | 绝大多数是学区、水务、消防、图书馆、交通、大学等特别区；真正的郡/市是少数 |

存档 fixture：`crawler/tests/fixtures/discovery/bidnet_participating_buyers_page{1,2}.html`、`bidnet_purchasing_groups.html`。

Census 数据（均可下载，体积可接受）：

| 文件 | 大小 | 用途 |
| --- | --- | --- |
| `2024_Gaz_counties_national.zip` | 142 KB | 3,235 个郡 → GEOID |
| `2024_Gaz_place_national.zip` | 1.2 MB | 约 32,000 个地名（含 CDP，需剔除） |

## 3. 决策（用户 2026-09-21 确认）

1. 本期只打通 **BidNet** 一个平台。
2. FIPS 匹配**内置一份离线 Census 郡/地名表**，随仓库提交，定期刷新。
3. **不注册特别区**（学区、水务、消防、交通、大学等），只要 county / city。
4. 发现结果先产出**候选 JSON 供人工审阅**，再走 `source:register`。
5. **手动运行**，不做 worker。

## 4. 方案

### 4.1 管道

```
discover-sources (Python CLI, 只读)
  ├─ 1 抓取采购组清单 → 组 slug → 州 映射
  ├─ 2 分页抓取机构目录 → (机构名, 租户路径, 组)
  ├─ 3 分类：county / city / special_district / unknown
  ├─ 4 只对 county、city 匹配 Census 表 → GEOID
  └─ 5 输出 candidates[] + report{}  （stdout 单个 JSON）
        ↓ 人工审阅
  npm run source:register -- --file candidates.json   （落成未批准行）
        ↓
  前置检查 → 批准表单（治理门禁不变）
```

发现阶段**不写数据库、不碰治理列**，与 2026-09-16 建好的门禁完全解耦。

### 4.2 `discover-sources` CLI 契约

请求（stdin，单个 JSON）：

```json
{
  "platform": "bidnet",
  "max_pages": 400,
  "min_interval_seconds": 3,
  "timeout_seconds": 30,
  "levels": ["county", "city"],
  "states": ["OH", "CO"],
  "existing_ids": ["bidnet_co_denver"],
  "existing_base_urls": ["https://www.bidnetdirect.com/colorado/..."],
  "existing_sources": [{ "id": "bidnet_oh_franklin", "label": "Franklin County, OH (BidNet)", "state_code": "OH" }]
}
```

`states` 省略表示全部；给出明确列表时，**组无法解析出州码的机构不计入结果**，只计入 `stats.unresolved_state_skipped`（否则 `states: ["OH"]` 会把 `mitn`、`bgis` 等非州组一并带出）。`existing_*` 用于去重；`existing_sources` 用于给库里已有（尤其是 404）的源反查目录建议。

响应（stdout，单个 JSON；诊断走 stderr；逐项失败不影响整体，退出码 0；请求非法退出码 2）：

```json
{
  "candidates": [
    {
      "id": "bidnet_oh_franklincountychildrensservices",
      "label": "Franklin County Children Services (BidNet)",
      "issuerType": "county",
      "stateCode": "OH",
      "baseUrl": "https://www.bidnetdirect.com/ohio/franklincountychildrensservices/solicitations/open-bids",
      "jurisdictionLevel": "county",
      "jurisdictionName": "Franklin County",
      "fipsCode": "39049",
      "providerFamily": "bidnet",
      "cadence": "daily",
      "fetchConfig": { "base_url": "https://www.bidnetdirect.com/ohio/franklincountychildrensservices/solicitations/open-bids" },
      "discovery": { "agencyName": "Franklin County Children Services", "group": "ohio", "matchedOn": "county", "confidence": "jurisdiction_prefix", "matchedPrefix": "Franklin County" }
    }
  ],
  "review": [
    { "agencyName": "Aurora Housing Authority", "tenantUrl": "...", "group": "colorado", "reason": "classified_special_district" }
  ],
  "existingMatches": [
    { "sourceId": "bidnet_oh_franklin", "agencyName": "Franklin County Children Services", "suggestedBaseUrl": "...", "confidence": "partial" }
  ],
  "stats": { "pages": 312, "agencies": 15420, "county": 410, "city": 980, "special_district": 13900,
             "unknown": 130, "unmatched": 74, "duplicates": 6, "duration_ms": 1100000 }
}
```

`candidates[]` 的前十个字段与 `frontend/scripts/register-sources.ts` 的 `SourceCandidate` **逐字段一致**（多出的 `discovery` 块被该脚本忽略，仅供人工审阅）。

### 4.3 抓取规则

- 先取 `/purchasing-groups`，得到组 slug 列表；州名 slug → 两字母州码（内置表）；非州组（`mitn`、`bgis` 等）保留原 slug，州码由租户所在页推断，推断不出则进 `review`。
- 目录分页：`pageNumber` 从 1 递增，直到没有 `Next`、本页没有新租户、或到 `max_pages`。每次请求间隔 `min_interval_seconds`（默认 3 秒），复用 crawler 的浏览器请求头。
- HTTP 202 / WAF 挑战 → 立即停止本次发现，`stats.stopped_reason = "waf_challenge"`，已采集部分照常返回。**不绕过挑战。**
- 只取"公开机构"分页（`innerTabId=public`），不碰注册/登录路径。

### 4.4 分类规则（决策 3：只要 county / city）

按机构名（大小写不敏感）判定，优先级从上到下：

| 级别 | 规则 |
| --- | --- |
| `special_district` | 名字含 school / district / authority / library / fire / water / sanitation / transit / college / university / university / port / housing / conservancy / metropolitan / board of |
| `county` | 名字含 `county` / `parish`，且不含上面的特别区词；`borough` **仅阿拉斯加**算郡 |
| `city` | 名字以 `city of` / `town of` / `village of` / `borough of` 开头，或以 `city` / `town` / `village` 结尾；非阿拉斯加的 `borough` 归此类 |
| `unknown` | 其余 |

`special_district` 与 `unknown` 不进 `candidates`，进 `review` 并计数——这正是"不要特别区"的落地方式，同时保留人工捞回的可能。

注意"City and County of Denver"这类同时命中两条：按 `county` 归类（与库里既有 `bidnet_co_denver` 的 `jurisdictionLevel: "county"` 一致）。

**2026-09-21 实测修正**：最初把 `borough` 一律当郡，结果两页 fixture 里 20 个"郡"有 9 个是新泽西的 borough——那是市镇不是郡，全部匹配不上白白进 review。改为只有阿拉斯加的 borough 算郡，并给 `name_key` 增加 `borough of` 前缀剥离后，这 9 家直接精确匹配到对应的 place。`classify_agency` 因此增加可选的 `state_code` 参数。

### 4.4b 两条修正的实测效果

同样的 96 个真实机构名（两页 fixture），修正前后：

| 分类 | 修正前 | 修正后 |
| --- | --- | --- |
| `special_district` | 59 | 59 |
| `unknown` | 15 | 15 |
| `county` | 20 | 11 |
| `city` | 2 | 11 |

其中 county/city 共 22 个名字的匹配结果：**修正前 8 个精确、14 个落空；修正后 20 个精确 + 2 个前缀、0 个歧义、0 个落空**。9 个新泽西 borough 全部解析到正确的 place GEOID，2 个郡属部门（Alameda County Public Works Agency → 06001、Archuleta County Sheriff's Office → 08007）由前缀规则收回。

马里兰"Baltimore County Public Works"同时命中巴尔的摩郡与同名独立市，前缀规则按设计返回 `not_found` 进 review，不猜。

### 4.5 Census 表与匹配

- 表：`crawler/data/us_jurisdictions.tsv`，列 `level`(county|place)、`geoid`、`state`、`name`、`name_key`，随仓库提交。
- 刷新：`crawler/scripts/refresh_jurisdictions.py` 下载两个 gazetteer zip，剔除 CDP（LSAD=57 等非建制地名），只保留需要的列写回 TSV。需人工按年运行，文件头写入来源 URL 与生成日期。
- `name_key` 归一化：转小写、去标点、折叠空格、去掉前缀 `city of` / `town of` / `village of` / `county of` / `city and county of`、去掉后缀 `county` / `parish` / `borough` / `city` / `town` / `village`。
- 匹配：在同一州内按 `name_key` 精确匹配；county 查 county 行，city 查 place 行。命中唯一 → `confidence: "exact"`；命中多个或零个 → 不进 `candidates`，进 `review`（`reason: "ambiguous_match"` / `"no_fips_match"`）。
- **辖区前缀匹配（2026-09-21 增补）**：目录里大量机构叫"X County 某某局"（实测 20 个郡级名里有 2 个，全平台比例更高）。精确匹配必然落空，但它们无疑属于 X 郡。因此在精确匹配失败后追加一条**结构性**规则：名字以 `<X> County` / `<X> Parish` 开头，且 `<X>` 在该州唯一命中一个郡时，返回 `{"status": "prefix", ...}`，进 `candidates` 但标 `confidence: "jurisdiction_prefix"` 并带上 `matchedPrefix`，让审阅者一眼看出这是"郡内的某个部门"而非郡本身。只对 county 生效，city 永不使用前缀规则。

**仍然不做模糊匹配**：前缀是结构性的、可判定的，不是相似度猜测；除此之外宁可让人补，也不写错 GEOID。

### 4.6 与既有源的关系

`existing_sources` 里的每一项，按机构名 `name_key` 在目录里反查；命中就写进 `existingMatches` 并给出建议 `baseUrl`。这能直接回答 2026-09-16 遗留的四个 404 源：要么给出正确租户路径，要么用"目录里查无此机构"支持把它标 `blocked`。**只建议，不写库。**

## 5. 成本与礼貌（2026-09-21 实测修正）

实测目录每页 48 家、共 43 页，全平台约 **2,064 家机构**——远小于最初估计的上万家。全量发现按 3 秒间隔约 **2–3 分钟**，成本可忽略，但仍保持手动、低频（按季度或按需），并保留 `max_pages` 上限与 `states` 过滤用于小批量试跑。

两条实测补充：

- `/bgis` 是真实租户组，却**不在** `/purchasing-groups` 的清单里——组清单不完整，不能当白名单用，只能当 slug→州 的映射表。
- 每页页脚都会把约 49 个组以单段链接列出（`/ohio`、`/mitn`），这是解析的主要误判来源，必须靠机构卡片标记排除。

## 6. 边界

- 只读公开目录页，不注册账号、不登录、不绕 WAF、不解验证码。
- 不写数据库、不改治理列；所有新源仍须经前置检查与人工批准。
- 不做模糊名称匹配，不自动填 GEOID 猜测值。
- 本期不接 Bonfire 等其他平台，但 CLI 以 `platform` 字段分派，接第二个平台只需加一个 harvester。

## 7. 验证

- 离线 fixture（已存档三页真实 HTML）驱动解析、分页终止、分类、匹配的单元测试。
- Census 表：用小样本 TSV 测匹配与归一化；刷新脚本用本地 zip 测解压与过滤。
- 契约测试：生成的 `candidates[]` 必须通过 `register-sources.ts` 的 `validateCandidate`（Node 侧加一个读 fixture JSON 的测试）。
- 真机：全量跑一次（43 页 / 2,036 家 / 2 分 55 秒），结果 819 候选 + 1,217 待审阅，存档于 `ops-evidence/`，详见[运维记录](../../operations/source-discovery.md)的实测小节。
- 反向校验：用生成的 Census 表复核库里既有源的 `fips_code`。2026-09-21 首次复核就抓出一处：种子文件给 `bidnet_co_city_aurora` 的 `0803455` 实际是 Arvada，Aurora 应为 `0804000`，种子与数据库均已更正；其余 9 条全部一致。这正是本功能存在的意义。
