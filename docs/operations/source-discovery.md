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

反过来，**同一个租户可以有两条路径**：目录里登记的是 `/colorado/city-of-aurora/…`，平台同时接受根级别名 `/city-of-aurora/…`，库里的 `bidnet_co_city_aurora` 存的正是后者。所以判断"是不是同一个租户"既不能比整条 URL，也不能比我们的 id，只能比 **slug**（`/solicitations` 之前的最后一段）：2026-09-21 全量目录 2,036 个租户的 slug 两两不同，也没有一个 slug 出现在两个组下。第 3 节的去重就按它来。

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

只要一个州：

```bash
cd crawler
echo '{"platform":"bidnet","states":["OH"]}' \
  | python -m apsi_crawler.cli discover-sources > /tmp/candidates-oh.json
```

**`states` 只过滤结果，不减少翻页**：目录是全平台一份、按机构名分页的，单州运行同样要翻完整个目录（2026-09-21 实测 43 页、约 3 分钟）。别为了"试跑"压低 `max_pages`——那样 `stopped_reason` 会是 `max_pages`，该州排在后面几页的机构就静悄悄地不见了，注册脚本也会拒收这份文件（第 4 节）。

全平台（2026-09-21 实测 43 页 / 2,036 家，3 秒间隔约 3 分钟，见第 8 节）：

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
| `levels` | `["county","city","township"]` | 只能从 `county` / `city` / `township` 里选。想只要郡就填 `["county"]`，被排除的那一级进 `review` |
| `max_pages` | `400` | 目录分页上限，钳制到 1..2000 |
| `min_interval_seconds` | `3` | 每次请求之间的最小间隔，钳制到 0..60 |
| `timeout_seconds` | `30` | 单次请求超时，钳制到 1..300 |
| `existing_sources` | `[]` | 库里已有的源：`{id, label, state_code, base_url, jurisdiction_level}`，除 `id` 外都可省。`base_url` 用于去重，`jurisdiction_level` 用于反查时确认级别（第 7 节） |
| `existing_ids` | `[]` | 只**占用** id（新候选撞上就加 `_2`），不用于判定"已注册" |
| `existing_base_urls` | `[]` | 已注册租户的地址，用于去重；与 `existing_ids` 是两张互不对应的清单 |

数值字段**静默钳制**（写 `max_pages: 0` 得到 1），结构字段（`levels`、`states`、`existing_*` 的类型）**报错退出 2**。推荐直接把下面这条 SQL 的结果行当 `existing_sources` 传入——一行同时给出 id、租户地址和级别：

```sql
SELECT id, label, state_code, base_url, jurisdiction_level FROM data_sources WHERE provider_family = 'bidnet';
```

**"已注册"只看租户，不看 id**（2026-09-23 QA C06）。一家机构的租户 slug 命中已登记的 `base_url`（`existing_sources[].base_url` 或 `existing_base_urls`）才算重复；只撞上已有 id 的是**另一个租户**，照常成为候选并加后缀。`Boulder County` 与 `City of Boulder` 的 `name_key` 都是 `boulder`：库里已有县源 `bidnet_co_boulder` 时，市级租户 `/colorado/city-of-boulder` 以 `bidnet_co_boulder_2` 进候选，而不是被当成已注册吞掉。因此**只给 `existing_ids`、不给任何已登记地址的请求会以退出码 2 拒绝**——没有地址就判不了重复，每个已登记租户都会以带后缀的新 id 再冒出来一次。

### 响应

```json
{
  "candidates": [ { …SourceCandidate 十一个字段…, "discovery": {…} } ],
  "review":     [ { "agencyName", "tenantUrl", "group", "reason", "detail" } ],
  "existingMatches": [ { "sourceId", "agencyName", "suggestedBaseUrl", "confidence" } ],
  "stats": { … }
}
```

**整份输出文件可以原样交给 `source:register`**（2026-09-23 QA C08b 之前它只认裸数组，按文档操作会报 `candidates is not iterable`）。`candidates[]` 的前十一个字段与 `frontend/scripts/register-sources.ts` 的 `SourceCandidate` **逐字段一致**；多出来的 `discovery` 块（`agencyName` / `group` / `matchedOn` / `confidence` / `matchedPrefix` / `stateSource`）只给审阅的人看，注册脚本会忽略它。`stateSource` 是 `"name"` 还是 `"group"`，即这条候选的州码是从机构名逗号后读出来的、还是沿用了采购组，见第 6 节"跨州命名"。跨语言契约由两侧测试共同守住：`crawler/tests/test_discover_sources_cli.py` 与 `frontend/scripts/register-sources.test.ts`。

`stats` 各字段：

