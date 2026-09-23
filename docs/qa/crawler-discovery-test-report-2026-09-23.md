# 爬虫更新测试场景与执行报告（2026-09-23）

## 范围与判定

本轮核对 `14ea1a5..87e760b`：BidNet 公开机构目录发现、辖区分类与 Census GEOID 匹配、候选注册契约，以及最近的“未运行源不计失败”修正。防遗漏按三个关口判断：目录抓到的机构是否全部进入候选或待审、应注册的机构是否被错误去重、列表/详情重抓后已入库数据是否保留。

测试使用仓库存档 HTML、2026-09-21 的全量发现 JSON、临时 SQLite、独立 Docker MySQL 8.4.9 和本地抽取服务。未请求线上门户，未修改业务数据库。存档快照不是 2026-09-23 的线上覆盖率证明。

## 测试用例矩阵

| 编号 | 场景与关键断言 | 执行证据 | 结果 |
| --- | --- | --- | --- |
| C01 | 目录两页、末页、单段租户路径、HTML 实体、非租户链接；每页卡片数量及租户路径正确 | `test_discovery_bidnet.py`，存档前两页各 48 条 | 通过 |
| C02 | 分页结束、重复页、页数上限；HTTP 202/挑战页/普通抓取错误时停止并保留已取得机构；请求间隔与请求头正确 | `test_discovery_bidnet.py` | 通过；部分运行需看 `stopped_reason` |
| C03 | 州过滤、`mitn → MI`、无法定位州的分组；未识别州不混入指定州候选 | `test_discovery_bidnet.py` | 通过 |
| C04 | 特别区优先、县/市/未知分类；AK borough 为县、NJ borough 为市；分类桶总数等于机构数 | `test_jurisdictions.py`、`test_discover_sources_cli.py` | 通过 |
| C05 | 同州 GEOID 精确匹配、县级部门前缀匹配、跨州隔离、重名歧义与无匹配进入待审 | `test_jurisdictions.py`、`test_discover_sources_cli.py` | 通过 |
| C06 | 新候选 ID/URL 唯一、已登记源去重、同名县市撞上已有 ID 时仍保留不同租户 | 单元测试 + 全量存档核对 | **失败：City of Boulder 被误判已注册** |
| C07 | 已有源反查的名称、辖区级别和州一致；不能给县源返回市级 `exact` 建议 | 全量存档 + 最小复现 | **失败：Boulder County 收到 City of Boulder 的 `exact` 建议** |
| C08a | CLI 请求校验、单 JSON 输出、错误退出码；单条 Python 候选符合 Node `SourceCandidate`，注册后审批仍为空 | `test_discover_sources_cli.py`、`register-sources.test.ts`；819 条存档候选均通过 Node 校验 | 通过 |
| C08b | 将 `discover-sources` 原样输出交给文档中的 `source:register --dry-run` | 使用存档 JSON 真正执行命令 | **失败：顶层对象与数组契约不一致** |
| C09 | 手动与调度：治理拦截、禁用、锁占用、平台延后不计失败；真失败和未知 ID 计失败；跳过不写健康 | 前端 crawler/API 相关测试 | 通过 |
| C10 | 列表、详情、日期窗口、附件、重复导入、SQLite 事务和展示/搜索；列表重抓不清除已补正文及附件 | crawler 全套 + 前端 crawler 测试 + SQLite 离线集成 | 通过 |
| C11 | 抽取服务与浏览器下载服务的解析、重定向、登录墙和附件守卫 | 两个独立 pytest 套件 | 通过 |
| C12 | 真实 MySQL 事务、回滚、锁失效和重新导入；发现候选注册、待审批门禁、重复注册保留审批 | 独立 Docker MySQL 8.4.9，集成测试 7/7 通过 | 通过 |

## 执行结果

