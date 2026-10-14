# 州／市／县郡数据完整性：真实库 `winbids` 执行报告

日期：2026-10-13 11:51–12:01Z（Asia/Singapore 19:51–20:01）。对象：生产业务库 `winbids`（本机 Docker `winbids-mysql`，MySQL 8.4.9），代码 `main` = 2f48b6b（已推送，GitHub CI 四个 job 全部通过）。验收口径：[州、市、县／郡数据测试验收要求](jurisdiction-data-acceptance.md)。

**结论。** 迁移、演示数据清理和截止日清扫已在真实库执行完毕，独立逐行指纹对账 **PASS**：没有任何一行业务数据意外丢失或改动；4,496 条已过截止日的招标被关闭，无一提前；56 条演示招标及 797 行关联数据已清除；22 条 NY 转包行已重键；11 条 Aurora 行已校正层级与 FIPS。按验收要求，本次能证明的是**无丢失、搜索可见性、身份一致**三项；上游列表完整性、正文真实性和附件仍为**未验证**，因此**整体真实数据质量未通过验收**（见矩阵）。

代码用例与真实数据验收分别记录：代码门禁（Vitest 4,810、集成 129、爬虫 pytest 1,368、lint、生产构建、`risk:check`、GitHub CI）在 2f48b6b 上全部通过，记录于 SDD 账本与 `ops-evidence/final-verify-4c504b2/`；本文只记录真实数据部分。

## 1. 环境、窗口与步骤

- 维护窗口：11:51Z 前停掉开发服务（:3000）和全部 worker；`crawler_locks` 为 0；指纹证明窗口内 36 张运行表（`sessions`、`crawler_logs`、`event_log`、`notification_outbox`、`event_outbox` 等）一字未变。
- 备份：`mysqldump --single-transaction --routines --triggers --events`（容器内，密码只经环境变量传递）→ `AI-powered-Procurement-Intelligence-backups/winbids/apsi-mysql-2026-10-13T11-51-07Z-before-data-integrity.sql`，41,178,501 字节，sha256 `983f9d87…a32150`，mode 600。与 01:49Z 的演练源转储字节数相同；11:51Z 的库行数（24,091）与该转储一致，说明两次之间没有抓取写入。
- 数据时间范围：库内 `last_seen_at` 最新为 2026-10-02（州）/ 2026-10-03（县、市、镇）；爬虫自 2026-10-03 起停止，本次执行前没有恢复。

| 步骤 | 命令（`frontend/`，`.env.local` 已导出，每条 stderr 的 `Target:` 均为 `winbids`） | 退出码 | 结果 |
| --- | --- | --- | --- |
| R3 | `fp_env.py winbids fp-before`（独立指纹，56 张表，每表每主键一行 MD5，含每列原值） | 0 | 24,091 行，`bids` 7,230 |
| R4 | `npm run data:integrity -- --snapshot before.json`；`-- --json` | 0 | 与 10-13 演练 BEFORE 完全一致（`expiredOpen` 4,552，比演练多 76 条，为时间推移） |
| R5 | `npm run db:mysql:migrate` | 0 | `61 statements applied, 190 skipped`，11:52:37Z；仅 3 条数据迁移改了业务行 |
| R6 | `npm run bids:purge-demo`（试运行）→ `-- --apply --backup-file <R2>` | 0 / 0 | 试运行与实际一致：56 条演示招标（demo_readiness 50、mock_seed 6）+ 797 行关联数据（17 张表），1 条 `knowledge_items` 置空链接 |
| R7 | `npm run bids:lifecycle:sweep -- --dry-run` → 实际 | 0 / 0 | 试运行与实际一致：scanned 7,028，closed 4,496（state 4,067、city 230、county 174、township 25），unparseable 29；11:54:01–02Z |
| R8 | `npm run data:integrity -- --compare before.json --allow-removed '^ny_contract_reporter:.+ Company: ' --allow-removed '^[^:]+_demo_readiness$' --allow-removed '^[0-9]+$' --snapshot after.json`；同参数 `--json` | 0 / 0 | `ok`，failures 0，warnings 0；removed 78 全部在允许范围（56 演示 + 22 NY 旧 id），unexpected 0；added 22（NY 新 id）；changed 4,494 = 4,483 清扫 + 11 Aurora；`changedOutsideTracked` 11 = Aurora 的 `legacy_fips_code` 标记；可见性回退 0 |
| R9 | `fp_env.py winbids fp-after` | 0 | 23,238 行，`bids` 7,174 |
| R10 | 从主目录重启 `npm run dev`；`GET /api/bids?issuerType=<level>` | — | `total` = AFTER `openVisible`：state 1,778、county 319、city 395、township 40（合计 2,532），返回行全部 active |
| R11 | 独立测试员离线分类 fp-before vs fp-after（无数据库访问） | — | **PASS**，见 §3 |
| R12 | 主机 Scrapling 边车 `run-local.sh`（127.0.0.1:8091）+ 主目录 `npm run worker:crawler`（`caffeinate -i -w`） | — | 首轮 tick 11:58–12:01Z：23 个源，21 成功、2 失败（`sam_gov` 无 API Key；`ca_caleprocure` 门户返回 HTTP 500） |