| 字段 | 含义 |
| --- | --- |
| `pages` / `agencies` | 实际翻了几页、拿到几家机构 |
| `county` / `city` / `township` / `special_district` / `unknown` | 分类桶。恒等式：五者之和 **等于** `agencies` |
| `unmatched` | 进到 FIPS 匹配那一步却没匹配上的 county/city/township 数（`ambiguous` + `not_found`） |
| `prefix_matched` | 靠"郡名前缀"规则拿到 GEOID 的候选数，即 `confidence: "jurisdiction_prefix"` 的条数，见第 6 节 |
| `duplicates` | 租户已登记（slug 命中 `existing_sources[].base_url` / `existing_base_urls`）而跳过的机构数 |
| `harvest_duplicates` | 翻页过程中重复出现的租户路径数（采集器自己的去重计数，与上面一条不是一回事） |
| `unresolved_state_skipped` | 带 `states` 过滤时，采集器**自己**丢掉的无州码机构数。不带过滤时恒为 0（那时无州码机构会照常交过来，进 `review` 的 `unresolved_state`） |
| `stopped_reason` | `exhausted`（翻到最后一页，唯一表示"完整"的值）/ `max_pages` / `waf_challenge` / `fetch_failed`（普通抓取错误）/ `no_new_links`（翻页开始重复）。后四个都是**部分结果**：CLI 照样退出 0，已采集的部分照常返回 |
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

注册脚本接受两种文件：`discover-sources` 的原样输出，或裸 `SourceCandidate[]` 数组（`data/seed-sources/*.json` 就是后者）。其他形状直接报错退出 1，不会写库。读到发现输出时先打印一行摘要，确认这份文件是什么再往下看：

```
discover-sources output: 43 pages, 2036 agencies, stopped_reason=exhausted; 819 candidates, 1217 in review
```

`stopped_reason` 不是 `exhausted` 的文件，**真实运行一律拒收**（退出 1，不写库）；`--dry-run` 照常逐条校验，但同样以退出 1 告诉你真跑会被拒。部分结果里的候选单条都是对的，问题在于它不是整个目录——当成全量注册，是机构悄悄漏掉的方式。确认只想注册这一部分时加 `--allow-partial`。文件里没有 `stopped_reason`（例如人工删掉了 `stats`）时只打警告，因为那已经不是发现命令的原样输出了。

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
| `already_registered` | 租户 slug 命中已登记地址。`detail` 是持有该租户的源 id（请求里用 `existing_sources[].base_url` 给出时），否则是命中的那条已登记地址 | 正常，说明库里已有。只撞 id 不会进这里 |
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
| `township` | 名字含 township / twp（不分州），或者——只在 NY、CT、ME、MA、NH、RI、VT、WI 这八个州——以 town of 开头或以 town 结尾 |
| `city` | 名字以 city of / village of / borough of 开头，或以 city / village 结尾，或含 borough 且州不是 AK；八个 town-township 州**之外**，"town of …" / "… town" 也落进这一档 |
| `unknown` | 其余 |

**分类需要州码**，不是可有可无的参数：`borough` 在阿拉斯加是郡的对等物，在新泽西/宾州/康州却是普通市镇；"town" 在纽约、新英格兰各州与威斯康星是有自己政府的县以下行政区（civil township 在当地的叫法），在科罗拉多、新泽西等其余州只是一个普通建制市镇。忽略州码会把一批 NJ 的 borough 当成郡、或者把外州的 town 错当成 township 送去匹配，然后全部匹配失败进 `review`。所以 `discover_sources` 把每家机构的 `state_code` 一起传给分类器。

"City and County of Denver" 同时命中 county 与 city 两条，按 **`county`** 归类——与库里既有 `bidnet_co_denver` 的 `jurisdictionLevel: "county"` 一致。

### 跨州命名：逗号后面的州，与逗号结尾的州

两条独立规则，都只认**逗号**——名字中间提到某个州、但前面没有逗号，从来不算（`City of Idaho Springs`、`City of Iowa Park`、`Colorado River Indian Tribes` 都不受影响）：

- **机构自报的州覆盖采购组**（`apsi_crawler.us_states.name_state`，在 `discovery.bidnet` 里就用上，决定候选的 `state_code`）：名字里任意一个逗号后面紧跟着一个完整州名或两字母州码时，这个州覆盖 BidNet 采购组本身推出来的州——`Laramie County, Wyoming Government` 挂在 BidNet 的 `colorado` 采购组下，但按名字读出来的州是 `WY`。逗号后面接的是"州名 + 辖区词"（`, Washington County`、`, New York City`）不算，那是恰好与州同名的一个地名，不是在报州。名字里出现**两个不同的**逗号尾部州（`Tri-State Authority, NY, NJ`）时谁也证明不了，退回采购组本身的州。候选的 `discovery.stateSource` 记着这次到底是 `"name"` 还是 `"group"`。
- **逗号结尾的州不算辖区名字的一部分**（`apsi_crawler.us_states.strip_state_suffix`，`discovery_service` 在分类、匹配、生成 id 之前先调用它）：只有整个名字**恰好以** ", <两字母州码>" 或 ", <州全名>" 结尾才会被去掉——`Town of Dover, NY` 按 `Town of Dover` 去分类、匹配、生成 id；`Laramie County, Wyoming Government` 结尾是 "Wyoming Government" 不是单纯的州名，整段原样保留（前一条规则因此还能从里面读出 `Wyoming`）。`label` 与 `discovery.agencyName` 始终保留机构的原名，包括这个州尾巴。

### 为什么不注册特别区