- `PYTHONPATH=crawler python3 -m pytest crawler/tests -q -rx`：678 通过、2 个严格预期失败（C06/C07）、0 个意外失败；1 个 `urllib3`/LibreSSL 环境警告。两个预期失败已固化为测试，修复后须移除 `xfail` 并确认断言通过。
- 对 C06/C07 使用 `--runxfail` 单独运行：2 例均按预期失败。C06 实际候选为 `[]`，应含 `bidnet_co_boulder_2`；C07 实际多返回一条 `City of Boulder` 的 `exact` 建议。
- `services/scrapling-extractor/.venv/bin/python -m pytest tests -q`：115 通过，0 失败；51 个 `lxml` 弃用警告。
- `services/browser-downloader/.venv/bin/python -m pytest tests -q`：151 通过，0 失败。
- `frontend/npm test -- --run src/server/crawler src/app/api/crawler/state/run/route.test.ts src/app/api/crawler/sam-gov/run/route.test.ts scripts/register-sources.test.ts`：267 通过，2 跳过；另 1 个测试文件跳过。
- `frontend/npm test`：2099 通过，2 跳过；另 1 个测试文件跳过（含新增的文件交接黑盒用例）。
- 启用 `RUN_CRAWLER_INTEGRATION=1` 并指向独立 MySQL 容器后执行完整 `frontend/npm test`：319 个测试文件、2106 例全部通过，0 跳过。
- `frontend/npm run lint`：退出码 0。
- `frontend/npm run build`：生产构建与 TypeScript 检查通过。本机 Node.js 为 24.14.1；仓库建议的 Node.js 20 未在本机验证。
- `CRAWLER_INTEGRATION_MYSQL_URL=<独立测试容器> CRAWLER_INTEGRATION_PYTHON=services/scrapling-extractor/.venv/bin/python npm run test:crawler-integration`：SQLite/真实本地 HTTP 抽取 2 通过，真实 MySQL 5 通过，合计 7/7。MySQL 测试每次自行创建并删除隔离 schema。

全量存档 `ops-evidence/bidnet-discovery-2026-09-21.json`：43 页、2036 家机构、819 条候选、1217 条待审，候选与待审之和等于机构数；县/市/特别区/未知四桶之和也是 2036。候选 ID、URL 均无重复；819 条均通过 `validateCandidate`，非空 URL/FIPS、州码、`fetchConfig.base_url` 等检查未发现异常。待审分布：特别区 730、未知 361、无 FIPS 匹配 119、已注册 6、歧义 1。上述守恒只能证明已采集机构在结果中有去向，不能证明每个去向都正确。

## 缺陷与遗漏风险

### P1：同名县市被现有 ID 错误去重，至少漏掉一个市级源

存档中 `City of Boulder` 的公开租户 URL 为 `https://www.bidnetdirect.com/colorado/city-of-boulder/solicitations/open-bids`；真实辖区匹配返回市级 GEOID `0807850`。但它被放入 `review`，原因 `already_registered`，详情为县源 ID `bidnet_co_boulder`，未进入 `candidates`。县源自己的 URL 是 `/colorado/boulder-county/...`，两者并非同一租户。根因是 `name_key` 同时把两个名字压成 `boulder`，`discovery_service.py` 在查 GEOID 前仅凭 `base_id in existing_ids` 就判为重复；同次运行产生的 ID 碰撞却会加 `_2`，规则不一致。若按当前候选直接注册，Boulder 市级源不会被创建，其招标可能长期漏抓。

复现：`jq '.review[] | select(.agencyName=="City of Boulder")' ops-evidence/bidnet-discovery-2026-09-21.json`。最小代码复现可对 `Boulder County` 和 `City of Boulder` 分别调用 `name_key`，两者都得到 `boulder`。建议将“确为同一租户”的判定建立在现有 ID 对应的 URL/机构信息上；不同租户只占用 ID 并生成唯一后缀。修复后将本次新增的严格预期失败用例转为正常通过。

### P1：已有源反查给县源提供错误级别的 `exact` 建议

同一存档的 `existingMatches` 为 `bidnet_co_boulder` 返回两条 `exact`：`Boulder County` 和 `City of Boulder`。`_existing_matches` 只比较归一化名称和已知州码，不校验县/市级别。若操作人员采纳第二条，会把县源 `base_url` 改成市级列表，造成县招标遗漏并污染辖区数据。对无州码机构，当前逻辑还允许它匹配任意指定州源；最小复现可让俄亥俄的 `Franklin County` 与无州码的 `Village of Franklin` 匹配为 `exact`。建议反查结果保留辖区级别和州确认状态，对跨级别或未确定州的结果降级为人工待核，不作为 `exact` URL 建议。

