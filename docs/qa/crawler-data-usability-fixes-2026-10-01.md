# 采集数据可用性全面修复与验证记录

日期：2026-10-01。工作分支：`codex/data-usability-20261001`。本轮基于[保障方案](crawler-data-usability-assurance-2026-10-01.md)实施修复，保留工作区此前的改动。所有数据写入和浏览器检查均使用临时数据库、合成账号及离线 fixture；未部署、未修改业务数据库、未触发客户提醒、未运行线上全量采集。

## 已完成的修复

| 风险 | 实际处理 | 验证证据 |
| --- | --- | --- |
| 请求成功却发布占位/串源数据 | SQLite/MySQL 使用共享语义门禁；独立 Python CLI 同规则。缺稳定身份、真实标题/机构或定位信息，以及州/辖区/FIPS 不合法或冲突的候选隔离，保留脱敏原始证据；刷新缺少可选身份字段时保留已知值 | 两数据库门禁反例及跨语言共享契约 |
| 新坏结果覆盖旧好内容 | 合并前拒绝标题回显、登录/错误页、导航、字段标签及类型码；保留真实正文及字段来源 | RED→GREEN 正文保护、SAM 与地方来源重导入 |
| 候选在规范化时静默消失 | 缺 ID/URL 的列表项保留为隔离候选；多个无 ID 候选不折叠为一个 `null` ID | Python 列表提取与分页反例 |
| 操作次数冒充记录完整性 | 先按身份关联去重，保留重复证据与接受 ID；身份冲突整组隔离；唯一数等于接受数加隔离数 | SQLite/MySQL 重复、冲突及数量对账 |
| 坏列表或局部扫描误下架 | 有未解决隔离、日期过滤或历史补采时，父导入器强制阻止完整列表标记；失败文档不写其中条目 | 下架反例、真实 MySQL、生命周期回归 |
| 旧正文冒充刚核验 | 有效旧正文继续可用；正文核验时间跟随实际选中内容。失败解析即使沿用有效正文，也不算新取得正文 | 失败刷新、保留时间、历史复用反例 |
| SAM 新字段遗漏/状态错误 | 映射新版机构路径、联系人、资源链接；识别关闭/中标；不再把 notice 类型当正文；缺编号保留隔离证据 | 规范化、SAM 抓取、跨数据库正文链路 |
| 前部失败项耗尽详情预算 | 持久化逐记录结果、真实尝试次数与重试时间，公平轮换并冷却；核心错误/来源冲突的历史行不占预算 | 连续两轮预算 1 的饥饿反例、预算/暂停/租约检查 |
| 历史窗口外记录无法补采 | 一轮手动入口及默认关闭的 worker 自动扫尾；共用预算、间隔、暂停、租约及取消，不更新列表健康或触发提醒 | configured/state/SAM runner、历史生命周期与预算测试 |
| 链接被当成已验证文件 | 从实际保留的附件计算能力；不接受新 payload 自称已验证。归档字节变化撤销核验证据；下载核验文件类型、大小、校验和及签名 | 文件更换、伪核验声明、HTML/损坏 PDF/Office 下载反例 |
| 独立 CLI 重导入丢附件历史 | 保留未观察到的附件、稳定 ID、验证/修复次数和退避；新 ID 跳过所有保留 ID；批次失败整体回滚 | 稳定 ID 间隙碰撞、修复历史及事务反例 |
| 管理端只看州或只看 success | 新全源质量报告覆盖联邦、州、县/郡、市、镇/乡、特别区；区分列表执行、范围、内容、正文年龄、附件证据和补采原因；补采不覆盖列表失败证据 | 全源报告、SQLite/MySQL 一致快照、双语 UI |
| 历史坏数据仍被用户使用 | 用户端重新检查实际字段和注册来源身份。缺正文可检索/收藏，分析与投标简报待补；核心或串源错误不展示，不用于提醒和历史分析读取 | SQLite/MySQL list/detail、搜索、提醒、分析、意向及下载测试 |