决策 3（用户 2026-09-21 确认）：目录里**绝大多数**是学区、水务、消防、图书馆、交通、大学，真正的郡/市是少数。这些特别区的采购品类与 APSi 的目标供应商大多不相干，全量注册只会把源健康面板和调度预算稀释掉，而每一个源都还要走一遍人工合规批准。所以它们进 `review` 计数、保留人工捞回的可能，但不进 `candidates`。

### FIPS 匹配（`match_jurisdiction`）

- 归一化 `name_key`：转小写、去标点、折叠空格、去前缀 `city of` / `town of` / `village of` / `county of` / `city and county of` / `township of` / `charter township of`、反复去后缀 `county` / `parish` / `borough` / `city` / `town` / `village` / `township` / `twp`——剥掉 `township` / `twp` 后如果剩下的末词是 `charter`，一并剥掉（"Delta Charter Township" → `delta`）。
- 在**同一州内**按 `name_key` 精确匹配；`county` 查 county 行，`city` 查 place 行，`township` **只查 `cousub` 行**——Census 把 town/township 单独存一张表，与郡、市镇村分开（第 9 节）。唯一命中 → `discovery.confidence: "exact"`，`discovery.matchedPrefix: null`。
- 机构名里带 "Charter" 时，`township` 的匹配只在名字以 "... charter township" 结尾的行里找；不带 "Charter" 时普通 township 与 charter township 两类都在候选之内——名字没提 "Charter"，不代表实际不是 charter township。
- **郡名前缀规则**（仅 `county`、仅在精确匹配失败后）：机构名以 `<X> County` / `<X> Parish` 开头，且 `<X>` 在该州唯一对应一个郡时，取那个郡的 GEOID，记 `discovery.confidence: "jurisdiction_prefix"`、`discovery.matchedPrefix: "<X> County"`，计入 `stats.prefix_matched`。这样 `Alameda County Public Works Agency`、`Archuleta County Sheriff's Office` 这类**郡下属采购部门**才能进候选，而不是被整批丢掉。**`township` 与 `city` 都没有这条前缀规则**，只有 `county` 有。
- 命中多个（`ambiguous_match`）或零个（`no_fips_match`）→ 不进 `candidates`，进 `review`。`township` 尤其容易撞上同州同名：密歇根不止一个县下面都有 `Richmond Township`，纽约不止一个郡下面都有 `Town of Clinton`，目录里的机构名又不带郡名，这类一律判 `ambiguous_match`，不猜。

**仍然不做模糊匹配。** 前缀规则不是模糊匹配：它要求机构名以一个**完整、精确、在该州唯一**的郡名开头，命中的是那个郡确切的 GEOID。真正的模糊匹配（编辑距离、词重合度之类）一律不做——一个错的 GEOID 不会报错，只会安静地把这个源挂到别的辖区上，之后所有按辖区的筛选、提醒与统计都跟着错。宁可让人补一个空值，也不猜。

前缀规则的代价是：`jurisdiction_prefix` 候选的 `fipsCode` 是**它所属的郡**，不是这个部门自己（部门本来也没有 GEOID）。所以同一个郡的多个部门会共用一个 `fipsCode`，审阅时要按第 5 节第 3 条确认。

### id 规则

`bidnet_<州码小写>_<name_key>`（非字母数字折成 `_`），例如 `Cuyahoga County` (OH) → `bidnet_oh_cuyahoga`。**`township` 级别多加一段类型词**：`bidnet_<州>_<name_key>_town` 或 `..._township`，取自匹配到的 Census 名称结尾（`Rye town` → `_town`，`Bloomfield charter township` → `_township`）——这段后缀不是撞名以后才追加的 `_2`，而是每条 township 候选都会有的。纽约 `Town of Rye` 与 `City of Rye` 的 `name_key` 都是 `rye`：前者是 `bidnet_ny_rye_town`，后者是普通的 `bidnet_ny_rye`，两个真实存在、都该留着的源不会有一个被挤成看不出意义的 `_2`。同一次运行内仍然撞名，或撞上请求里任何已有 id（`existing_ids` 与 `existing_sources[].id`），照常追加 `_2`、`_3`。id 只是名字：撞 id 永远不等于"已注册"，见第 3 节。

## 7. 收尾 2026-09-16 遗留的四个 404 源

`bidnet_oh_city_columbus`、`bidnet_oh_cuyahoga`、`bidnet_oh_franklin`、`bidnet_wy_laramie` 当时探测六个候选路径全部 404，没有可写回的建议路径，一直挂在未批准状态。用 `existing_sources` 让发现命令替它们反查目录：

```bash
cd crawler
cat <<'JSON' | python -m apsi_crawler.cli discover-sources > /tmp/pending.json
{
  "platform": "bidnet",
  "states": ["OH", "WY"],
  "existing_sources": [
    {"id": "bidnet_oh_city_columbus", "label": "City of Columbus, OH (BidNet)", "state_code": "OH", "jurisdiction_level": "city"},
    {"id": "bidnet_oh_cuyahoga",      "label": "Cuyahoga County, OH (BidNet)",  "state_code": "OH", "jurisdiction_level": "county"},
    {"id": "bidnet_oh_franklin",      "label": "Franklin County, OH (BidNet)",  "state_code": "OH", "jurisdiction_level": "county"},
    {"id": "bidnet_wy_laramie",       "label": "Laramie County, WY (BidNet)",   "state_code": "WY", "jurisdiction_level": "county"}
  ]
}
JSON
python3 -c 'import json;print(json.dumps(json.load(open("/tmp/pending.json"))["existingMatches"],indent=2))'
```

