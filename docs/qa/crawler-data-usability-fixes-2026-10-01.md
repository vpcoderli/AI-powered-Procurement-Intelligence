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

1. **旧地方招标被隐藏。** 旧的县、市、镇招标存成 `issuer_type = 'state'`，被新门禁隐藏（本地 7,230 条中 1,355 条）。迁移按已登记地方源的级别回填 `issuer_type`，两种数据库各一条幂等语句。FIPS 与登记不一致的旧行保持原样：改了类型它就变成核心有效，之后每次修正过的重抓都会被身份校验隔离，保持原样则下次重抓会自愈。**部署顺序：先跑 `npm run db:mysql:migrate`，再让新代码接流量**，否则回填之前这些招标不可见。
2. **抓取失败抹掉正文。** 补采复用历史时不再带上一轮的 `applied_fields`，详情抓取失败不会再抹掉已验证的正文。
3. **SAM 附件内联下载。** SAM.gov 运行只记录附件链接，归档交给附件修复 worker（默认不随 compose 启动，见附件修复运维）。
4. **详情历史无上限。** 列表运行读最近 30 天、最多 5,000 行；补采只读本轮预算内的到期候选，扫描到上限时记 `crawler_detail_backfill_scan_capped`。
5. **正文判定误杀且两边不一致。** TypeScript 和 Python 两边统一为同一套规则，共享契约是 `crawler/tests/fixtures/description_quality_contract.json`（80 例）。访问提示和报错页只有整句出现才算：登录/注册后面必须跟"查看/访问/下载/继续"等去向、"required"，或者就此结束；报错短语后面必须是标点、句末或 "you don't have permission"。整段只是一个地址才算地址。

回填后仍不可见、留待后续处理的有 37 条：22 条 `ny_contract_reporter` 的发布方为"Unknown state agency"；11 条已关闭的 `bidnet_co_city_aurora` 带旧 FIPS `0803455`，回填有意不改它们（审查 P1-8）；另有 4 条演示数据。