### P1：发现结果不能按文档直接交给注册脚本

`discover-sources` 输出 `{candidates, review, existingMatches, stats}`，而 `register-sources.ts` 把整个 JSON 直接视为 `SourceCandidate[]`。执行 `cd frontend && npm run source:register -- --file ../ops-evidence/bidnet-discovery-2026-09-21.json --dry-run` 退出码为 1，先打印 `Dry run: undefined candidates`，再报 `TypeError: candidates is not iterable`。这一步发生在任何注册写入前；按文档操作无法把 819 条候选注册为待审批源。现有字段级测试未覆盖文件级交接，本轮新增黑盒回归用例记录当前失败。建议统一发现 CLI 与注册脚本的文件契约；修复后把测试断言改为干跑退出码 0 和 819 条候选校验输出。

### 覆盖边界

- `classified_unknown` 有 361 条，其中 80 条名称含 `Township`。这是当前“只自动纳入 county/city”分类规则的结果，并非记录丢失；若 Township 也属于目标采购辖区，需要先明确口径，再扩展分类与 FIPS 映射。
- 119 条 `no_fips_match` 和 1 条 `ambiguous_match` 已进入人工待审，不应直接当作“无数据”。
- `stopped_reason` 为 `waf_challenge`、`max_pages` 或 `fetch_failed` 时，CLI 仍可能退出 0 并给出部分候选；批量注册前必须检查页数、机构数及停止原因。本轮存档是 `exhausted`，不代表今后运行都完整。
- MySQL 持久化与注册门禁已在独立测试容器验证；该结果只说明本地 MySQL 8.4.9 行为，不能代替线上门户与生产库验证。

## 结论

现有自动化测试、MySQL 集成与存档守恒检查通过，但 C06/C07/C08b 的实测缺陷使“无遗漏”验收不成立。修复同名县市的候选去重、反查和发现到注册的文件契约后，应让新增回归用例正常通过并重跑上述套件；上线前还需对新的线上目录快照核对 `stopped_reason` 与候选/待审分布。

## 修复结果（2026-09-23）

三项 P1 均已修复，两个严格预期失败用例已去掉 `xfail`，按原断言通过。修复方案与规则变更记录在设计文档 §8（`docs/superpowers/specs/2026-09-21-source-discovery-design.md`），操作说明在 `docs/operations/source-discovery.md` 第 3、4、7 节。

| 编号 | 修复 | 回归证据 | 结果 |
| --- | --- | --- | --- |
| C06 | "已注册"改按**租户**判定：BidNet 租户身份是 slug（`/solicitations` 前最后一段），slug 命中已登记地址（`existing_sources[].base_url` 或 `existing_base_urls`）才算重复；只撞已有 id 的照常成为候选并加后缀。只给 `existing_ids` 而无任何已登记地址的请求改为退出码 2（无从判重，否则每个已登记租户都会以带后缀的新 id 再出现一次） | `test_existing_county_id_keeps_a_distinct_same_name_city_candidate`（原严格预期失败，真实分类器/匹配器）；新增租户去重、根级别名、id 仅加后缀、请求校验等用例 | **通过**：`City of Boulder` → `bidnet_co_boulder_2`，GEOID `0807850` |
| C07 | 反查只对州与级别均确认一致的命中给 `suggestedBaseUrl`。源级别取 `jurisdiction_level`（`data_sources` 同名列），未给则按同一分类规则分类 `label`。同名但级别不同记 `level_mismatch`，任一方缺州码记 `state_unconfirmed`，任一方级别为 `unknown` 记 `level_unconfirmed`，三者 `suggestedBaseUrl` 均为 `null`，且只在没有已确认的 `exact`/`partial` 时列出 | `test_existing_county_reverse_lookup_does_not_suggest_a_same_name_city_url`（原严格预期失败）；报告里的最小复现（俄亥俄 `Franklin County` 对无州码 `Village of Franklin`）固化为真实模块用例，结果 `level_mismatch`、无地址 | **通过**：`bidnet_co_boulder` 只剩 `Boulder County` 一条 `exact` |
| C08b | `register-sources.ts` 接受 `discover-sources` 原样输出或裸 `SourceCandidate[]`，其他形状报错退出 1、不写库；先打印"页数/机构数/停止原因/候选数/待审数"摘要。`stopped_reason` 非 `exhausted` 的文件真实运行拒收，`--dry-run` 同样退出 1 以如实预告，`--allow-partial` 显式放行 | 黑盒用例改为断言干跑成功（退出码 0、逐条 `OK`、`3 valid, 0 invalid`），另加部分运行拒收/放行、错误形状不崩溃；纯函数用例覆盖四种非完整停止原因 | **通过** |