反查先按 `name_key` 找名字对得上的目录行，再**确认州与级别**（2026-09-23 QA C07）：只有双方州码都已知且相同、级别都已知且相同，才给 `suggestedBaseUrl`。源的级别取请求里的 `jurisdiction_level`，没给就按目录机构同一套规则分类它的 `label`。原因是 `Boulder County` 与 `City of Boulder` 的 `name_key` 都是 `boulder`：修复前县源 `bidnet_co_boulder` 会同时收到两条 `exact`，采纳第二条就等于把县源的 `base_url` 换成市级租户——县的招标从此漏抓，辖区数据也跟着错。

名字对得上、但州或级别确认不了的行**不丢**（"目录里有个同名的别级机构"本身也是线索），只是不给地址。结论按下表逐级取第一个非空的一档，每个源至少一行：

| `confidence` | 含义 | 处理 |
| --- | --- | --- |
| `exact` | 归一化名字完全一致，州、级别均已确认 | 核对页面标题确属本辖区 → 在数据源表把 `base_url` 改成 `suggestedBaseUrl` → 重跑前置检查 → 走批准表单 |
| `partial` | 目录名字是库里名字的扩展（或反之），州、级别均已确认，可能有多条 | **逐条打开看**。确认是同一个采购单位才写回；拿不准就留空 |
| `level_mismatch` | 名字对得上，但双方级别不同（县源对上了市、特别区等） | `suggestedBaseUrl` 为 `null`。**不要**写回——那是另一个辖区。需要看租户地址时，按 `agencyName` 去 `candidates[]` / `review[]` 里找 |
| `state_unconfirmed` | 名字对得上，但有一方没有州码（机构所属组解析不出州，或源没填 `state_code`） | `suggestedBaseUrl` 为 `null`。先查清机构属于哪个州再说 |
| `level_unconfirmed` | 名字对得上、州一致，但有一方级别是 `unknown` | `suggestedBaseUrl` 为 `null`。请求里补上 `jurisdiction_level` 通常就能确认 |
| `none` | 目录里查无此机构 | 这就是把该行标 `blocked` 的证据：`PATCH /api/admin/data-sources/[id]`，`approvalStatus=blocked`、`approvalNotes` 写明"2026-09-21 目录反查未命中" |

同一行名字既对不上级别、又缺州码时，记 `level_mismatch`——矛盾比缺证据更说明问题。只要有一条确认过的 `exact` 或 `partial`，下面几档就不再列出。

`existingMatches` **只建议、不写库**，写回 `base_url` 仍然是管理端上的一次人工确认操作（`local-source-approval.md` 第 4.2 节）。

**`bidnet_wy_laramie` 现在能被反查修正**：Laramie County, WY 在 BidNet 目录里登记的名字其实是 `Laramie County, Wyoming Government`，挂在 `colorado` 采购组下（不是 `wyoming`）——这正是它此前反查落空、六个候选路径全部 404 的原因。第 6 节的跨州命名规则会从名字本身（逗号后的 "Wyoming"）读出州码 `WY`（`discovery.stateSource: "name"`），不再沿用 `colorado` 组推出的 `CO`，于是同样的反查请求现在会给出 `confidence: "partial"`、`suggestedBaseUrl` 指向该租户（`/colorado/laramiecountywyominggovernment/solicitations/open-bids`）。处理方式与上表的 `partial` 一致：核对页面标题确属 Laramie County 本身后，`PATCH /api/admin/data-sources/bidnet_wy_laramie` 把 `base_url` 改过去，再重跑前置检查——**不要**另外注册一个新源。同一次 `discover-sources` 输出的 `candidates[]` 也会带一条指向同一租户的新候选（如 `bidnet_wy_laramie_county_wyoming_government`）——两边都落库就是同一个租户页被两个 id 抓两遍，与下一段 Franklin 的情形是同一类问题。好在这次不需要手工排查：`source:register`（`frontend/scripts/register-sources.ts`）会替你把关，候选的 `baseUrl` 命中 `existingMatches` 里某条已确认（`exact`/`partial`）建议时，默认**扣下这条候选不注册**，只打印一行提示，例如"改指 `bidnet_wy_laramie`，PATCH `/api/admin/data-sources/bidnet_wy_laramie`"。确认建议是错的时（比如反查命中的其实是该郡下独立发标的一个部门，而不是郡本身），加 `--allow-suggested` 照常把候选注册成新源。

**同一次运行里当心重复登记**：给 `bidnet_oh_franklin` 建议 `…/franklincountychildrensservices/…` 的那一次运行，`candidates[]` 里**同时**会有一条指向同一租户的 `bidnet_oh_franklin_county_children_services`（郡名前缀规则捞回来的）。两边都落库就等于把同一个租户页按两个 id 抓两遍。二选一：要么把已有行的 `base_url` 改过去、从 `candidates.json` 里删掉那条新候选，要么注册新候选、把旧行标 `blocked`。把旧行的 `base_url` 放进 `existing_base_urls` 是防不住的——旧行存的正是那个 404 的地址。