## 2. 分层级 BEFORE → AFTER

计数来自独立指纹分类；`openVisible`、`withBody`、`detailLockedAtSource`、`identityMismatch`、`malformedNyIds` 为工具报告数字，`openVisible` 已与指纹 open 集合及 API 总数逐一核对。

| 层级 | total | open | openVisible | 清扫关闭 | 清除演示 | 重键 | FIPS 校正 | withBody（open 内） | detailLockedAtSource（open 内） | identityMismatch |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| state | 5,911 → 5,845 | 5,900 → 1,778 | 5,874 → 1,778 | 4,067（含 13 条重键后的 NY） | 55 | 22（−22 旧 id，+22 新 id） | −11（转入 city） | 1,133 → 426 | 1,097 → 833 | 11 → 0 |
| county | 555 → 555 | 493 → 319 | 493 → 319 | 174 | 0 | 0 | 0 | 0 → 0 | 493 → 319 | 0 → 0 |
| city | 692 → 703 | 625 → 395 | 625 → 395 | 230 | 0 | 0 | +11 | 0 → 0 | 625 → 395 | 0 → 0 |
| township | 71 → 71 | 65 → 40 | 65 → 40 | 25 | 0 | 0 | 0 | 0 → 0 | 65 → 40 | 0 → 0 |
| federal | 1 → 0 | 1 → 0 | 1 → 0 | 0 | 1 | 0 | 0 | 1 → 0 | 0 → 0 | 0 → 0 |
| 合计 | 7,230 → 7,174 | 7,084 → 2,532 | 7,058 → 2,532 | 4,496 | 56 | 22 | 11 | 1,134 → 426 | 2,280 → 1,587 | 11 → 0 |

其他指标：`unregistered` / `demoLike` / `nonCanonicalId` 56 → 0；`malformedNyIds` 22 → 0；`openHidden` 26 → 0；`expiredOpen` 4,552 → 0；`activeFlagMismatch` 0 → 0；`bodyMissing`（state）3,670 → 519；`data_sources` 表前后字节不变（启用 1,012；`succeededWithin7d` 0；`neverSucceeded` / `failing` 1 = `sam_gov`）。

## 3. 独立逐行对账（测试员，离线）

