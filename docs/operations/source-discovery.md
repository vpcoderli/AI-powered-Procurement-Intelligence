# 县/市数据源主动发现（BidNet）

设计与实测依据见[郡/县数据源主动发现：设计](../superpowers/specs/2026-09-21-source-discovery-design.md)；发现之后的治理门禁、前置检查与批准表单见[县/市级数据源的治理拦截、前置检查与批准](./local-source-approval.md)；采集链路见[爬虫与 Scrapling 逻辑梳理](../architecture/crawler-enrichment-flow.md)。本文只讲：为什么要读目录而不是猜路径、`discover-sources` 怎么跑、产出的候选怎么审、分类与 FIPS 匹配各自的规则、Census 表怎么刷新、以及怎么用 `existingMatches` 收掉 2026-09-16 遗留的四个 404 源。

一句话原则：**发现只读、只建议，不写库。** 这条命令不碰 `data_sources` 的任何一列，也不改任何治理状态；它产出一份 JSON，后面每一步仍然由人推进。

## 1. 为什么不能猜租户路径

2026-09-16 我们用 `discover-tenant` 为四个 404 源逐个试探候选路径，六个候选全部 404。原因不是探测写错了，而是 BidNet 的租户路径**至少有三种形态且无规律**：

| 形态 | 实例 |
| --- | --- |
| 根级 + 连字符 | `/city-of-aurora/solicitations/open-bids` |
| 分组 + 连字符 | `/colorado/boulder-county/solicitations/open-bids` |
| 分组 + 无连字符压缩 | `/ohio/franklincountychildrensservices`、`/colorado/alamosacounty` |

`discover-tenant` 只生成连字符变体，第三种形态永远试不出来。而且机构名与租户 slug 本来就不是一一对应（`Franklin County Children Services` → `franklincountychildrensservices`）。

正确做法是**读平台自己公布的机构目录**：路径由平台给出，不由我们构造。`discover-tenant` 仍然保留——它便宜、适合单个源的 404 快速复核；`discover-sources` 是批量、权威的那条路。

## 2. 目录与分页端点（2026-09-21 实测）

| 端点 | 结论 |
| --- | --- |
| `https://www.bidnetdirect.com/participating-buyers` | HTTP 200，每页约 50 家机构，页尾有 `Next` 控件 |
| `GET /participating-buyers/changePage?target=paginationChange&purchasingGroupContext=true&pageNumber=N` | HTTP 200，返回完整 HTML，含下一批租户链接；`pageNumber` 从 1 递增 |
| `/purchasing-groups` | 约 50 个采购组，多数是州名 slug（`/ohio`、`/colorado`），另有 `/mitn`、`/bgis` 等非州组 |
| `<租户路径>/solicitations/open-bids` | HTTP 200，标题带机构名；既有列表解析器与空态判定直接可用 |

**robots.txt 结论**：BidNet 的禁止范围只有 `/private/`、`/favorites`、注册、认证、`/public/info`、服务流、`/dev-tools/`、`/ws/`。上面这些目录页与分页路径**都不在禁止范围内**。robots.txt 本身仍需经 crawler 的 `requests` 客户端抓取（`fetch-robots` 子命令）——BidNet 的 WAF 对 Node `fetch` 一律 403，理由见 `local-source-approval.md` 第 2 节。

**边界不变**：只读公开目录页，不注册账号、不登录、不绕 WAF、不解验证码。HTTP 202 或挑战页面出现时**立即停止本次发现**，已采集部分照常返回，`stats.stopped_reason = "waf_challenge"`。

## 3. 怎么跑

这是 Python CLI，从 `crawler/` 目录运行，stdin 收一个 JSON 请求，stdout 吐一个 JSON 文档。**没有 npm 包装脚本**：包装除了多一层间接什么也不加，而请求体里的 `states`、`max_pages`、`existing_*` 本来就要按每次跑的范围手写。

小批量试跑（先只跑一个州）：

```bash
cd crawler
echo '{"platform":"bidnet","states":["OH"],"max_pages":20}' \
  | python -m apsi_crawler.cli discover-sources > /tmp/candidates-oh.json
```

全平台（约 200–400 页，按 3 秒间隔约 10–20 分钟，见第 8 节）：