## 8. 成本与礼貌

- 目录每页 48 家。2026-09-21 实测全平台 43 页 / 2,036 家，按默认 3 秒间隔约 **3 分钟**一次（设计时按"上万家、200–400 页"估的上限偏大）。
- **手动、低频**：建议按季度或有需要时才跑，不做 worker、不进调度。这是有意的决策 5。
- 用 `states` 只审一个州的结果很方便，但它**不省翻页**：单州运行同样翻完整个目录（第 3 节）。
- `max_pages` 是硬上限，触顶记 `stopped_reason: "max_pages"`，不会无限翻。
- 全程复用 crawler 的浏览器请求头与最小间隔；遇挑战立刻停，不重试、不加压。

## 9. Census 表怎么刷新

匹配用的是仓库内置的离线表 `crawler/data/us_jurisdictions.tsv`（列 `level` / `geoid` / `state` / `name` / `name_key`；`level` 现在有三种：`county`、`place`、`cousub`）。运行时**只读**这个文件，不联网。文件头是一组注释行，记录三个来源 URL（`# source_counties:` / `# source_places:` / `# source_cousubs:`）、两条过滤规则说明（`# place_filter:` / `# cousub_filter:`）和一行行数汇总（`# rows: <郡数> counties + <市镇村数> places + <cousub 数> cousubs`，当前是 `3222 counties + 19512 places + 16092 cousubs`）。

```bash
cd crawler
python3 scripts/refresh_jurisdictions.py        # 下载三个 gazetteer zip（郡、市镇村、县以下行政区），重写 TSV 并打印变化
git diff --stat crawler/data/us_jurisdictions.tsv

# 三个 zip 都已经下载到本地时可以离线重跑，各自对应一个 --*-zip 参数：
python3 scripts/refresh_jurisdictions.py \
  --counties-zip 2024_Gaz_counties_national.zip \
  --places-zip 2024_Gaz_place_national.zip \
  --cousubs-zip 2024_Gaz_cousubs_national.zip
```

来源是 Census 年度 gazetteer：`https://www2.census.gov/geo/docs/maps-data/data/gazetteer/<年份>_Gazetteer/` 下的 `<年份>_Gaz_counties_national.zip`（约 142 KB）、`<年份>_Gaz_place_national.zip`（约 1.2 MB）与 `<年份>_Gaz_cousubs_national.zip`（县以下行政区，2026-09 新增）。郡文件没有 LSAD 列、整份保留；市镇村文件剔除 CDP 等非建制统计地名；县以下行政区文件只保留 `FUNCSTAT = A`（在运作、提供一般性政府职能）且名字以 `town` 或 `township` 结尾的行（`charter township` 本身以 `township` 结尾，一并收进）——统计性的 CCD、无建制领地、种植地、grant 等一律不收；一个地方如果同时是建制市/镇又被记成县以下行政区，仍然只算市镇村表的一条，不在 `cousub` 里重复出现。

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
- **已知限制（未修）：`Charter Township of Port Huron` 会被判成特别区**。特别区规则里的整词 `port` 命中了 "Port Huron" 里的 "Port"，而特别区规则排在 `township` 之前，所以这条机构名分类成 `special_district`，进 `review` 而不是候选。
- **已知限制（未修）：Utah 的 "metro township" 匹配不到**。Census 把 Copperton、Emigration Canyon、Kearns、Magna、White City 这五个 Utah 地名登记成建制市镇（`place`，LSAD 是 "metro township"），不是县以下行政区（`cousub`）；`township` 级别只查 `cousub` 行，所以名字含 "township" 又指向这五处之一的机构会匹配失败，落进 `review`（`no_fips_match`）而不是候选。附带影响：`township`/`twp` 加入 `name_key` 的尾部去除词之后，这五个 `place` 行的 key 从整段变成去掉最后一词（如 `kearns metro township` → `kearns metro`）；地名表和郡表里没有别的名字撞上这五个新 key，其余匹配结果不受影响。
- **已知限制（未修）：密歇根 charter township 的 Census 名可能不带 charter**。机构名带 "Charter" 时只匹配 `… charter township` 行（第 6 节规则），而 Census 把 Brighton / Northville / East China 这三个 charter township 记为普通的 `Brighton township` 等 → `no_fips_match`。2026-09-21 目录里有 3 家这样的机构。放宽（同州没有 charter 行时回退到普通 township 行，仍是精确、同州、唯一）需要先改设计稿，本轮不改。
- **已知限制（未修）：Census 记为 place 的 town 政府**。8 个 town 州里叫 "Town of X" 的机构按 `township` 只查 `cousub` 行；马萨诸塞采用市政府形式的 town 在 Census 里是 place `X Town city`（表里 13 行），所以 `Town of West Springfield` → `no_fips_match`（阶段 2 之前它按 city 配到 place `2577890`）；康涅狄格的合并市镇同理（`Town of Hartford` 查不到，`City of Hartford` 能配上）。这是阶段 2 唯一的匹配回退。修法（例如把 `… Town city` 行纳入 township 匹配并把 designation 记为 `town`）需要先改设计稿，本轮不改；**不要**加盲目的 place 回退——`Town of Rye` → `Rye city` 正是阶段 2 修掉的错误。

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