- 分桶：(a) Aurora 11 行，只改 `issuer_type state→city`、`fips_code 0803455→0804000`、`raw_payload` 增 `legacy_fips_code`；(b) NY 重键 44 = 22 删 + 22 增，逐行配对（新 id = `ny_contract_reporter:<CR#>`，发布机构由 "Unknown state agency" 改为真实机构，`raw_payload` 增 `contractor_company` 与 `subcontracting: true`），没有任何子表行引用过旧 id；(c) 演示清理 854 = 56 + 797 + 1 条置空；(d) `deadline_passed` 关闭 4,483（+13 条在 (b) 内，共 4,496），每行只改 `lifecycle_status`、`is_active`、`raw_payload.lifecycle`、`updated_at`。四桶之外：0 条业务数据行；唯一桶外改动是迁移账本 `mysql_migrations.applied_at` 重盖时间，与演练相同。
- 不早关：4,496 条关闭行按各自截止日的最晚读法与清扫时刻 11:54:01Z 比较，0 条提前，0 条未核；最小余量 24 分 01 秒。仍 open 的 2,532 条中 0 条截止日明显已过；102 条按规则永不过期（空白 73：MT 68、VA 4、WY 1；"Not Available" 29：SC 28、WI 1）。
- 交叉核对：工具的 78 条允许移除 id = 56 演示 ∪ 22 旧 id；新增 22 = 预期的新 CR# id；工具 AFTER 可见集合 = 指纹 open 集合 = API 总数；每层"丢失的可见招标" = 清扫 ∪ 演示，恰好相等。
- 发现（均不阻断）：协调者的即时检查查询 `ny_rekeyed_total 0` 是查询写法错误（`source` 列存的是来源名称，不是 id），行级证据证明 22 条新行齐全；`aurora_legacy_0803455_left 6` 是 Arvada 市（`bidnet_co_arvada`，登记 FIPS 即 0803455）自己的 6 行，不是不一致。
- 与 10-13 演练的差异只在时间：真实执行晚约 8.5 小时，多关 76 条，全部通过不早关检查。

## 4. 验收矩阵

分母 = `data_sources` 登记来源（表前后字节不变）。"已验证"仅指本次能证明的三件事：**行级无丢失、搜索可见性、身份一致**；凡未检查一律写"未验证"。州级目标沿用 50 州清单；地方级以登记来源为可核对清单，本次未变更范围。

| 层级 | 目标机构／来源数 | 已验证完整可靠 | 缺失／部分／过期 | 未验证 | 证据与最终结论 |
| --- | --- | --- | --- | --- | --- |
| 州 state | 50 州；登记 55 个州级源，启用 50（每州恰 1 个），另 5 个停用的重复旧源（cal_eprocure、illinois_procurement_bulletin、myfloridamarketplace、new_york_state_contract_reporter、texas_smartbuy，从未成功、无记录） | 行级：50/50 启用源都有入库记录；5,845 行 = 5,911 − 55 演示 − 11 Aurora 转 city，NY 22 条一进一出，0 丢失；可见性：1,778 条 open 全部可搜索（工具可见集合 = 指纹 open 集合 = API 总数）；身份：`identityMismatch` 0、`malformedNyIds` 0、未登记前缀 0 | 清扫后 7 个州（CA、CT、GA、ME、RI、UT、WA）没有任何 open 州级招标（库内记录全部已过期）；50 个州级源最近成功抓取都在 2026-10-02（`succeededWithin7d` 0），库内数据相对门户已过期 ≥ 11 天；102 条 open 招标截止日空白或 "Not Available"，永不过期 | 上游列表完整性（分页／总数／停止原因）；正文与门户是否一致（open 内 `withBody` 426、`bodyMissing` 519、`detailLockedAtSource` 833）；附件对照上游清单 | 本次范围内"无丢、无藏、无串类型"**通过**；**整体数据质量未验证**（过期与上游完整性未证） |
| 市 city | 登记 554（全部 BidNet），启用 553，blocked 1（bidnet_oh_city_columbus） | 行级：703 行（含 Aurora 11 条校正并入）0 丢失；395 条 open 全部可见；`identityMismatch` 0（全库无 FIPS 漂移；6 条 FIPS 0803455 行属 Arvada，与其登记源一致） | 553 个启用源中 172 个有 open 招标、234 个有任何记录；319 个启用源 0 条记录（"当前无公开招标"尚无最新完整上游扫描证据）；395 条 open 全部 `detailLockedAtSource`（BidNet 详情锁，正文公开受限），`withBody` 0；最近成功抓取 2026-10-03 | 上游完整性；正文（源站锁住，不能记为"正文真实可用"）；附件 | 行级与可见性、身份**通过**；**整体数据质量未验证** |
| 县／郡 county | 登记 266（全部 BidNet），启用 264，blocked 2（bidnet_oh_cuyahoga、bidnet_oh_franklin） | 行级：555 行 0 丢失；319 条 open 全部可见；`identityMismatch` 0 | 264 个启用源中 100 个有 open 招标、117 个有任何记录；147 个启用源 0 条记录；319 条 open 全部 `detailLockedAtSource`，`withBody` 0；最近成功 2026-10-03 | 上游完整性；正文；附件 | 行级与可见性、身份**通过**；**整体数据质量未验证** |

