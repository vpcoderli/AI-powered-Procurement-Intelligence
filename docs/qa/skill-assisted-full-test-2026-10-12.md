# Skill 辅助全面测试报告

日期：2026-10-12（Asia/Singapore）。对象：当前工作区，包括测试开始时已有的未提交修改。

结论：测试执行已完成。4,939 个去重后的自动化用例通过，105 项浏览器功能、布局和页面检查通过；lint、生产构建通过。但质量门禁尚未全部通过：容器来源发现功能有可复现缺陷，依赖审计有严重告警，另有两组无障碍问题和中文翻译遗漏。默认种子数据不满足 50 州覆盖门禁。

按用户补充的[州、市、县／郡验收要求](jurisdiction-data-acceptance.md)，本次**整体真实数据完整可靠性未通过验收**。以下功能用例通过仅证明受控环境行为，不能作为真实辖区数据已齐全的结论。

| 层级 | 本次实际数据证据 | 完整可靠性结论 |
| --- | --- | --- |
| 州 state | 默认 seed 在 5 / 50 州有 active bid；45 州缺失；未逐源执行真实门户完整性核验 | 覆盖门禁未通过，真实数据可靠性未验证 |
| 市 city | 6 个受控来源、2 条受控招标用于功能检查，未与真实目标市级来源清单及上游公告全量对账 | 真实数据完整可靠性未验证 |
| 县／郡 county | 有离线分类、匹配及采集链路用例；未完成真实 county 来源的清单、正文和附件全量核验 | 真实数据完整可靠性未验证 |

县与郡均对应本项目 `county`；本次没有将二者重复计为独立辖区覆盖。

## 技能选择与安装

先检查 skills.sh 榜单，再按项目的 Next.js / Vitest / pytest / Playwright 技术栈搜索，核查来源仓库后安装。以下热度是本次检索时的约数，仅作为筛选依据。