### 修复中另外发现的问题

- **Aurora 重复候选（与 C06 同源、方向相反）**：存档候选 `bidnet_co_aurora`（`/colorado/city-of-aurora`）与已登记的 `bidnet_co_city_aurora`（平台根级别名 `/city-of-aurora`）是同一租户，原先整条 URL 比较认不出来，注册后会把同一租户按两个 id 抓两遍。按 slug 判定后归入 `already_registered`。`Washtenaw County` 原先靠"撞 id"碰巧去重，现在按 slug 命中根级别名 `/washtenaw-county` 去重。存档 2,036 个 slug 两两不同、无一跨组，这是按 slug 判定的依据。
- **运行手册的单州示例会产出部分结果**：`{"states":["OH"],"max_pages":20}` 只翻前 20 页，而 `states` 只过滤结果、不减少翻页（目录是全平台一份），该州排在后面的机构会悄悄缺失，`stopped_reason` 为 `max_pages`。示例已改为不压 `max_pages`，文档同步写明；`CLAUDE.md` 中的同款示例一并修正。

### 复验

- `PYTHONPATH=crawler python3 -m pytest crawler/tests -q`：695 通过，0 预期失败（修复前 678 + 2 xfail）。
- `services/scrapling-extractor`：115 通过；`services/browser-downloader`：151 通过。
- `frontend/npm test`：318 个文件通过、1 跳过；2,113 例通过、2 跳过。`npm run lint` 退出码 0；`npm run build` 生产构建与 TypeScript 检查通过（Node.js 24.14.1）。
- `npm run test:crawler-integration`，指向**临时** Docker MySQL 8.4.9 容器（随机密码，跑完即删，不涉及业务库）：7/7 通过，含本报告新增的"发现的市级源注册后仍受门禁、重复注册保留审批"用例。
- **存档离线重放**：由存档 `candidates` + `review` 还原 2,036 家机构（按名称排序即原目录顺序；州码按采集器同一映射），用修复后的代码与真实分类器、匹配器重跑存档请求：候选 819、待审 1,217、之和 2,036；四个分类桶之和 2,036；已注册 6（Boulder County、Denver、Jefferson、Erie 按原地址，Aurora、Washtenaw 按根级别名）；候选 ID、URL 均无重复。与存档相比只有两处差异：新增 `bidnet_co_boulder_2`，移除 `bidnet_co_aurora`；其余 818 条候选 ID 不变。
- 报告中的原命令 `npm run source:register -- --file ../ops-evidence/bidnet-discovery-2026-09-21.json --dry-run`：退出码 0，摘要 `43 pages, 2036 agencies, stopped_reason=exhausted; 819 candidates, 1217 in review`，819 条逐条 `OK`，stderr 为空。重放结果文件同样 819 条通过；裸数组种子文件 `bidnet-counties-initial.json` 6 条通过；把存档改成 `stopped_reason: "waf_challenge"` 后干跑退出 1、加 `--allow-partial` 退出 0。

### 注意与未处理项

- **不要用 2026-09-21 的存档文件注册。** 它仍含重复的 `bidnet_co_aurora`，也缺 `City of Boulder`；干跑能通过只说明文件格式对。批量注册前应按手册用新代码重跑一次发现，并把 `data_sources` 的 `id, label, state_code, base_url, jurisdiction_level` 作为 `existing_sources` 传入。
- `classified_unknown` 361 条（含 80 条 `Township`）按原口径未改动，是否纳入需要先定产品口径。
- 119 条 `no_fips_match` 与 1 条 `ambiguous_match` 仍按设计留人工待审。
- 上线前对新的线上目录快照核对 `stopped_reason` 与候选/待审分布，这一条仍然有效；本轮修复未请求线上门户。