```bash
cd crawler
echo '{"platform":"bidnet","max_pages":400,"min_interval_seconds":3}' \
  | python -m apsi_crawler.cli discover-sources > /tmp/candidates-all.json
```

诊断走 stderr，所以 `>` 重定向拿到的永远是**一个**干净 JSON 文档。退出码：跑完（哪怕因 WAF 或 `max_pages` 只跑了一部分）为 `0`；请求本身不可用为 `2`，此时 stdout 是 `{"error":{"code":"INVALID_REQUEST","message":"…"}}`。

### 请求字段

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `platform` | `bidnet` | 目前只支持 `bidnet`；其他值退出码 2 |
| `states` | 省略 = 全部 | 两字母州码数组。**不接受空数组**（省略才是"全部"，空数组多半是脚本出错） |
| `levels` | `["county","city"]` | 只能从这两个里选。想只要郡就填 `["county"]`，被排除的那一级进 `review` |
| `max_pages` | `400` | 目录分页上限，钳制到 1..2000 |
| `min_interval_seconds` | `3` | 每次请求之间的最小间隔，钳制到 0..60 |
| `timeout_seconds` | `30` | 单次请求超时，钳制到 1..300 |
| `existing_ids` | `[]` | 库里已有的源 id，用于去重 |
| `existing_base_urls` | `[]` | 库里已有的 `base_url`，用于去重（忽略大小写与结尾斜杠） |
| `existing_sources` | `[]` | `{id, label, state_code}` 数组，用于反查目录，见第 7 节 |

数值字段**静默钳制**（写 `max_pages: 0` 得到 1），结构字段（`levels`、`states`、`existing_*` 的类型）**报错退出 2**。取现有源填 `existing_*` 的 SQL：

```sql
SELECT id, label, state_code, base_url FROM data_sources WHERE provider_family = 'bidnet';
```

### 响应

```json
{
  "candidates": [ { …SourceCandidate 十个字段…, "discovery": {…} } ],
  "review":     [ { "agencyName", "tenantUrl", "group", "reason", "detail" } ],
  "existingMatches": [ { "sourceId", "agencyName", "suggestedBaseUrl", "confidence" } ],
  "stats": { … }
}
```

`candidates[]` 的前十个字段与 `frontend/scripts/register-sources.ts` 的 `SourceCandidate` **逐字段一致**，可以直接喂给 `source:register`；多出来的 `discovery` 块（`agencyName` / `group` / `matchedOn` / `confidence` / `matchedPrefix`）只给审阅的人看，注册脚本会忽略它。跨语言契约由两侧测试共同守住：`crawler/tests/test_discover_sources_cli.py` 与 `frontend/scripts/register-sources.test.ts`。

`stats` 各字段：

| 字段 | 含义 |
| --- | --- |
| `pages` / `agencies` | 实际翻了几页、拿到几家机构 |
| `county` / `city` / `special_district` / `unknown` | 分类桶。恒等式：四者之和 **等于** `agencies` |
| `unmatched` | 进到 FIPS 匹配那一步却没匹配上的 county/city 数（`ambiguous` + `not_found`） |
| `prefix_matched` | 靠"郡名前缀"规则拿到 GEOID 的候选数，即 `confidence: "jurisdiction_prefix"` 的条数，见第 6 节 |
| `duplicates` | 因 `existing_ids` / `existing_base_urls` 命中而跳过的机构数 |
| `harvest_duplicates` | 翻页过程中重复出现的租户路径数（采集器自己的去重计数，与上面一条不是一回事） |
| `unresolved_state_skipped` | 带 `states` 过滤时，采集器**自己**丢掉的无州码机构数。不带过滤时恒为 0（那时无州码机构会照常交过来，进 `review` 的 `unresolved_state`） |
| `stopped_reason` | `exhausted` / `max_pages` / `waf_challenge` / `no_new_links` |
| `duration_ms` | 本次发现耗时 |

看到 `stopped_reason: "waf_challenge"` 就**不要立刻重跑**——那正是招来限流的动作。隔一段时间、缩小 `states` 范围再跑。

## 4. 完整流程