> **2026-09-23 修正后按同一份目录离线重放**（QA 报告 C06/C07，见 `docs/qa/crawler-discovery-test-report-2026-09-23.md` 的"修复结果"一节）：候选仍是 819、待审阅仍是 1,217、已注册仍是 6，但其中两条换了人——`City of Boulder`（`/colorado/city-of-boulder`，GEOID `0807850`）原先因为撞上县源 id 被吞掉，现在以 `bidnet_co_boulder_2` 进候选；原候选 `bidnet_co_aurora`（`/colorado/city-of-aurora`）其实就是已登记的 `bidnet_co_city_aurora`（根级别名 `/city-of-aurora`），现在按 slug 判为已注册。`Washtenaw County` 仍是已注册，但理由从"撞 id"变成了"slug 命中根级别名 `/washtenaw-county`"。`bidnet_co_boulder` 的反查只剩 `Boulder County` 一条 `exact`。

候选覆盖的州（前几位）：CO 179、MI 160、NY 104、CA 47、TX 43、AZ 42、NJ 37。

### 两轮之间修掉的问题

首轮 659 个候选、1,377 条待审阅。差异全部来自 `mitn` 组：它是 BidNet 的密歇根组（`/mitn` 标题为 "Michigan Bids…"，正文写明 "Michigan Inter-governmental Trade Network"），但 slug 不是州名，此前解析不出州码，导致 167 个郡/市机构被搁置在 `unresolved_state`。映射为 MI 后候选增加 160 个。

同一处修正还顺带消除了一个错误建议：首轮反查曾给俄亥俄的 `bidnet_oh_franklin` 建议密歇根的 "Village of Franklin"——反查按州过滤，但机构所属组解析不出州码时会放行。2026-09-23 起这条路也堵上了：州码缺失的一方只会得到不带地址的 `state_unconfirmed`（这个例子里县对市，记 `level_mismatch`），不再是 `exact` 建议（第 7 节）。

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

## 第二轮实测（阶段 2，2026-09-28）

阶段 2（township/town 发现，设计稿 `docs/superpowers/specs/2026-09-24-county-data-completeness-design.md` §6，验收标准 §12.2）合入后的实测分两步：先用 2026-09-21 那份目录快照做**离线回放**（同一份输入、只换代码，量的是代码本身带来的变化），再对目录**线上重跑**一次。门禁先过：`crawler` pytest 852 通过、`frontend` vitest 2,166 通过、lint 干净（4ee18ca）。请求体 `ops-evidence/bidnet-discovery-2026-09-28.request.json`，`existing_sources` 是本地 MySQL `data_sources` 里全部 10 个 BidNet 行（带 `jurisdiction_level`）。

### 离线回放（2026-09-21 目录快照 × 阶段 2 代码）

`ops-evidence/phase2-replay.py` 把 2026-09-21 存档里每家机构的机构名、租户 URL、采购组还原成采集器的输出（2,036 家，URL 重建 0 处不一致），经 `discover_sources(harvest=…)` 注入，不碰网络；页序丢失只会影响撞 id 时的 `_2` 后缀。输出存档 `ops-evidence/bidnet-discovery-2026-09-28.replay-of-2026-09-21.json`，数字由 `ops-evidence/phase2-acceptance.py` 统计（该目录 gitignore，不入库）。

| 指标 | 2026-09-21（阶段 2 前的代码） | 回放（阶段 2 代码） |
| --- | --- | --- |
| 分类 | 郡 286、市 659、特别区 730、未知 361 | 郡 286、市 576、**township 163**、特别区 730、未知 281（五者之和 2,036 = 机构数） |
| 候选 | 819（郡 258 + 市 561） | **955**（郡 259 + 市 552 + **township 144**） |
| 待审阅 | 1,217（特别区 730、未知 361、无 FIPS 匹配 119、已注册 6、歧义 1） | 1,081（特别区 730、未知 281、无 FIPS 匹配 55、已注册 6、歧义 9） |
| 反查 `bidnet_wy_laramie` | `none` | **`partial`** → `/colorado/laramiecountywyominggovernment` |
| `discovery.stateSource = "name"` | （无此字段） | 1 个候选（Laramie County, Wyoming Government） |

**township 候选 144 个**：`_town` 76、`_township` 68；按州 NY 53、MI 43、NJ 25、RI 18、MA 4、VT 1；全部 `exact`，GEOID 全部 10 位；144 个机构名都含 town / township / twp。

**纽约 11 个 town**（§12.2 的硬指标）：首轮把它们当 `city` 配到了 7 位的村/市 place GEOID（`bidnet_ny_colonie` → `3617332` 是 Colonie 村），回放后 10 个成为 `township` 候选并拿到 10 位 town GEOID，Town of Clinton 按设计进 `ambiguous_match`（纽约有两个 Clinton town：`3601916397`、`3602716408`），没有一个再配到村/市：