源码入口：`frontend/src/server/crawler/data-quality.ts`、两 JSON importer、`crawler/apsi_crawler/data_quality.py`、`detail_backfill.py`、`frontend/src/server/crawler/detail-history.ts`、`source-validity/source-data-quality.ts`、`lib/bid-usability.ts`、`server/bids/registered-source-identity.ts`。质量账保存在日志 JSON 与 bid raw payload 中，不新增业务表或迁移。

## 最终验证

测试环境为 Node 20.20.2、Python 3.12；Node 20 测试复制目录保留其独立 native dependency ABI，未修改工作区依赖。真实 MySQL 使用仅绑定回环地址的专用临时容器和随机独立 schema，测试结束删除。

| 检查 | 结果 |
| --- | --- |
| 前端全量 Vitest | 392 个套件通过，3,533 项通过；2 套件/10 项按默认集成环境条件跳过 |
| 爬虫全量 pytest | 951 通过 |
| HTML extractor 全量 pytest | 133 通过；只有现有依赖弃用警告 |
| Browser downloader 全量 pytest | 153 通过 |
| 实际 Python → HTTP extractor → SQLite/MySQL 及生命周期集成 | 23 通过，无条件跳过 |
| 全量 ESLint、`git diff --check` | 通过 |
| Next.js 生产构建 | Node 20 构建通过 |
| 独立 TypeScript 全库检查 | 仍退出 2：276 条既有测试/脚本类型诊断。基线 commit `8897029` 为 281；按文件与错误码对比无新增，生产源码诊断为 0。不能称全库类型检查通过 |

实际浏览器验证：合成批次 3 个唯一候选，2 个接受、1 个隔离；有效正文/可分析 1，正文待补 1，完整标记被阻止。核对英文与中文管理页、辖区过滤、移动端页面无整页横向溢出，确认待补正文的详情页保留检索/收藏入口并显示分析等待；修正了过滤器露出的翻译键。

本机验证日志：`/Users/sakya/.codex/artifacts/apsi-qa-2026-10-01/usability-*.log`；类型差异：`usability-types-comparison.json`。截图为[英文管理页](/Users/sakya/.codex/artifacts/apsi-qa-2026-10-01/screenshots/usability-admin-quality-en.png)、[中文管理页](/Users/sakya/.codex/artifacts/apsi-qa-2026-10-01/screenshots/usability-admin-quality-zh.png)、[移动端](/Users/sakya/.codex/artifacts/apsi-qa-2026-10-01/screenshots/usability-admin-quality-mobile-zh.png)及[正文待补详情](/Users/sakya/.codex/artifacts/apsi-qa-2026-10-01/screenshots/usability-pending-detail-zh.png)。截图数据仅为合成测试结果。

## 运维入口与验收边界

在 `frontend/` 可用 `npm run crawler:details:backfill -- il_bidbuy sam_gov` 执行受控历史补采。默认关闭自动扫尾；按运维要求配置 `CRAWLER_DETAIL_BACKFILL_ENABLED=true` 后沿用原 crawler worker。参数和约束见[正文补采运维](../operations/detail-backfill.md)及[全源质量运维](../operations/source-data-quality.md)。本轮没有在业务环境执行这些命令或修改开关。

客户附件中的 MA/NJ 等原始批次尚未在线逐 ID 复测，不能用当前离线通过率将这些历史问题标成已结案。外部站点当前可达、原始列表数量、所有公开附件是否齐全，需要来源契约与受控实测证据。本次系统已能将部分/未知结果如实报告，防止坏数据进入使用场景，并为合格待补记录持续补采。

仍保留的工程边界：历史读取已有上限（见[正文补采运维](../operations/detail-backfill.md)"历史读取上限"）；附件按已观察 URL 增量保留，尚未证明来源主动删除文件或签名 URL 变更的版本语义；来源级适用字段/SLA 和解析版本验收仍需具体契约，不使用统一字数或统一年龄硬门槛伪造完整率。