```
discover-sources（只读，不写库）
      ↓ candidates.json
人工审阅（第 5 节：逐条看 label / jurisdictionName / baseUrl / fipsCode）
      ↓
cd frontend && npm run source:register -- --file candidates.json
      ↓ 落成 approval_status IS NULL 的未批准行（治理拦截中）
管理端 /admin → 审批前置检查（robots + limit=5 试抓 + 404 时租户探测）
      ↓ ready / empty
批准县/市源表单（复核人、ToS、必要时法务参考、下次复核日期）
      ↓
批量运行面板单独跑一次，确认 success 或"空态：无开放招标"
```

注册前**务必**先 `--dry-run` 过一遍：

```bash
cd frontend
npm run source:register -- --file /tmp/candidates-oh.json --dry-run
```

注册进来的行 `approval_status` 为 NULL，也就是[治理拦截](./local-source-approval.md#1-什么是治理拦截)状态，不会被调度器碰到。发现这一步**没有**、也不该有任何绕过门禁的能力。

## 5. 人工审阅要看什么

`candidates.json` 是给人改的，不是给人直接过的。逐条至少确认三件事：

1. **`baseUrl` 确实是本辖区的页面**。租户路径填错不会报错，只会安静地把另一个县的招标抓进库里。有疑问就在浏览器里打开看标题。
2. **`jurisdictionName` 与 `fipsCode` 配得上**。`jurisdictionName` 直接取自 Census 表，所以市级的值会是 `Columbus city`、`Aurora city` 这种带通名的官方写法；想写成 `Columbus` 请自己改，但**不要动 `fipsCode`**。
3. **`discovery.confidence` 是 `jurisdiction_prefix` 的条目要多看一眼**。这类机构是某个郡**下属的部门**（`Franklin County Children Services` → Franklin County，`matchedPrefix` 就写着郡名），GEOID 来自那个郡而不是机构自己的名字。它们是合法的可注册源——采购单位本来就常常挂在部门底下——但要由你判断两件事：这个部门是否真的独立发招标（而不是与郡本部重复），以及同一个郡下若出现多个部门，你是否都要。**同一个 `fipsCode` 被多个源共用是正常的**，不是 bug。
4. **`label` 与 `cadence`**。`label` 是 `<机构名> (BidNet)`；`cadence` 一律是 `daily`，量小或更新慢的市级源可以手工改成 `weekly`（合法值：`hourly` / `daily` / `weekly` / `manual`）。

`review[]` 不要直接扔掉——它是"没进候选的原因"清单：

| `reason` | 含义 | 常见处理 |
| --- | --- | --- |
| `classified_special_district` | 学区/水务/消防/图书馆/交通/大学等 | 按决策 3 不注册；确有需要由人单独捞回 |
| `classified_unknown` | 名字看不出级别（如 `Mid-Ohio Regional Planning Commission`） | 人工判断；多数也是特别区 |
| `level_not_requested` | 被本次 `levels` 排除 | 下次放开 `levels` 再跑 |
| `unresolved_state` | 采购组不是州（`mitn`、`bgis` 等），推断不出州码 | 人工补州码后手写候选。**只在不带 `states` 的全量跑里出现**——带过滤时这些机构由采集器直接丢掉，只在 `stats.unresolved_state_skipped` 里留个数 |
| `already_registered` | 命中 `existing_ids` / `existing_base_urls`，`detail` 是撞上的 id | 正常，说明库里已有 |
| `ambiguous_match` | 同州同名多条，`detail` 列出候选 GEOID | 人工挑一条，手写 `fipsCode` |
| `no_fips_match` | Census 表里查无此名，且郡名前缀规则也没救回来 | 人工查实际辖区后补 `fipsCode`；查不到就别注册 |
| `unusable_name` | 归一化后名字为空 | 极罕见，人工处理 |

**注意**：带部门后缀的郡级机构（`Franklin County Children Services`、`Archuleta County Sheriff's Office`）**不再**进 `no_fips_match`。它们由第 6 节的郡名前缀规则救回，成为 `confidence: "jurisdiction_prefix"` 的候选。设计文档 §4.2 开头那个例子把它标成 `exact` 是写错了——它是一个**郡下属部门**，不是郡本身。

## 6. 分类与匹配规则

### 分类（`classify_agency(name, state_code)`，按机构名，大小写不敏感，自上而下）

| 级别 | 规则 |
| --- | --- |
| `special_district` | 名字含 school / district / authority / library / fire / water / sanitation / transit / college / university / port / housing / conservancy / metropolitan / board of |
| `county` | 名字含 county / parish，或者含 borough **且州是 AK**，且不含上面任一特别区词 |
| `city` | 名字以 city of / town of / village of / borough of 开头，或以 city / town / village 结尾，或含 borough 且州不是 AK |
| `unknown` | 其余 |

**分类需要州码**，不是可有可无的参数：`borough` 在阿拉斯加是郡的对等物，在新泽西/宾州/康州却是普通市镇。忽略州码会把一批 NJ 的 borough 当成郡送去匹配，然后全部匹配失败进 `review`。所以 `discover_sources` 把每家机构的 `state_code` 一起传给分类器。

"City and County of Denver" 同时命中 county 与 city 两条，按 **`county`** 归类——与库里既有 `bidnet_co_denver` 的 `jurisdictionLevel: "county"` 一致。

### 为什么不注册特别区

决策 3（用户 2026-09-21 确认）：目录里**绝大多数**是学区、水务、消防、图书馆、交通、大学，真正的郡/市是少数。这些特别区的采购品类与 APSi 的目标供应商大多不相干，全量注册只会把源健康面板和调度预算稀释掉，而每一个源都还要走一遍人工合规批准。所以它们进 `review` 计数、保留人工捞回的可能，但不进 `candidates`。

### FIPS 匹配（`match_jurisdiction`）

- 归一化 `name_key`：转小写、去标点、折叠空格、去前缀 `city of` / `town of` / `village of` / `county of` / `city and county of`、去后缀 `county` / `parish` / `borough` / `city` / `town` / `village`。
- 在**同一州内**按 `name_key` 精确匹配；`county` 查 county 行，`city` 查 place 行。唯一命中 → `discovery.confidence: "exact"`，`discovery.matchedPrefix: null`。
- **郡名前缀规则**（仅 `county`、仅在精确匹配失败后）：机构名以 `<X> County` / `<X> Parish` 开头，且 `<X>` 在该州唯一对应一个郡时，取那个郡的 GEOID，记 `discovery.confidence: "jurisdiction_prefix"`、`discovery.matchedPrefix: "<X> County"`，计入 `stats.prefix_matched`。这样 `Alameda County Public Works Agency`、`Archuleta County Sheriff's Office` 这类**郡下属采购部门**才能进候选，而不是被整批丢掉。
- 命中多个（`ambiguous_match`）或零个（`no_fips_match`）→ 不进 `candidates`，进 `review`。

**仍然不做模糊匹配。** 前缀规则不是模糊匹配：它要求机构名以一个**完整、精确、在该州唯一**的郡名开头，命中的是那个郡确切的 GEOID。真正的模糊匹配（编辑距离、词重合度之类）一律不做——一个错的 GEOID 不会报错，只会安静地把这个源挂到别的辖区上，之后所有按辖区的筛选、提醒与统计都跟着错。宁可让人补一个空值，也不猜。

前缀规则的代价是：`jurisdiction_prefix` 候选的 `fipsCode` 是**它所属的郡**，不是这个部门自己（部门本来也没有 GEOID）。所以同一个郡的多个部门会共用一个 `fipsCode`，审阅时要按第 5 节第 3 条确认。

### id 规则

`bidnet_<州码小写>_<name_key>`（非字母数字折成 `_`），例如 `Cuyahoga County` (OH) → `bidnet_oh_cuyahoga`。同一次运行内撞名（或撞上 `existing_ids` 里的已有 id）时追加 `_2`、`_3`。

## 7. 收尾 2026-09-16 遗留的四个 404 源

`bidnet_oh_city_columbus`、`bidnet_oh_cuyahoga`、`bidnet_oh_franklin`、`bidnet_wy_laramie` 当时探测六个候选路径全部 404，没有可写回的建议路径，一直挂在未批准状态。用 `existing_sources` 让发现命令替它们反查目录：

```bash
cd crawler
cat <<'JSON' | python -m apsi_crawler.cli discover-sources > /tmp/pending.json
{
  "platform": "bidnet",
  "states": ["OH", "WY"],
  "existing_sources": [
    {"id": "bidnet_oh_city_columbus", "label": "City of Columbus, OH (BidNet)", "state_code": "OH"},
    {"id": "bidnet_oh_cuyahoga",      "label": "Cuyahoga County, OH (BidNet)",  "state_code": "OH"},
    {"id": "bidnet_oh_franklin",      "label": "Franklin County, OH (BidNet)",  "state_code": "OH"},
    {"id": "bidnet_wy_laramie",       "label": "Laramie County, WY (BidNet)",   "state_code": "WY"}
  ]
}
JSON
python3 -c 'import json;print(json.dumps(json.load(open("/tmp/pending.json"))["existingMatches"],indent=2))'
```

反查**忽略分类**：一个今天 404 的 county 源，在目录里很可能登记成我们会判为特别区的名字（`Franklin County` → `Franklin County Children Services`）。每个源恰好得到下面三种结论之一：

| `confidence` | 含义 | 处理 |
| --- | --- | --- |
| `exact` | 归一化名字完全一致 | 核对页面标题确属本辖区 → 在数据源表把 `base_url` 改成 `suggestedBaseUrl` → 重跑前置检查 → 走批准表单 |
| `partial` | 目录名字是库里名字的扩展（或反之），可能有多条 | **逐条打开看**。确认是同一个采购单位才写回；拿不准就留空 |
| `none` | 目录里查无此机构 | 这就是把该行标 `blocked` 的证据：`PATCH /api/admin/data-sources/[id]`，`approvalStatus=blocked`、`approvalNotes` 写明"2026-09-21 目录反查未命中" |

`existingMatches` **只建议、不写库**，写回 `base_url` 仍然是管理端上的一次人工确认操作（`local-source-approval.md` 第 4.2 节）。

**同一次运行里当心重复登记**：给 `bidnet_oh_franklin` 建议 `…/franklincountychildrensservices/…` 的那一次运行，`candidates[]` 里**同时**会有一条指向同一租户的 `bidnet_oh_franklin_county_children_services`（郡名前缀规则捞回来的）。两边都落库就等于把同一个租户页按两个 id 抓两遍。二选一：要么把已有行的 `base_url` 改过去、从 `candidates.json` 里删掉那条新候选，要么注册新候选、把旧行标 `blocked`。把旧行的 `base_url` 放进 `existing_base_urls` 是防不住的——旧行存的正是那个 404 的地址。

## 8. 成本与礼貌

- 目录每页约 50 家。全平台上万家机构 ≈ 200–400 页，按默认 3 秒间隔约 **10–20 分钟**一次。
- **手动、低频**：建议按季度或有需要时才跑，不做 worker、不进调度。这是有意的决策 5。
- 先用 `states` 小批量试跑（一个州通常一两页），确认分类与匹配结果合理，再考虑全量。
- `max_pages` 是硬上限，触顶记 `stopped_reason: "max_pages"`，不会无限翻。
- 全程复用 crawler 的浏览器请求头与最小间隔；遇挑战立刻停，不重试、不加压。

## 9. Census 表怎么刷新

匹配用的是仓库内置的离线表 `crawler/data/us_jurisdictions.tsv`（列 `level` / `geoid` / `state` / `name` / `name_key`，文件头注释记录来源 URL 与生成日期）。运行时**只读**这个文件，不联网。

```bash
cd crawler
python3 scripts/refresh_jurisdictions.py        # 下载两个 gazetteer zip，重写 TSV 并打印变化
git diff --stat crawler/data/us_jurisdictions.tsv
```

来源是 Census 年度 gazetteer：`https://www2.census.gov/geo/docs/maps-data/data/gazetteer/<年份>_Gazetteer/` 下的 `<年份>_Gaz_counties_national.zip`（约 142 KB）与 `<年份>_Gaz_place_national.zip`（约 1.2 MB）。脚本会剔除 CDP 等非建制地名，只保留郡与建制市镇村。

建议**按年刷新**（Census 每年发新版），刷新后：

1. 看脚本打印的增删条数，异常（比如郡数大幅变化）就先停下来查；
2. `cd crawler && python3 -m pytest -q` 全绿；
3. TSV 与刷新脚本一起提交，commit message 写明 gazetteer 年份。

刷新脚本**不会**被运行时代码 import，它只是个一次性工具。

## 10. 边界

- 只读公开目录页：不注册账号、不登录、不绕 WAF、不解验证码。
- 不写数据库、不改任何治理列；所有新源仍须经前置检查与人工批准。
- 不做模糊名称匹配，不自动填 GEOID 猜测值。
- 本期只接 BidNet。CLI 以 `platform` 字段分派，接第二个平台只需加一个 harvester 和 `discovery_service.PLATFORMS` 里的一行。
- 发现结果是某一时刻的目录快照。机构会上线、改名、退出平台，所以每次批量注册前都应重新跑一次，而不是复用旧的 `candidates.json`。

## 首轮实测（2026-09-21，全量 BidNet）

命令（从 `crawler/` 运行，请求体见 `ops-evidence/bidnet-discovery-2026-09-21.request.json`）：

```bash
python3 -m apsi_crawler.cli discover-sources < request.json > candidates.json
```

完整输出存档于 `ops-evidence/bidnet-discovery-2026-09-21.json`（该目录已 gitignore，不入库）。

| 指标 | 数值 |
| --- | --- |
| 目录页数 / 机构总数 | 43 页 / 2,036 家 |
| 耗时 | 2 分 55 秒（3 秒间隔，`stopped_reason: exhausted`） |
| 分类 | 特别区 730、未知 361、市 659、郡 286 |
| 候选 | **819**（市 561 + 郡 258；精确 716 + 辖区前缀 103） |
| 待审阅 | 1,217（特别区 730、未知 361、无 FIPS 匹配 119、已注册 6、歧义 1） |

候选覆盖的州（前几位）：CO 179、MI 160、NY 104、CA 47、TX 43、AZ 42、NJ 37。

### 两轮之间修掉的问题

首轮 659 个候选、1,377 条待审阅。差异全部来自 `mitn` 组：它是 BidNet 的密歇根组（`/mitn` 标题为 "Michigan Bids…"，正文写明 "Michigan Inter-governmental Trade Network"），但 slug 不是州名，此前解析不出州码，导致 167 个郡/市机构被搁置在 `unresolved_state`。映射为 MI 后候选增加 160 个。

同一处修正还顺带消除了一个错误建议：首轮反查曾给俄亥俄的 `bidnet_oh_franklin` 建议密歇根的 "Village of Franklin"——反查按州过滤，但机构所属组解析不出州码时会放行。这也说明**当某个组不在 `/purchasing-groups` 清单上时（例如 `bgis`），仍可能出现跨州建议**，实测运行要盯住 `stats.unresolved_state_skipped`。

### 2026-09-16 遗留的四个源，目录给出的答案

| 源 | 目录反查 | 结论 |
| --- | --- | --- |
| `bidnet_oh_franklin` | `partial` → Franklin County Children Services（`/ohio/franklincountychildrensservices`） | 目录里没有"Franklin County"本身，只有这家独立机构。**不要**把旧行指过去——它是另一个采购主体；应把旧行标 `blocked`，需要的话把该机构作为新源注册 |
| `bidnet_oh_cuyahoga` | `none` | 目录查无此机构，标 `blocked` |
| `bidnet_oh_city_columbus` | `none` | 同上 |
| `bidnet_wy_laramie` | `none` | 同上 |

三个 `none` 的 `base_url` 2026-09-21 复测仍为 404。

**已处置（2026-09-21）**：四行均已按上表结论标记 `approval_status = blocked`、`is_enabled = 0`、`approved_for_ingestion = 0`，`approval_notes` 记录依据（目录反查结果、404 复测、证据文件路径），审计表留有 `approved → blocked` 记录。此前 `bidnet_oh_cuyahoga` 是已批准且已启用状态（2026-09-16 08:47 管理端批量批准工作流所为），`consecutive_failures` 已到 2；处置后复跑手动运行，四者均被拦下且不再累积失败。

### 未消化的 119 条无 FIPS 匹配

实测衡量过两条"安全"的补救规则，均不划算，故**未实现**：剥离机构名尾部的州缩写只救回 6 条，重音折叠 0 条。剩下的大多是"City of X 某某局"这类部门后缀，要救得对地名表做最长前缀匹配，而那会把 "City of Glendale Heights" 误配到 Glendale。这类按设计留在待审阅里由人判断。

郡一级不存在同类问题：`<X> County 某某局` 有 "County" 这个边界词，已由辖区前缀规则收回 103 条。