| 机构 | 首轮（错配到 place） | 回放 |
| --- | --- | --- |
| Town of Colonie | `bidnet_ny_colonie` → 3617332 | `bidnet_ny_colonie_town` → 3600117343 |
| Town of DeRuyter | 3620390 | `bidnet_ny_deruyter_town` → 3605320401 |
| Town of Ithaca | 3638077 | `bidnet_ny_ithaca_town` → 3610938088 |
| Town of Mamaroneck | 3644831 | `bidnet_ny_mamaroneck_town` → 3611944842 |
| Town of New Paltz | 3650551 | `bidnet_ny_new_paltz_town` → 3611150562 |
| Town of Newburgh | 3650034（`bidnet_ny_newburgh_2`） | `bidnet_ny_newburgh_town` → 3607150045 |
| Town of Ossining | 3655530 | `bidnet_ny_ossining_town` → 3611955541 |
| Town of Pawling | 3656814 | `bidnet_ny_pawling_town` → 3602756825 |
| Town of Rye | 3664309（`bidnet_ny_rye_2`） | `bidnet_ny_rye_town` → 3611964320 |
| Town of Tupper Lake | 3675671 | `bidnet_ny_tupper_lake_town` → 3603375676 |
| Town of Clinton | `bidnet_ny_clinton_2` | `ambiguous_match`（两个 Clinton town） |

**歧义 9 条**：8 条是同州同名 township——NY Town of Clinton；MI Bloomfield / Bruce / Deerfield / Park / Richmond / Tyrone Township；NJ Township of Hopewell——都按"不猜"的规则留给人判。另 1 条 City of Garden City（MI，village 与 city 同键）是首轮就有的那条。

**无 FIPS 匹配 119 → 55**（"未知" 361 → 281）：减少的都是被 township 规则收回的 town / township。剩下 55 条里 14 条名字含 town / township，分四类：

- 某 town 的下属部门或机构（Colonie IDA、Mount Hope Highway Department、Exeter Emergency Management、Los Gatos Parks & Public Works、North Hempstead CDA、Clinton Historical Society、Superior Township Clerk）——按设计不匹配。
- **3 个密歇根 charter township**（Brighton、Northville、East China）：机构名带 "Charter"，Census 的 cousub 名却只是 `Brighton township` 等，"含 Charter 只配 charter 行"的规则（第 6 节）让它们落空。
- **MA 的 "Town city"**：`Town of West Springfield` 在 Census 里是 place `West Springfield Town city`（采用市政府形式的 town），不在 town / township 后缀过滤后的 cousub 表里；首轮它以 `city` 配到了该 place，回放后反而落空——阶段 2 唯一的匹配回退。
- 缩写与新建制：`Mt. Olive Township`（NJ，表里是 `Mount Olive township`）、`Town of MT. Crested Butte`（CO，`Mount Crested Butte town`）按"不做模糊匹配"留在待审阅；`Town of Keystone`（CO，2024 年建制）在 2024 gazetteer 里还没有行。

第二、三类记为已知局限：是否在阶段 3 放宽（同州没有 charter 行时回退到普通 township 行；把 `… Town city` 纳入 township 匹配）由人决定，本轮不改规则。

**回归对比**（按租户比较）：首轮 819 个候选里 3 个租户不再是候选，均有解释——`bidnet_co_aurora`（就是已登记的 `bidnet_co_city_aurora`，slug 去重）、`bidnet_ny_clinton_2`（改判歧义）、`bidnet_ma_west_springfield`（Town city）。10 个纽约 town 换了 GEOID（上表），其余郡/市候选的 GEOID 一个都没变。新增郡/市候选 5 个：City of Boulder（去重修正）、Laramie County（逗号后州名规则，郡前缀匹配到 `56021`）、`City of Conway, SC` / `City of Muskegon, MI` / `City of South Fulton, GA`（拖尾州名规则，首轮都是无 FIPS 匹配）。同一条规则还让 1 个已有候选换了 id：Madison County, AL 从前缀匹配的 `bidnet_al_madison_county_al` 变成精确匹配的 `bidnet_al_madison`（同一租户、同一 GEOID `01089`）。按 id 比较另有两处改名：纽约 Mamaroneck、Ossining 两个村从 `_2` 回到裸 id——首轮里 Town 与 Village 都被配到了村的 GEOID（`3644831` / `3655530`），现在 town 各自拿到 10 位 GEOID，村保留原 place GEOID。

**反查**：`bidnet_wy_laramie` 得到 `partial` 建议（`Laramie County, Wyoming Government`，在 colorado 组下，`stateSource = "name"`），处置见第 7 节；同一家机构也以 `bidnet_wy_laramie_county_wyoming_government` 出现在候选里，`source:register` 会把它扣下并打印应做的 PATCH。`bidnet_oh_franklin` 仍是 Franklin County Children Services 的 `partial`，结论不变（另一采购主体，不要指过去）。已批准的 6 个源 `exact` 且地址与登记一致；Columbus、Cuyahoga 仍 `none`。

### 线上重跑（2026-09-28）