| 技能 | 来源、热度 | 本次用途 |
| --- | --- | --- |
| [webapp-testing](https://skills.sh/anthropics/skills/webapp-testing) | [Anthropic 官方仓库](https://github.com/anthropics/skills)，约 175.2K 安装、180.6K stars | Python Playwright 浏览器测试、页面检查、截图 |
| [vitest](https://skills.sh/antfu/skills/vitest) | [Anthony Fu 仓库](https://github.com/antfu/skills)，约 40.1K 安装、6.0K stars | 完整测试运行、JSON 报告、集成测试开关 |
| [python-testing-patterns](https://skills.sh/wshobson/agents/python-testing-patterns) | [社区仓库](https://github.com/wshobson/agents)，约 35.2K 安装、40.4K stars | 三个 Python 组件的 pytest、隔离与确定性夹具 |

已执行的用户级安装命令：

```sh
npx --yes skills add anthropics/skills@webapp-testing -g -a codex -y
npx --yes skills add antfu/skills@vitest -g -a codex -y
npx --yes skills add wshobson/agents@python-testing-patterns -g -a codex -y
```

安装文件位于 `/Users/sakya/.agents/skills/`。同时使用已有的 `agent-browser`、`systematic-debugging`、`verification-before-completion`。Vitest 技能中的新版本示例没有用于升级项目；实际运行锁定依赖中的 Vitest 4.1.6。

## 环境与隔离

- 仓库：`/Users/sakya/workspace/AI-powered-Procurement-Intelligence`。
- 隔离副本：`/var/folders/f8/b7htr3k12zj23bbyrr2jq1g40000gn/T/apsi-full-qa-20261012-pav6d0a5`。
- 证据目录：`/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf`。
- Node.js 20.20.2，Next.js 16.2.6，Python 3.12.14，Scrapling 0.4.15，Playwright 1.63.0 / Chromium。
- UI 使用隔离 SQLite；数据库集成测试使用独立 MySQL 8 容器及测试创建、删除的临时数据库。未使用现有 MySQL 数据库。
- 未复制真实 `.env.local`。本地测试使用 file 通知提供方、受控账号和受控招标数据。浏览器核心场景阻止外部请求；批量抓取响应使用明确的本地 mock。
- 原始 `node_modules` 的 SQLite 原生模块与 Node 20 ABI 不兼容，仅在隔离副本重新编译。首次遗漏的 Census / seed-source 测试夹具已补齐并重跑，相关早期日志保留为 `*-before-*`。
- 生产模式本地服务器显式配置 `APP_ORIGIN=http://127.0.0.1:3022`，之后正常同源写入及恶意跨站拒绝都通过。未修改 CSRF 实现。

## 执行结果

| 检查 | 最终结果 | 证据 |
| --- | --- | --- |
| Vitest 默认全量 | 398 文件通过、2 文件条件跳过；3,674 用例通过，10 skipped + 18 pending | [日志](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/vitest.log)、[JSON](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/vitest.json) |
| 显式开启 crawler / MySQL 集成 | 3 文件、48 用例通过，无跳过；补齐默认运行未执行的 28 用例 | [日志](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/integration.log)、[JSON](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/integration.json) |
| crawler pytest | 951 通过 | [日志](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/crawler.log)、[JUnit XML](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/crawler.xml) |
| scrapling-extractor pytest | 133 通过；70 条 lxml 参数弃用警告 | [日志](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/extractor.log) |
| browser-downloader pytest | 153 通过，包含真实 Chromium 下载／渲染场景 | [日志](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/browser-downloader.log) |
| ESLint | exit 0 | [日志](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/lint.log) |
| Next.js 生产构建 | 默认 Turbopack 构建成功，exit 0 | [日志](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/build.log) |
| 数据初始化、4 项 worker 预检 | exit 0 | [seed](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/seed.log)、[workers](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/workers.log) |
| HTTP 健康检查 | web、extractor、browser-downloader 均 200 | [结果](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/service-health.json) |
| Docker worker / runner | 两镜像构建成功；worker 预检及 runner `/api/health` 通过；来源发现探针失败，见 ISSUE-001 | [worker 构建](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/docker-worker-build.log)、[runner 构建](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/docker-runner-build.log) |
| 浏览器核心断言 | 39 通过，0 未处理 JavaScript 异常 | [结果](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/browser-checks.json) |
| 中英文响应式布局 | 375 / 768 / 1440 px，36 通过，无页面级横向溢出 | [结果](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/responsive-checks.json) |
| 路由页面冒烟 | 29 普通页面返回 200；`/_not-found` 正确返回 404；共 30 通过，0 JS 异常 | [结果](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/page-smoke.json) |
| axe 无障碍 | 16 次中英文扫描中 12 次无已确认违规，4 次涉及同样的两组问题；两组均独立复测重现 | [汇总](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/a11y-summary.json) |
| Secrets 扫描 | 1,313 文件、0 发现，exit 0 | [日志](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/secrets.log) |
| i18n 扫描 | exit 0，但有提示；1,889 / 1,889 字典键，0 未解析占位符 | [日志](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/i18n.log) |
| 风险门禁 | exit 1：默认 seed 仅覆盖 5 / 50 州 | [日志](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/risk.log) |
| 生产依赖审计 | exit 1：26 个依赖条目有告警 | [原始 JSON](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/audit.log)、[汇总](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/dependency-risk-summary.json) |

自动化总数去重计算：Vitest 3,674 + 集成新增 28 + crawler 951 + extractor 133 + browser-downloader 153 = **4,939**。默认运行的所有 skipped / pending 用例均在显式集成运行中通过；48 项集成中有 20 项与默认运行重复，没有重复计数。浏览器 39 + 36 + 30 = **105 项**，另行统计，不混入上述用例总数。

## 浏览器覆盖内容

- 匿名搜索、市级筛选、组合关键词、收藏登录提示、无正文状态、不存在招标的 API 404。
- 页面注册、登录、退出；收藏刷新及重新登录后保留；供应商资料提交与持久化。
- 匿名、普通用户、operator、admin 权限边界；操作员不能访问用户／配置管理；非法 Origin 写入被拒绝。
- 管理员启停来源、全源质量汇总、无执行账来源保持 Unknown；六来源以 5 + 1 分批，使用来源自身 ID，忽略错误归属响应，缺项保留失败状态，结束后清空选择。
- 招标屏蔽后从公开搜索消失，恢复发布后重新出现。
- 搜索、招标详情、来源、质量、用户、配置页的中英文布局；全部非参数页面冒烟；16 次 axe WCAG 2 A / AA 规则扫描。

## 可复现发现

### ISSUE-001 — P1：Docker 镜像遗漏地域表，来源发现命令直接失败

影响：标准 worker 和 runner 镜像中的 `discover-sources` 在读取地域表时失败，尚未进入目录抓取。构建、健康检查、CLI help 都不能发现此缺陷。

原因证据：[Dockerfile:37](/Users/sakya/workspace/AI-powered-Procurement-Intelligence/frontend/Dockerfile:37) 只复制 `crawler/apsi_crawler`，没有复制 `crawler/data/us_jurisdictions.tsv`。默认路径在 [jurisdictions:42](/Users/sakya/workspace/AI-powered-Procurement-Intelligence/crawler/apsi_crawler/jurisdictions/__init__.py:42)，来源发现会在 [discovery_service:225](/Users/sakya/workspace/AI-powered-Procurement-Intelligence/crawler/apsi_crawler/discovery_service.py:225) 加载此文件；现有 compose 没有为它提供挂载。

复现（本次构建的镜像标签保留可供重现；关闭容器网络，避免触发真实抓取）：

```sh
docker run --rm -i --network none --entrypoint sh \
  apsi-qa-worker:20261012-z1msdhtf \
  -c 'cd /crawler && /opt/crawler-venv/bin/python -m apsi_crawler.cli discover-sources' <<'JSON'
{"platform":"bidnet","states":["CA"],"max_pages":1}
JSON
```

实际：exit 2，`JurisdictionTableError: cannot read jurisdiction table /crawler/data/us_jurisdictions.tsv`。换 runner 镜像完全重现。同一工作区的 `match_jurisdiction("city", "CA", "City of Los Angeles")` 正常返回 GEOID `0644000`，因此不是地域匹配逻辑或输入错误。

证据：[worker 失败日志](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/docker-worker-discovery-probe.log)、[runner 失败日志](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/docker-runner-discovery-probe.log)。非 UI 问题，截图／视频不适用。

建议：将运行期需要的地域表复制到共同的 `crawler-runtime` 阶段，并增加镜像内部的离线匹配探针；重新构建验证。

### ISSUE-002 — P2：招标详情的三个联系人标签对比度不足

复现：匿名打开受控招标 `/bids/qa_city_02%3Aqa-bid`，查看联系人卡片。英文／中文均重现。

实际：Contact、Email、Phone 标签（中文对应标签同样受影响）为 12px `text-slate-400`，前景 `#90a1b9`、背景 `#fcfcfd`，axe 测得 **2.56:1**，未达到普通文本的 4.5:1。axe `color-contrast`，impact `serious`，3 个节点。

代码：[page.tsx:653](/Users/sakya/workspace/AI-powered-Procurement-Intelligence/frontend/src/app/bids/[id]/page.tsx:653)，同组另两处为 657、663 行。建议调整标签颜色并复测。

证据：[截图](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/screenshots/issue-002-bid-contact-contrast.png)、[原始扫描](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/issue-002-bid-contact-contrast.json)、[独立复测](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/a11y-bid-en-recheck.json)。静态加载即可观察，视频不适用。

### ISSUE-003 — P2：配置页三个状态下拉框没有可访问名称

复现：以 admin 登录，打开 `/admin/config`，对配置注册表运行 axe。英文／中文均重现。

实际：3 个状态 `<select>` 没有关联 label、`aria-label` 或 `aria-labelledby`。axe `select-name`，impact `critical`；此处是无障碍规则严重性，与依赖审计的 Critical 不同。

代码：[ConfigRegistrySection.tsx:238](/Users/sakya/workspace/AI-powered-Procurement-Intelligence/frontend/src/components/admin/sections/ConfigRegistrySection.tsx:238)。建议提供包含对应配置项名称的中英文可访问名称。

证据：[截图](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/screenshots/a11y-admin-en-admin-config.png)、[原始扫描](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/a11y-admin-en-admin-config.json)、[独立复测](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/a11y-config-en-recheck.json)。静态 DOM 问题，视频不适用。

### ISSUE-004 — P3：两项中文文案仍为英文

字典检查确认 `intentsPage.creditDryRun` 和 `intentsPage.creditChargedAmount` 的中文分别仍是 `Credit dry-run`、`Charged amount`。它们已被意向详情页使用。

代码：[zh.ts:600](/Users/sakya/workspace/AI-powered-Procurement-Intelligence/frontend/src/lib/i18n/dictionaries/zh.ts:600)、[使用位置:2102](/Users/sakya/workspace/AI-powered-Procurement-Intelligence/frontend/src/app/intents/[id]/page.tsx:2102)。这是字典及调用链确认，未运行付费信用额度业务来展示该条件分支；截图／视频不适用。

扫描另有 6 项中英文相同技术名称（API、Markdown、ZIP、PDF、DOCX、W-9），不作为翻译缺陷。81 项硬编码提示属于启发式结果，包含原型页、品牌和 aria 文案，不能等同于 81 个已确认缺陷。[完整结果](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/i18n.log)。

## 安全与数据门禁

**生产依赖审计未通过。** `npm audit --omit=dev --audit-level=moderate --json` 报告 26 个依赖条目：2 Critical、17 High、6 Moderate、1 Low。Critical 条目包括直接依赖 `next@16.2.6` 和传递依赖 `proxy-addr@2.0.7`。需优先审查依赖路径、运行期可达性和升级兼容性；本次没有执行 `npm audit fix` 或修改锁文件。

已核查官方公告：[Next.js ImageResponse 公告](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j)、[proxy-addr 公告](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)。本项目源码未检出 `next/og` / `ImageResponse` 使用，不能据此宣称已证实该 RCE 可被利用。`shadcn` CLI 被放在 dependencies 中，其传递树也进入生产依赖审计；26 条不等于 26 个独立且可被远程利用的漏洞。[依赖汇总](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/dependency-risk-summary.json)。

**默认种子数据不满足全国覆盖门禁。** `npm run risk:check` 只在 5 / 50 州找到 active bid，剩余 45 州触发 `missing_state_bid`。账号权益、来源治理、来源元数据、已有招标内容与 URL 检查通过。此结果描述隔离环境的默认 seed，不代表生产数据库存在同样缺口，也不是 45 个代码失败。未伪造全国数据以使门禁通过。

`risk:check` 使用 `&&`，在 checklist 失败后没有继续执行 secrets / audit；两者已单独执行，上表记录的是各自实际结果。

## 复跑方式与测试边界

完整命令、工作目录和退出码位于各 `*-result.json`，编排脚本为 [run_check.py](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/run_check.py)。该脚本记录的是本次隔离路径与临时 MySQL 端口，重建环境后需更新路径／端口。

主要命令：

```sh
# frontend/，Node 20，SQLite 原生依赖须匹配当前 Node ABI
npm run lint
npm run build
npx vitest run --maxWorkers=4

# 显式打开集成用例；须提供专用 Python 和独立 MySQL URL
RUN_CRAWLER_INTEGRATION=1 \
CRAWLER_INTEGRATION_PYTHON=/path/to/python3.12 \
CRAWLER_INTEGRATION_MYSQL_URL=mysql://test-user@127.0.0.1:TEST_PORT/ \
npm run test:crawler-integration

# 根目录与各组件虚拟环境
PYTHONPATH=crawler /path/to/crawler-python -m pytest crawler/tests
# services/scrapling-extractor/ 和 services/browser-downloader/ 内分别执行
python -m pytest tests
```

浏览器复跑脚本：[核心流程](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/browser-checks.py)、[布局](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/responsive-checks.py)、[路由](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/page-smoke.py)、[axe](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/a11y-checks.py)。需要先重启隔离本地服务并重新登录，保存的会话可能过期。

未执行生产门户实时抓取、真实付费 AI / Stripe 支付、真实外部消息发送或云端 RDS / S3 部署。MySQL 用于集成用例，浏览器完整流程使用 SQLite。axe 的 incomplete 项和渐变背景仍需人工判断；本报告不等同于完整 WCAG 合规认证。worker 运行的是预检，未启动周期性外部抓取。

## 清理与修改记录

本次启动的三个本地 HTTP 服务、四个命名浏览器会话和两个测试容器均已关闭／移除。两个带 `apsi-qa-*:20261012-z1msdhtf` 标签的测试镜像及隔离副本保留用于重现；原有服务、容器未处理。

业务代码未修改；1,045 个源码／测试文件的前后 SHA-256 一致。[完整性记录](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/source-integrity.json)、[清理记录](/Users/sakya/.codex/artifacts/apsi-full-qa-2026-10-12-z1msdhtf/cleanup.json)。首次测试新增本报告；按用户后续要求，另更新根目录 `AGENTS.md` 并新增 `jurisdiction-data-acceptance.md`，将州、市、县／郡数据验收写入每次测试要求。保留所有已有未提交修改。测试账号及会话文件在证据目录中以私有权限保存，没有加入仓库。