## P0 修复（2026-10-12）

2026-10-09 代码审查发现 5 个上线阻塞问题，修复在 `fix/data-usability-p0` 分支上，计划见 `docs/superpowers/plans/2026-10-12-data-usability-p0-fixes.md`：

1. **旧地方招标被隐藏。** 旧的县、市、镇招标存成 `issuer_type = 'state'`，被新门禁隐藏（本地 7,230 条中 1,355 条）。迁移按已登记地方源的级别回填 `issuer_type`，两种数据库各一条幂等语句。州代码（区分大小写）或 FIPS 与登记不一致的旧行保持原样：改了类型它就变成核心有效，之后每次修正过的重抓都会被身份校验隔离，保持原样则下次重抓会自愈。**部署顺序：先跑 `npm run db:mysql:migrate`，再让新代码接流量**，否则回填之前这些招标不可见。
2. **抓取失败抹掉正文。** 补采复用历史时不再带上一轮的 `applied_fields`，详情抓取失败不会再抹掉已验证的正文。
3. **SAM 附件内联下载。** SAM.gov 运行只记录附件链接，归档交给附件修复 worker（默认不随 compose 启动，见附件修复运维）。
4. **详情历史无上限。** 列表运行读本源最近一次出现之前 30 天内、最多 5,000 行；补采只读本轮预算内的到期候选，扫描到上限时记 `crawler_detail_backfill_scan_capped`。
5. **正文判定误杀且两边不一致。** TypeScript 和 Python 两边统一为同一套规则，共享契约是 `crawler/tests/fixtures/description_quality_contract.json`（80 例）。访问提示和报错页只有整句出现才算：登录/注册后面必须跟"查看/访问/下载/继续"等去向、"required"，或者就此结束；报错短语后面必须是标点、句末或 "you don't have permission"。整段只是一个地址才算地址。

回填后仍不可见、留待后续处理的有 37 条：22 条 `ny_contract_reporter` 的发布方为"Unknown state agency"；11 条已关闭的 `bidnet_co_city_aurora` 带旧 FIPS `0803455`，这一轮的回填没有改它们（审查 P1-8）；另有 4 条演示数据。这三类的修复（迁移、爬虫、清理命令）在 2026-10-13 完成，见本文末尾的"数据完整性（2026-10-13）"一节；在业务库执行之前，它们仍在库里。

上线注意：

- **迁移顺序：** MySQL 先跑 `npm run db:mysql:migrate`；SQLite/compose 的 web 镜像不会自动迁移，先跑 `npm run db:migrate`（启动 crawler worker 也会迁移）。迁移前最好先停掉旧版爬虫：迁移后旧代码若再爬一次，会把开放的地方招标重新写成 `state`，要等新代码下次爬取才恢复。
- **行为变化：** `fetch_config.enrichment.fields` 不含 `attachments` 的来源，复用历史时如果只有列表摘要，会触发详情复查（受 7 天冷却和每轮预算约束）。
- **回滚：** 回滚到数据可用性改动之前的版本前，要先把地方招标的 `issuer_type` 改回 `'state'`，因为旧代码只认 `federal` / `state`。

## 正文判定后续收紧（2026-10-12）

P0-5 终审列出的剩余误杀在 `classifier-followup` 分支（基于 `fix/data-usability-p0`）上修复。每条规则都先改共享契约 `crawler/tests/fixtures/description_quality_contract.json`，再改 TypeScript `getBidDescriptionIssue` 和 Python `body_issue`：