- 07:21Z 第一次全量运行：目录第 1 页即返回 WAF 挑战，`stopped_reason = "waf_challenge"`、0 页、共 1 次请求，运行按边界立即停止（当天早些时候刚跑过 6 个 BidNet 源的完整开放列表，见 `bid-lifecycle-and-crawl-budget.md` 第 7 节）。
- 07:33Z 冷却约 10 分钟后单页探测：仍是挑战。
- 08:04Z 再冷却约 30 分钟后单页探测：仍是挑战（三次都卡在采集器的第一个请求 `/purchasing-groups`，各 1 次请求）。
- 08:26Z 诊断探测（同一套浏览器请求头，只发 1 次 GET，保存状态与正文）：`/purchasing-groups` 返回 **HTTP 200**、完整页面（53,593 字节，标题 "Government Purchasing Groups | BidNet Direct"，49 个采购组链接），但 `looks_like_waf_challenge()` 判为挑战。原因：BidNet 现在在每个普通页面里都嵌入 AWS WAF 的 SDK 脚本 `<script src="https://….sdk.awswaf.com/…/challenge.js" defer>`，探测器的子串标记 `awswaf` / `challenge.js` 命中了这个脚本地址——**三次"挑战"都是探测器误判，不是拦截**。蜘蛛侧（`spiders/co_bidnet.py`）只按 HTTP 202 判定，所以同一天早上的 6 个租户列表运行不受影响。修复见 `7fe5d73`（`crawler/apsi_crawler/discovery/bidnet.py`；注释补充 `1c90060`）：先剥掉带 `src` 的外链 script 元素再匹配标记（真实拦截页会在内联脚本里运行 `AwsWafIntegration.checkForceRefresh()`，而且通常是 202，两条路都照旧停止运行）；真实页面存为 fixture `crawler/tests/fixtures/discovery/bidnet_purchasing_groups_with_waf_sdk.html`。
- 08:52:58Z 修复后第二次全量运行（在 `7fe5d73` 上）：exit 0，`stopped_reason = "exhausted"`，43 页（连同 `/purchasing-groups` 共 44 次请求，3 秒间隔），2 分 52 秒，2,037 家机构——比 2026-09-21 多 1 家（新登记的特别区 Alfred-Almond Central School）。输出存档 `ops-evidence/bidnet-discovery-2026-09-28.json`。

| 指标 | 线上重跑（2026-09-28） |
| --- | --- |
| 分类 | 郡 286、市 576、township 163、特别区 731、未知 281（五者之和 2,037 = 机构数） |
| 候选 | **955**（郡 259 + 市 552 + township 144） |
| 待审阅 | 1,082（特别区 731、未知 281、无 FIPS 匹配 55、已注册 6、歧义 9） |
| township 候选 | 144：`_town` 76、`_township` 68；NY 53、MI 43、NJ 25、RI 18、MA 4、VT 1；全部 `exact`，GEOID 全部 10 位 |
| 纽约 11 个 town | 10 个 township 候选（GEOID 与上表逐一相同）+ Town of Clinton `ambiguous_match`（两个 Clinton town） |
| 反查 | 6 个已批准源 `exact` 且地址一致；`bidnet_wy_laramie` **`partial`** → `/colorado/laramiecountywyominggovernment`；`bidnet_oh_franklin` `partial`（另一采购主体，不指过去）；Columbus / Cuyahoga `none` |
| `discovery.stateSource = "name"` | 1 个候选（Laramie County, Wyoming Government） |

与离线回放逐项一致：除了那 1 家新特别区，分类、候选、待审阅、歧义、无 FIPS 匹配的每一个数字都相同。候选覆盖的州（前几位）：MI 204、CO 179、NY 146、NJ 62、CA 47、TX 43、AZ 42、GA 28（首轮是 CO 179、MI 160、NY 104——密歇根和纽约的增量主要是 township；纽约的 10 个 town 从市一栏挪到了 township 一栏，所以纽约的净增量小于其 53 个 township 候选）。

两点顺带的观察：

- **租户 slug 会变。** Chautauqua County（NY）2026-09-21 的路径是 `/new-york/chautauqua-county`，今天是 `/new-york/chautauquacounty`。去重按 slug，所以一个已登记的源如果被平台改了 slug，会在下一次发现里显示为"未登记"并再次成为候选——审阅时看到同名同州的候选，先核对旧行的 `base_url` 是否已经 404，改指旧行而不是另注册。
- **同键的郡与市，`_2` 后缀取决于目录顺序。** `City of Muskegon, MI` 与 `Muskegon County` 都键到 `muskegon`：线上按目录顺序市拿到 `bidnet_mi_muskegon`、郡拿到 `bidnet_mi_muskegon_2`，离线回放里正相反。注册时 `source:register` 会按库里已有的 id 重新加后缀，slug 去重保证同一租户不会登记两次，但**不要**凭 id 猜它是郡还是市——看 `jurisdictionLevel` 和 `baseUrl`。

**§12.2 阶段 2 验收**：新增 township/town 候选 144 个（已记录）；纽约 11 个 town 的 GEOID 全部正确——10 个拿到 10 位 town GEOID，Town of Clinton 按设计因两个同名 town 进歧义而不是错配到村/市；`bidnet_wy_laramie` 拿到 `partial` 建议。三项均达成。注册候选是阶段 3 的事，本轮没有写 `data_sources`。