县与郡均对应本项目 `county`，未重复计数。按真实类型单列、不并入上表：**township** 登记／启用 144，71 行 0 丢失，40 条 open 全可见，`identityMismatch` 0；27 个源有 open 招标、36 个有记录、108 个 0 条；正文全部源站锁定；上游完整性／正文／附件未验证。**federal** `sam_gov` 1 个源，从未成功（未配置 `SAM_API_KEY`）；库内唯一 1 条 federal 行是演示数据，已清除，现为 0 行。

协调者用"启用来源 × `bids.source`"口径离线复算的分来源数字（city 171 有 open／228 有记录，county 99／116，township 27／36）与上表相差不超过 6 个来源，差异来自来源匹配口径，不影响结论。

## 5. 缺口与去向

| 缺口 | 范围 | 去向 |
| --- | --- | --- |
| 库内数据过期（最近成功抓取 10-02／10-03） | 全部层级 | 爬虫 worker 已于 12:01Z 前恢复运行；需在数轮 tick 后重新出 `data:integrity` 报告并复验矩阵 |
| 7 个州无 open 州级招标 | CA、CT、GA、ME、RI、UT、WA | 等待下一轮州级抓取；CA 门户当前返回 HTTP 500，需观察 |
| 联邦 0 条 | `sam_gov` | 需配置 `SAM_API_KEY` |
| 地方级正文为 0（BidNet 详情锁） | 全部 county／city／township open 招标 | 见运行手册 §8；非代码可解，需业务决定是否接入授权渠道 |
| 319 个市级、147 个县级、108 个镇级启用源 0 条记录 | 本地来源 | 已进静默档（`consecutive_empty_runs` ≥ 3）；"当前无公开招标"需最新完整上游扫描证据后才能确认 |
| 102 条 open 招标永不过期 | MT 68、SC 28、VA 4、WY 1、WI 1 | 上游未提供截止日；按规则保持 open，人工核验 |
| 29 条截止日无法解析 | 清扫 `unparseable` | 逐条列于 `07-sweep.stdout`；格式扩展待补 |

## 6. 证据

- `ops-evidence/data-integrity-run-2026-10-13/`（未提交，目录 700／文件 600，已确认无凭据）：事前／事后工具报告与比对文本、迁移／清除／清扫的 stdout 与时间戳、API 可见性核对、指纹各表行数、离线分层统计、独立分类报告 `11-independent-classification-report.md`。
- 指纹原始文件（含真实业务数据的每列原值）只保留在本会话 scratchpad `realrun/`，不进入仓库。
- 备份文件及 sha256 见 §1；恢复方法见 [备份与恢复运行手册](../operations/backup-restore-runbook.md)。
- 复跑顺序见 [数据完整性运行手册 §2.3](../operations/data-integrity.md)；本次执行即按该顺序进行。

## 7. 复验：爬虫恢复后五轮抓取（2026-10-13 13:12Z）

爬虫 worker 12:00Z 恢复后跑了 5 轮（12:01、12:19、12:36、12:53、13:11Z），共 110 个来源：50 个州级源各跑一遍，59 个地方源（预算 `bidnet=60`/小时，每轮约 12 个）；第 2–5 轮全部成功，第 1 轮 2 个失败（`sam_gov` 无 API Key；`ca_caleprocure` 门户 HTTP 500，后续重试仍失败）。随后重新运行 `data:integrity`，并与 11:56Z 的执行后快照比对：