- **版权行：** `copyright` 后面要紧跟 ©、(c) 或四位年份，或者整段以 "all rights reserved" 结尾。"Copyright clearance services…" 是采购内容。
- **字段标签：** 整段只是"标签：短值"才算。短值最多四个词，或数字代码加最多六个词（BidBuy 的 "Type Code: 55 - Amendment/Change Order (Increase or No Dollar)"），不带句子标点。"Bid Type: Construction of a new fire station, …" 保留为正文。
- **单独的 forbidden / unauthorized：** 后面只能是 `.`、`!`、`:`、破折号、"(NNN)" 状态码、"you don't have permission" 或结尾。逗号、分号、竖线和括号只跟在 access denied、error NNN、NNN 原因、page not found 后面才算。
- **Attention Required!：** 后面必须是 `|` 或结尾（Cloudflare 的标题）。
- **空白字符：** 两边都把 U+FEFF、U+0085、U+001C–U+001F 当空白，在全部 Unicode 码位上两边的空白集合一致（Node 24、Python 3.12、3.9）。TypeScript 去首尾标点改为线性扫描，8 万个点从约 2.7 秒降到 2 毫秒以内。

契约从 80 例增加到 255 例，原有 80 例不变。逐一删掉规则里的任一分支、字符类成员或可选部分，只有 "just a moment" 后面的 `...` 分支测不出来，它和 `[.!,]` 等价。`npm run test:crawler-integration` 新增 TS/Python 差分：用契约词汇随机拼出 6 万条描述，两边结果必须完全一致；只在一边改动任一规则的一处，387 种改法里它能发现 386 种。

尚未统一：Python 用 `casefold()`，TypeScript 用 `toLowerCase()`，含 ß、ſ、ﬁ 等字符的文本两边结果仍可能不同。

## 数据完整性（2026-10-13）

分支 `feat/data-integrity`，计划见 `docs/superpowers/plans/2026-10-13-data-integrity.md`。针对 P0 修复之后仍留在库里的几类州/县/市数据问题，补上一套能证明"没丢、没藏、没串类型"的工具。本节记录代码与迁移的改动和验证；验证用的是测试库、夹具数据和一次性 MySQL 8.4.9 容器，**没有连接 `winbids`，也没有在业务库执行任何迁移或清理**。怎么用，见[数据完整性运维](../operations/data-integrity.md)。

| 问题 | 处理 | 验证 |
| --- | --- | --- |
| Aurora：11 条已关闭的 `bidnet_co_city_aurora` 带旧 FIPS `0803455`。上一节的回填有意没改它们：只改类型而 FIPS 仍与登记源矛盾，之后每次修正过的重抓都会被身份校验隔离 | **现在已校正**。迁移把这类遗留 `state` 行（州码精确一致、层级一致、两边 FIPS 都非空但不相等）改成登记源的层级**和** FIPS，在同一次更新里对齐；旧 FIPS 存进 `raw_payload.legacy_fips_code`（`raw_payload` 是 JSON 对象时）。预期结果：这 11 条变成 `city`、FIPS `0804000`。SQLite 在 `runMigrations`，MySQL 在 `mysqlDataMigrationStatements()`，幂等 | SQLite 单测；一次性 MySQL 集成测试（`local-issuer-type-backfill.mysql.integration.test.ts`）。业务库上的结果待演练确认 |
| 22 条 NY Contract Reporter 转包卡片：id 里粘着 `Company: …`，发布方是 "Unknown state agency" | **已修复**。爬虫认 `Company:` 标签，把转包标记句 "This is a subcontracting opportunity" 从标题里剥掉，新 id 是干净的 `ny_contract_reporter:<CR#>`，承包商记在 `contractor_company`。迁移把库里已有的遗留行重键（无子表数据、无冲突的）：发布方换成公司名，清掉标题回显的正文和占位发布方时算出的质量结论；有子表数据的行不动，计入 `malformedNyIds` | Python 单测与夹具 `ny_ads_search_subcontract.html`；SQLite 单测；MySQL 集成测试（`ny-subcontract-rekey.mysql.integration.test.ts`）。业务库上的结果待演练确认 |
| 56 条演示/种子招标（`demo:prepare` 的 50 条 demo-readiness + `db:seed` 的 6 条 mock）混在业务数据里 | **清理命令已就绪**：`npm run bids:purge-demo`，默认预演；`--apply --backup-file` 才在一个事务里删除这些招标和全部依赖行，`knowledge_items` 保留、链接置空。**尚未在业务库执行** | 单测；MySQL 集成测试（每条关系零孤儿）；一次性库上预演与执行 |
| 截止日已过的招标仍是 `open` | **截止日规则**（`frontend/src/lib/bid-deadline.ts`，宁可晚关，不可早关）：导入时关闭；`crawler-worker` 每个 tick 清扫库里已有的 open 招标，`npm run bids:lifecycle:sweep` 是一次性命令；原因记 `closed_reason = deadline_passed`。MySQL 清扫要求 MySQL ≥ 8.0.1。规则全文见[生命周期运维第 8 节](../operations/bid-lifecycle-and-crawl-budget.md) | 解析器、导入、清扫单测；MySQL 集成测试 |
| 改动前后无法证明没丢、没藏、没串类型 | **`npm run data:integrity`**：按 state / county / city / township / special_district / federal / other 分层的报告，加逐行快照与比对（未解释的删除、可见性回归、`identityMismatch` 上升都退出码 1）。它不写库 | SQLite 单测、CLI 单测；MySQL 集成测试要求两种数据库对同一份夹具给出同样的报告 |
| 容器镜像缺 Census 地域表：`discover-sources` 在 worker 和 runner 镜像里报 `JurisdictionTableError`（[全量测试](skill-assisted-full-test-2026-10-12.md) ISSUE-001） | `frontend/Dockerfile` 的 `crawler-runtime` 阶段把 `crawler/data/us_jurisdictions.tsv` 复制到 `/crawler/data/`，两个镜像都继承；CI 的 `crawler-runtime` 任务在 worker 镜像里加了 `--network none` 的离线探针 | `frontend/dockerfile.test.ts` 钉住这一行；真实构建见下 |

另外，`test:crawler-integration` 现在列出仓库里全部 `*.integration.test.ts`（Tasks 1–6 合并时是 11 个，此前漏了 5 个，其中 4 个是本次新增的；并入独立验收套件后是 12 个），`frontend/package-scripts.test.ts` 在有新的集成测试没被列入时失败；`bid-references-agree.test.ts` 要求迁移用的 `BID_CHILD_REFERENCES` 与演示清理的关系表对 `bids` 的引用是同一组列。

### 验证

每个数字都标了它跑在哪个提交上；没有标的格子表示那一轮没有跑。

| 检查 | 9675c8d（Tasks 1–6 合并后） | c178806（再加独立验收套件） | 本轮修复（c178806 之上，提交前的工作树） |
| --- | --- | --- | --- |
| 爬虫 pytest | 1,361 通过 | 1,368 通过 | 1,368 通过 |
| 前端全量 Vitest | 415 个文件 / 4,451 项 | 416 个文件 / 4,584 项 | 416 个文件通过、11 个按环境条件跳过；4,603 项通过、81 项跳过（含 `src/__acceptance__`） |
| `npm run test:crawler-integration`，指向一次性 MySQL 8.4.9 容器（随机密码，跑完即停），含 Python 爬虫 → HTTP extractor → 两个导入器的跨语言链路 | 11 个文件 / 114 项通过 | 12 个文件 / 120 项通过 | 12 个文件 / 120 项通过 |
| 独立验收套件（黑盒，只按计划写成） | 尚未并入 | 146/146 通过 | 146/146 通过：`src/__acceptance__` 2 个文件 139 项（SQLite 与 MySQL 各一个文件），加 Python 的 7 项 |
| ESLint | — | — | 通过 |
| `tsc --noEmit` | — | — | 仍报既有的类型诊断（276 条）；出错的文件集合与基线（78 个文件）完全相同，没有新增 |

本轮修复（评审意见 I-1 与次要项）之后，把手册里的流程在一次性 SQLite 库和 MySQL 8.4.9 库上重新走了一遍。数据是夹具数据加上遗留行：1 条旧 FIPS 的 Aurora、23 条旧 id 的 NY、54 条演示/种子招标（48 条 demo-readiness、6 条 mock）。结果：