| 层级 | total | open = openVisible | withBody（open 内） | bodyMissing | identityMismatch / demoLike / openHidden / expiredOpen | newest last_seen_at |
| --- | --- | --- | --- | --- | --- | --- |
| state | 5,845 → 6,639 | 1,778 → 2,567 | 426 → 579 | 519 → 729 | 0 | 2026-10-13T13:11Z |
| county | 555 → 623 | 319 → 392 | 0 | 0 | 0 | 2026-10-13T13:09Z |
| city | 703 | 395 | 0 | 0 | 0 | 2026-10-03（尚未轮到） |
| township | 71 | 40 | 0 | 0 | 0 | 2026-10-03（尚未轮到） |

比对：`ok`，failures 0，warnings 0；新增 862 条（state 794、county 68），移除 0；改动 36 条：截止日更新 35、`closed→open` 11、`open→closed` 1（`bidnet_mi_oakland:0000438950`，完整列表扫描未再出现，`closed_reason = delisted`）、标题 5、机构 2；可见性回退 0。11 条重新打开的招标都是门户重新刊登并给出新截止日（10/13–11/16/2026），不是清扫错关。无 open 州级招标的州由 7 个降为 4 个：CA（门户 500）、CT、ME、RI。

本节不改变 §4 矩阵的结论：上游完整性、正文与附件仍未验证；市、镇来源要等预算轮到后再复验。观察项：`wa_state_procurement:RFP` 这样的 id 说明 WA 适配器把 "RFP" 当成了公告编号，属既有适配器问题，待单独处理。

## 8. 复验：地方来源全部轮完一遍（2026-10-14 09:38Z）

爬虫自 10-13 12:00Z 恢复后共跑 81 轮（至 10-14 09:33Z），1,012 个启用来源全部跑过一遍：州 50（49 成功，`ca_caleprocure` 门户 HTTP 500）、县 264（263 成功，`bidnet_sc_georgetown_2` 1 个失败）、市 553（全部成功）、镇 144（全部成功）、联邦 1（无 API Key）。`succeededWithin2d` = 1,009 / 1,012。随后重新运行 `data:integrity`，并分别与 10-13 13:12Z（五轮后）和 11:56Z（执行后）的快照比对。

| 层级 | total（五轮后 → 现在） | open = openVisible | withBody（open 内） | detailLockedAtSource | newest last_seen_at |
| --- | --- | --- | --- | --- | --- |
| state | 6,639 → 6,639 | 2,567 → 2,473 | 579 → 548 | 1,259 | 2026-10-13T13:11Z |
| county | 623 → 729 | 392 → 505 | 0 | 505 | 2026-10-13T17:48Z |
| city | 703 → 946 | 395 → 643 | 0 | 643 | 2026-10-14T06:21Z |
| township | 71 → 109 | 40 → 74 | 0 | 74 | 2026-10-14T09:17Z |

`identityMismatch`、`demoLike`、`openHidden`、`expiredOpen`、`activeFlagMismatch`、`malformedNyIds` 全部为 0。

比对（相对五轮后快照）：`ok`，failures 0，warnings 0；新增 387（county 106、city 243、township 38），移除 0，可见性回退 0；改动 191：`open→closed` 122（逐条核对：94 条 `deadline_passed` 由 worker 在 tick 内关闭，28 条 `delisted` 由完整列表扫描判定，city 22、township 4、county 2）、`closed→open` 36（county 9、city 27，门户重新刊登，新截止日全部在 10/13–10/30/2026，0 条明显已过）、截止日更新 67、标题 4。相对执行后快照：新增 1,249，移除 0，同样 0 失败。

地方来源覆盖（按启用来源，`bids.source` = 来源名称）：city 553 个中 259 个有记录、220 个有 open 招标；county 264 个中 138 / 127；township 144 个中 46 / 39。其余来源本轮完整扫描为空（`emptyState`），按规则记为"当前无公开招标（已有最新扫描证据）"。无 open 州级招标的州：CA（门户故障）、CT、GA、ME、RI。

矩阵更新：§4 中"过期"一列已解除——每个层级的来源都在 2 天内成功抓取过；"上游完整性"对本轮完整扫描（`complete: true`）的来源已有停止原因证据，但正文（地方来源全部 BidNet 详情锁）与附件仍未验证，整体数据质量结论不变。