- 清扫在还没迁移的库上只关闭了 2 条过期招标，23 条遗留 NY id、旧 FIPS 的 Aurora 行和 `is_active = 0` 的 open 行原样不动（它不迁移）；`--dry-run` 前后 SQLite 主文件的 SHA-256 相同、`-wal` 大小不变；
- 在 MySQL 上打开服务器的 general log，`--dry-run` 期间服务器收到的只有一条 `SELECT id, deadline_date, issuer_type FROM bids …`（外加驱动握手时的 `select @@version_comment`），没有 `START TRANSACTION`，没有 `UPDATE`；真跑时才出现 `START TRANSACTION`、`SELECT … FOR UPDATE SKIP LOCKED`、两条 `UPDATE`、`COMMIT`；
- 空文件、不存在的文件、没迁移的 MySQL 库，清扫都退出码 2，库不变，什么也没建；
- 迁移、清理（SQLite 用 `db:backup` 的备份，MySQL 用容器里 `mysqldump` 的备份）之后，带三条 `--allow-removed` 的比对退出码 0：删除 77 条、全部被放行（23 条 NY + 54 条演示），新增 23 条（重键后的 NY id），没有未解释的删除；文本输出每份 id 列表只列 20 个，`--json` 里 `comparison.removed.allowed` 是全部 77 个。两种数据库的结论一致。

| 检查 | 结果 |
| --- | --- |
| 镜像 | 在 Dockerfile 修复提交（aa30802）的内容上，于仓库根目录构建 `--target worker`，`docker run --rm --network none` 运行 CI 的探针：`load_jurisdictions()` 载入成功，`match_jurisdiction("city", "CA", "City of Los Angeles")` 返回 `{'status': 'exact', 'geoid': '0644000', 'name': 'Los Angeles city'}`；镜像里的表与仓库文件的 SHA-256 相同。ISSUE-001 的原命令（`discover-sources`，关闭网络）在修复前的镜像里报 `JurisdictionTableError`，在新镜像里越过了读表一步（因没有网络而以 `fetch_failed` 停止）。验证后镜像已删除；runner 镜像没有单独构建，它与 worker 共用同一个阶段；此后 Dockerfile 没有再改动 |
| `winbids` 备份上的数据演练（备份 → 快照 → `db:mysql:migrate` → 清理 → 清扫 → 比对） | **未验证**：属于独立测试阶段，尚未执行 |
| 业务库上执行迁移、清理、清扫 | **未验证**：尚未执行 |

### 州、市、县／郡数据完整性

本节的验证只在代码、迁移和一次性库上进行，**没有对业务库做数据验收**。按[州、市、县／郡数据测试验收要求](jurisdiction-data-acceptance.md)，三个层级的数据完整性与可靠性都**未验证**；上表中"预期结果"是代码的设计行为，待用 `data:integrity` 在业务库的备份上演练后才能转为证据。

| 层级 | 目标机构／来源数 | 已验证完整可靠 | 缺失／部分／过期 | 未验证 | 证据与最终结论 |
| --- | --- | --- | --- | --- | --- |
| 州 state | 范围未确认（本节没有使用目标清单） | 未验证 | 未统计 | 全部 | 只有代码、迁移和一次性库上的演练，没有业务库验收。**未验证** |
| 市 city | 范围未确认 | 未验证 | 未统计 | 全部 | 同上；Aurora 校正后 11 条变为 `city`、FIPS `0804000` 是预期，待业务库演练确认。**未验证** |
| 县／郡 county | 范围未确认 | 未验证 | 未统计 | 全部 | 同上。**未验证** |

township、special_district、federal 同样未验证，也没有并入上表凑数。列表完整性、正文真实性、附件与上游清单的一致性，`data:integrity` 本来就不证明（运维手册第 4 节），仍需按验收要求逐项取证。
