# 州/县/市招标数据完整性：`data:integrity`、截止日清扫与演示数据清理

实施计划见[州/县/市数据完整性实施计划](../superpowers/plans/2026-10-13-data-integrity.md)；验收口径见[州、市、县／郡数据测试验收要求](../qa/jurisdiction-data-acceptance.md)；招标状态流转与截止日规则的完整定义见[招标生命周期、BidNet 翻页与平台预算](./bid-lifecycle-and-crawl-budget.md)第 8 节；备份与恢复见[备份与恢复运维](./backup-restore-runbook.md)。本文只讲运维：为什么要有这套工具、每次改动前后怎么用、报告里每个数字是什么意思、它证明什么与不证明什么、截止日规则与清扫、演示数据怎么清、BidNet 详情锁为什么补不了正文。

一句话原则：**改动前拍快照，改动后比对。不能证明没丢、没藏、没串类型，这次改动就不算完成。**

## 1. 为什么需要它

2026-10 的几轮审查和全量测试发现，州/县/市数据的问题大多是悄悄发生的：

- 旧的县、市、镇招标被存成 `issuer_type = 'state'`，被发布门禁隐藏（P0 修复时本地 7,230 条里有 1,355 条，见[修复记录](../qa/crawler-data-usability-fixes-2026-10-01.md)）；
- 回填之后仍不可见的 37 条里，11 条是已关闭的 `bidnet_co_city_aurora`，带着旧 FIPS `0803455`；22 条是 `ny_contract_reporter` 的转包卡片，id 里粘着 `Company: …`、发布方是 "Unknown state agency"；
- 本地数据里混着 56 条演示/种子招标（`demo:prepare` 生成的 50 条 demo-readiness，加 `db:seed` 的 6 条 mock），它们会污染各州的招标数量与覆盖统计；
- 截止日已过的招标仍然是 `open`，要等它的门户下一次把它列出来，或者永远等不到。

单元测试通过只说明代码按预期工作，说明不了真实库里某一层少没少、哪几行被改过。`data:integrity` 补的就是这一块：

1. **分层报告**：按 `state / county / city / township / special_district / federal / other` 各出一列，数字可复现、可前后对比；
2. **逐行快照与比对**：改动之前给每条招标留一份指纹，改动之后逐行比对，把"丢了、藏了、串类型了"变成退出码。

`data:integrity` **不写库**。其余两个命令（清扫、演示数据清理）会写库，见第 5、6 节。

## 2. 三个命令，以及每次改动前后怎么用

| 命令 | 做什么 | 写库 | 退出码 |
| --- | --- | --- | --- |
| `npm run data:integrity` | 打印分层报告；`--snapshot <文件>` 拍快照；`--compare <文件>` 与快照比对 | 不写 | `0` 完成（比对通过）；`1` 发现回归，或运行失败；`2` 用法错误：参数不对（包括不带 `--compare` 的 `--allow-removed`）、要比对的快照不存在或不是快照、`--snapshot` 要写的文件已存在、或它的目录不存在、不可写，SQLite 文件不存在或 `DATABASE_PATH` 是个目录 |
| `npm run bids:lifecycle:sweep` | 一次截止日清扫：关闭截止日已过的 open 招标；`--dry-run`、`--json`；**从不迁移** | 写；`--dry-run` 在两种数据库上都不写 | `0` 跑完；`1` 失败（含拼错的参数、MySQL 连不上）；`2` 目标不可用：SQLite 文件不存在或是目录，或者库没有迁移 |
| `npm run bids:purge-demo` | 删除演示/种子招标和它们的全部依赖行；默认只预演 | 只有 `--apply` 才写 | `0` 完成；`1` 出错（整个事务已回滚）；`2` 用法错误（备份文件缺失、为空、不是文件、就是数据库本身，或 SQLite 文件不存在或是目录） |

三个脚本都在 `frontend/scripts/`，都应当从 `frontend/` 目录用 `npm run` 运行。

**它们连哪个库**

- `DATABASE_URL`（或 `MYSQL_DATABASE_URL`）是 `mysql://` 就连 MySQL；否则用 SQLite 文件 `DATABASE_PATH`，默认 `frontend/data/apsi.sqlite`。
- 三个脚本只读进程环境变量，**不读 `.env.local`**：要连哪个库，就在 shell 里 `export DATABASE_URL=…`。注意 `npm run db:backup` 会读 `.env.local`，两边可能指向不同的库。
- 三个命令共用同一个目标解析和打开方式（`frontend/src/server/integrity/open-target.ts`）：`DATABASE_PATH` 的相对路径相对 `frontend/` 解析，与你从哪个目录启动无关；SQLite 文件必须已经存在，否则（或者它是个目录）退出码 `2`，而且不会创建空库，也不会因为加载应用的 `db/client` 在当前目录建出 `data/apsi.sqlite`。三个命令一打开目标就把它打印到 **stderr**（MySQL 的密码已打码，形如 `Target: mysql mysql://root:***@127.0.0.1:3306/apsi`）。每次都核对这一行，确认没有连错库；加 `--json` 时 stdout 仍然只有一个 JSON 文档，目标行不会混进去。
- `bids:lifecycle:sweep` **从不迁移**。SQLite 文件里缺清扫要读写的列（空文件、旧库），或 MySQL 里没有 `bids` 表或缺列时，它退出码 `2`，提示先跑 `npm run db:migrate`（MySQL：`npm run db:mysql:migrate`），库一个字节不动。`--dry-run` 在 SQLite 上以只读方式打开文件（连接本身拒绝写入），在 MySQL 上只发 `SELECT`、不开事务，所以预演在两种数据库上都不写。
- `npm run db:migrate` 总是迁移 `<工作目录>/data/apsi.sqlite`，不读 `DATABASE_PATH`。SQLite 部署请保持默认路径，否则迁移的和检查的不是同一个文件。

### 2.1 备份 → 快照 → 改动 → 比对

1. **停机窗口。** 停掉 crawler 和全部 worker（`worker:crawler`、`worker:events`、`worker:notifications`、`worker:attachments`），**也停掉 web 应用**（至少要冻结手动触发的抓取和管理端的招标质检编辑）：web 应用的抓取接口（`/api/crawler/state/run`、`/api/crawler/sam-gov/run`）和管理端招标质检（`/api/admin/bids/qa`）都会写 `bids`。快照里每条招标的哈希覆盖 `bids` 的**每一列**，`updated_at`、`last_seen_at` 也在内：两次快照之间有人写过的行都会显示成"变了"，也就没法拿来证明"别的行没动"。这本来就是迁移、部署的维护窗口。单独在 MySQL 上执行 `bids:purge-demo --apply` 时，同样要先停 web 应用和所有 worker，见第 6 节。
2. **备份。** SQLite：`npm run db:backup`（SQLite 在线备份接口，WAL 安全，写到 `frontend/data/backups/apsi-sqlite-<时间>.sqlite`；`-- --source=<库文件> --out=<目录>` 可以指定来源和输出目录）。MySQL：本机装了 `mysqldump` 就用 `npm run db:backup`，否则在 MySQL 容器里 `mysqldump`。密码走环境变量，不放进任何命令行：先在 shell 里 `export MYSQL_PWD=…`，`docker exec -e MYSQL_PWD` 不带值，docker 就从当前 shell 的环境里取，不会让密码出现在宿主机的进程参数里：

   ```bash
   docker exec -e MYSQL_PWD <MySQL 容器> \
     mysqldump -uroot -h127.0.0.1 --single-transaction --routines --triggers <数据库名> > before.sql
   ```

   RDS 以自动快照/PITR 为主，细节见[备份与恢复运维](./backup-restore-runbook.md)。
3. **快照。**

   ```bash
   cd frontend
   npm run data:integrity -- --snapshot before.json
   ```

   打印报告，并把快照写进 `before.json`（一行 JSON，每条招标几百字节，里面有标题等业务数据，不要提交进仓库）。**`--snapshot` 不会覆盖已存在的文件**，直接退出码 `2`：快照是这次改动的基线，覆盖了就没有证据了。换个新文件名，或者自己先删旧文件。
4. **改动**：迁移、部署、数据修复（整批上线的顺序见 2.3）。
5. **比对。**

   ```bash
   npm run data:integrity -- --compare before.json
   ```

   退出码 `0` 才算通过。读法见 3.3。计划内会让 id 消失的改动要显式放行（2.2）。
6. **留下新基线（可选）。** `--compare before.json --snapshot after.json` 在同一次运行里比对，再把刚读到的状态写成新快照，作为下一次改动的基线；`after.json` 已存在同样拒绝覆盖（退出码 `2`）。文本模式**先打印比对结果，再写文件**；`--json` 模式先写文件，再打印唯一的一个 JSON 文档，由文档里的 `snapshot`（写成了：`{ file, bids, bytes }`）或 `snapshotError`（没写成：原因）说明文件的结果。文件的目录不存在或不可写、文件已存在，这些在读库之前就被拒绝（退出码 `2`）；读库之后写不出来，比对结果照常打印，stderr 多一行 `Snapshot not written: …`，通过的比对因此以 `2`（文件在此期间出现了）或 `1`（其他原因）退出，没通过的比对仍然是 `1`。

读取是一致的：SQLite 的整次扫描在一个事务里；MySQL 的所有读取在**同一个 `REPEATABLE READ`、只读、带一致性快照的事务**里（`START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`），服务器本身拒绝这条连接上的任何写入。所以一份报告或一份快照描述的是同一个时刻，不会一半是写入前、一半是写入后。注意这只保证**一次扫描**内部一致；两次扫描之间有人写过，仍然会被比对看到（见第 1 步）。扫描按页读完全部招标，大库请在副本上或业务低峰运行。

### 2.2 `--allow-removed`：计划内会让 id 消失的改动

比对把"快照里有、现在没有"的 id 一律当作**未解释的删除**，退出码 `1`。如果这次改动本来就会让某些 id 消失，用 `--allow-removed <正则>` 逐类放行：

| 计划内的改动 | 哪些 id 会消失 | 放行写法 |
| --- | --- | --- |
| NY 转包行重键（`db:migrate` / `db:mysql:migrate` 里的数据迁移，第 7 节） | `ny_contract_reporter:<CR#> Company: <公司>`（同时新增 `ny_contract_reporter:<CR#>`） | `--allow-removed '^ny_contract_reporter:.+ Company: '` |
| 演示/种子招标清理（`bids:purge-demo --apply`，第 6 节） | `<源 id>_demo_readiness`（demo-readiness）和纯数字 id（mock） | `--allow-removed '^[^:]+_demo_readiness$' --allow-removed '^[0-9]+$'` |

- `--allow-removed` 不带 `--compare` 是用法错误（退出码 `2`）：没有快照可比，就没有什么可放行的。它**可以重复**，默认一条都没有。
- 参数是**不锚定**的 JavaScript 正则（不带 flags）：不写 `^…$`，它会匹配 id 里的任何位置。**一律锚定。**
- 比对的输出（文本和 `--json` 都是）会把被放行的删除 id 列出来，并把删除和新增的 id 按层级分组。**放行之后必须核对：被放行的 id 恰好是你要动的那些行**，数量要对得上（演示清理的 `Demo bids: N`、NY 重键的条数）。放得过宽的正则会在这里露出来，比如本该只有几十条的列表里混进了真实招标的 id。
- **文本输出里每份 id 列表最多列 20 个**，其余只显示 `... and N more`。2.3 的场景放行 78 个 id（56 条演示加 22 条 NY），都在 `state` 层级，演示 id 排在前面，NY 的 id 在文本里一个也出不来。要完整核对，用 JSON：`npm run --silent data:integrity -- --compare before.json --allow-removed … --json`，看 `comparison.removed.allowed`（全部被放行的 id）和 `comparison.removed.allowedByLevel`（按层级分组），数量和 id 都与预期对上才算数；`comparison.removed.unexpected` 是没被放行的，`comparison.added.ids` / `idsByLevel` 是新增的。

### 2.3 把这几件事一起上线时的顺序

下面的顺序也是数据演练用的顺序。所有命令从 `frontend/` 运行；MySQL 上把 `db:migrate` 换成 `db:mysql:migrate`。

```bash
# 先停 crawler、全部 worker 和 web 应用，然后按 2.1 备份。
npm run data:integrity -- --snapshot before.json
npm run db:mysql:migrate                              # SQLite：npm run db:migrate。FIPS 校正与 NY 重键在这里执行
npm run bids:purge-demo                               # 预演：看数量
npm run bids:purge-demo -- --apply --backup-file <备份文件>
npm run bids:lifecycle:sweep -- --dry-run             # 首次补扫：先看会关多少
npm run bids:lifecycle:sweep
npm run data:integrity -- --compare before.json \
  --allow-removed '^ny_contract_reporter:.+ Company: ' \
  --allow-removed '^[^:]+_demo_readiness$' --allow-removed '^[0-9]+$'
```

比对通过、被放行的 id 核对无误（文本只列前 20 个，完整核对用 2.2 里的 `--json`）之后，再启动 worker 和 web。MySQL 清扫要求 **MySQL ≥ 8.0.1**（第 5 节），跑之前先 `SELECT VERSION()`。

## 3. 怎么读报告

```bash
npm run data:integrity                          # 文本报告
npm run --silent data:integrity -- --json       # 同样的内容，stdout 只有一个 JSON 文档
```

JSON 的形状：报告是 `{ target, mode: "report", report }`；带 `--snapshot` 时 `mode` 是 `snapshot`，多一个 `snapshot: { file, bids, bytes }`；带 `--compare` 时是 `{ target, mode: "compare", comparison, report }`，同时带 `--snapshot` 时再多一个 `snapshot`（写成了）或 `snapshotError`（没写成，是原因）。`comparison` 里 `added` 和 `removed` 各有 `ids`（全部）和 `idsByLevel`（按层级分组），`removed` 还分成 `allowed` / `allowedByLevel`（被 `--allow-removed` 放行的）和 `unexpected` / `unexpectedByLevel`（没被放行的）。脚本保证 stdout 里只有这一个文档（目标行走 stderr），但 `npm run` 自己会先往 stdout 打两行脚本横幅，要把输出交给别的程序解析，就像上面那样加 `--silent`；`bids:lifecycle:sweep` 和 `bids:purge-demo` 的 `--json` 同理。

### 3.1 版面与示例

每一列是一个层级，最右一列是合计。**层级**取招标的 `issuer_type`：`state / county / city / township / special_district / federal` 之一，其他任何值（包括拼错的、不认识的）归 `other`。`township`、`special_district`、`federal` 各自单列，不会并进州、市、县来凑数。

下面是测试夹具数据（`frontend/src/server/integrity/data-integrity.fixtures.ts` 的 23 条，再加一条旧 FIPS 的 Aurora 行和一条旧 id 的 NY 行）上的真实输出，数字没有业务含义，只用来对照版面；路径已省略：

```text
Data integrity report
Target: sqlite <路径>/apsi.sqlite
Generated at: 2026-10-13T02:26:08.444Z (sqlite)

                        state  county  city  township  special_district  federal  other  total
Bids
  total                    15       4     3         1                 0        1      1     25
  open                     12       3     2         1                 0        1      1     20
  closed                    2       1     0         0                 0        0      0      3
  awarded                   1       0     1         0                 0        0      0      2
Search visibility, of the open bids (shown by search / not shown)
  openVisible               5       2     2         1                 0        1      0     11
  openHidden                7       1     0         0                 0        0      1      9
Identity and source checks, of all bids
  identityMismatch          2       1     0         0                 0        0      1      4
  unregistered              3       0     0         0                 0        0      0      3
  demoLike                  2       0     0         0                 0        0      0      2
  nonCanonicalId            4       0     0         0                 0        0      0      4
  activeFlagMismatch        1       0     0         0                 0        0      0      1
Completeness, of the open bids
  withBody                 10       2     2         0                 0        1      1     16
  detailLockedAtSource      0       1     0         1                 0        0      0      2
  bodyMissing               2       0     0         0                 0        0      0      2
  withIssuer                9       3     2         1                 0        1      1     17
  deadlineParseable        11       2     2         1                 0        1      1     18
  withSourceUrl            12       3     2         1                 0        1      1     20
Lifecycle
  expiredOpen               1       0     1         0                 0        0      0      2
Enabled sources
  sources                   3       1     1         1                 0        1      0      7
  neverSucceeded            1       0     0         0                 0        0      0      1
  succeededWithin2d         1       1     1         1                 0        0      0      4
  succeededWithin7d         2       1     1         1                 0        0      0      5
  failing                   1       0     1         0                 0        1      0      3

Newest last_seen_at of any bid of the level
  state           2026-10-13T08:00:00.000Z
  ...

Why open bids are not shown (a bid can have several reasons)
  state: invalid_issuer 3, inactive_flag 1, registered_source_ambiguous 1, registered_source_mismatch 1, suppressed 1
  county: registered_source_mismatch 1
  other: invalid_issuer_type 1, registered_source_mismatch 1
  total: invalid_issuer 3, registered_source_mismatch 3, inactive_flag 1, invalid_issuer_type 1, registered_source_ambiguous 1, suppressed 1

Legacy NY ids (ny_contract_reporter:% Company:%) still in the data: 2
  ny_contract_reporter:2138289 Company: E.W. Howell Co., LLC.
  ny_contract_reporter:CR9 Company: Acme Inc
```

### 3.2 每个指标是什么意思

**数量与生命周期**（所有招标）

| 指标 | 含义 | 异常时 |
| --- | --- | --- |
| `total` / `open` / `closed` / `awarded` | 按生命周期分：`lifecycle_status` 是 `open` / `closed` / `awarded` 就按它；为空或不认识的值，按 `is_active` 算（1 是 open，其余是 closed），与搜索读法一致 | 改动前后 `total` 减少必须能用 `--allow-removed` 解释 |
| `activeFlagMismatch` | `is_active` 与 `lifecycle_status = open` 不一致的行数。搜索读 `is_active`，应用的其余部分读生命周期 | 应为 0。非 0 说明有写入方只改了其中一个 |
| `expiredOpen` | 仍是 `open`、但截止日按第 5 节的规则已经到期的招标（在报告生成的时刻判断） | 清扫之后应为 0；worker 在跑却一直非 0，看 `crawler_lifecycle_sweep` 日志 |

**搜索可见性**（只数 `open` 的招标）

| 指标 | 含义 | 异常时 |
| --- | --- | --- |
| `openVisible` | 搜索会显示的 open 招标。三个条件同时成立：`display_status` 不是 `suppressed`、发布门禁通过（和搜索用的是同一个 `isPublishableRow`：登记源身份校验 + 发现可用性）、`is_active = 1` | — |
| `openHidden` | 其余的 open 招标 | 改动后上升，先分清是新增了本来就藏着的行，还是原来可见的行被藏了；后者比对会报 `visibility_regression` |
| `hiddenReasons`（"Why open bids are not shown"） | 每条被藏的 open 招标为什么被藏，按次数从多到少。**一条可以有多个原因，逐个计数**，所以原因之和可以大于 `openHidden` | 见下表 |

`hiddenReasons` 里的代码：

| 代码 | 含义 |
| --- | --- |
| `suppressed` | `display_status = 'suppressed'` |
| `inactive_flag` | 生命周期是 open，但 `is_active = 0` |
| `registered_source_ambiguous` | 招标只能靠源名称（label）归属，而有多个源共用这个名称，无法确定属于谁 |
| `registered_source_mismatch` | 登记源与招标在层级、州或 FIPS 上不一致（门禁按不区分大小写比较） |
| `missing_identity` / `invalid_title` / `invalid_issuer` / `invalid_issuer_type` / `invalid_state_code` / `jurisdiction_mismatch` / `invalid_fips_code` / `invalid_source_url` / `missing_source_locator` | 核心字段不合格（`bid-usability.ts` 的 `getBidCoreIssues`）。`invalid_issuer` 是发布方为空，或是 "Unknown" 后面跟空白/到此结束（例如 "Unknown state agency"） |
| `data_quality_core_invalid` / `data_quality_discovery_off` | 入库时存在 `raw_payload.data_quality` 里的质量结论判了核心无效 / 不可发现 |
| `unexplained` | 门禁说不行，上面又都没有对上号。出现就说明报告漏了一种原因，要查 |

**身份与来源检查**（所有招标，含已关闭的）

| 指标 | 含义 | 异常时 |
| --- | --- | --- |
| `identityMismatch` | 招标的登记源（先按 id 前缀找，再按历史 label 找，和门禁一样）在**层级**（本地源看 `issuer_type`/`jurisdiction_level`）、**州**（精确，区分大小写）或 **FIPS**（两边都非空）上与招标不一致。门禁对未知源放行、对登记源不区分大小写，这一项更严：按精确比较单独算 | 应为 0。比对里任何一层上升，直接 `identity_mismatch_increased`，退出码 `1`。典型成因：遗留的 `state` 型本地招标、FIPS 漂移（第 7 节） |
| `unregistered` | id 前缀（第一个 `:` 之前的部分；没有冒号就是整个 id）不是任何 `data_sources.id`。演示/种子招标、源被删除或改名之后的旧招标、只按 label 归属的老 id 都在这里 | 演示清理之后，应只剩能逐条解释的历史行 |
| `demoLike` | 命中演示清理规则：id 前缀不是登记源，并且（id 以 `_demo_readiness` 结尾且 `source_bid_id` 以 `demo:` 开头，或 id 全是数字且 `source_bid_id` 是 `mock:<id>`） | 清理之后应为 0。再出现说明有人又跑了 `demo:prepare`、`db:seed` 或 `db:mysql:import-sqlite`，见第 6 节 |
| `nonCanonicalId` | id 不是 `<源 id>:<source_bid_id>`（以 id 前缀作为源 id）。演示/种子行、没有冒号的老 id、id 与 `source_bid_id` 对不上的行 | 非 0 要逐类解释。它和 `malformedNyIds` 是两回事：遗留 NY id 恰好等于 `前缀:source_bid_id`，不算在这里 |

**完整性**（只数 `open` 的招标）

| 指标 | 含义 | 异常时 |
| --- | --- | --- |
| `withBody` | 有值得展示的正文（`getBidDescription` 非空，已排除标题回显、登录页、报错文案等） | — |
| `detailLockedAtSource` | 门户把正文锁给注册会员（`raw_payload.detail_access.restricted` 含 `description`）。**这一项数的是所有被锁的 open 招标，包括列表页摘要已经算作正文的那些** | 被锁不是抓取失败，见第 8 节 |
| `bodyMissing` | 没有正文，**而且**门户没有锁：真正缺失 | 才是要补的缺口：查详情补采/正文补采运维 |
| `withIssuer` | 发布方是真实名称，与发布门禁的 `invalid_issuer` 同一条规则：发布方为空，或是 "Unknown" 后面跟空格/到此结束，都算缺 | 低于 `open` 说明有占位发布方，通常也会出现在 `hiddenReasons` 的 `invalid_issuer` 里 |
| `deadlineParseable` | 截止日文本能被第 5 节的解析器读懂 | 读不懂的招标永远不会被关，清扫把它们记成 `unparseable` |
| `withSourceUrl` | `source_url` 非空 | — |

把正文这几项合起来看：`open − withBody` 是没有正文的 open 招标。其中 `bodyMissing` 是"门户没锁、本地也没有"的，其余的 `open − withBody − bodyMissing` 是"门户锁了、本地也没有"的。所以"没有正文"分成"被源站锁住"和"真正缺失"两类，只有后一类算缺口。

**新鲜度**

| 指标 | 含义 | 异常时 |
| --- | --- | --- |
| `newestLastSeenAt`（"Newest last_seen_at of any bid of the level"） | 该层级任意一条招标的最新 `last_seen_at`，也就是抓取最近一次看到这一层数据是什么时候 | 某一层的日期明显落后，说明这一层的抓取停了 |
| 来源健康（"Enabled sources"） | 来自 `data_sources`，**只数 `is_enabled = 1` 的源**。州级和联邦源的 `jurisdiction_level` 是空的：算 `state`，只有 `sam_gov` 算 `federal`。`sources` 启用的源数；`neverSucceeded` 从没成功过（没有 `last_success_at`）；`succeededWithin2d` / `succeededWithin7d` 最近一次成功在 2 / 7 天以内（2 天内的也在 7 天内里）；`failing` 当前 `consecutive_failures > 0` | 这是**抓取健康**，不是数据真实性：昨天成功过的源，列表仍可能不完整 |

**全局**

| 指标 | 含义 | 异常时 |
| --- | --- | --- |
| `malformedNyIds`（"Legacy NY ids … still in the data"） | 还留在库里的遗留 NY id：`ny_contract_reporter:<CR#> Company: <公司>`。NY 重键（第 7 节）会跳过有子表数据（被收藏、被立项、有附件……）的行，也会跳过新 key 与别的行冲突的行，它们就留在这里 | 应为 0，或者逐条解释。**它是个数字**，数的是这些 id：报告在计数下面把它们列出来（文本里前 20 个，多的显示 `... and N more`；JSON 里 `report.malformedNyIdList` 是全部，`report.malformedNyIds` 仍是个数）。也可以直接查：`SELECT id FROM bids WHERE id LIKE 'ny!_contract!_reporter:% Company:%' ESCAPE '!'` |

### 3.3 怎么读比对

`--compare` 的输出依次是：

1. 结论行：`OK`、`OK (with warnings)` 或 `REGRESSION`，以及两份快照的时间、方言和招标条数；
2. **Failures（退出码 `1`）**：
   - `removed_unexplained`：有招标被删，而没有任何 `--allow-removed` 能解释；
   - `visibility_regression`：改动前是 open 且搜索可见、现在仍是 open 却不可见；
   - `identity_mismatch_increased`：某一层的 `identityMismatch` 上升；
3. **Warnings（不影响退出码）**：
   - `closed_without_reason`：招标从 open 变成了 closed，而 `raw_payload.lifecycle.closed_reason` 不是 `deadline_passed` / `delisted`（中标 `awarded` 自成一种原因，不算）。包括迁移把 `is_active = 0` 的 open 行改成 closed 时关掉的行，以及 `raw_payload` 不是 JSON 对象、被导入或清扫关闭而没法记原因的行（第 5 节）；逐条看是否符合预期；
   - `dialect_changed`（快照和现在不是同一种数据库）、`columns_added` / `columns_removed` / `hashes_not_comparable`（`bids` 表结构变了：新增列时比对按旧快照的列算哈希；删列时没法还原旧哈希，只能比对跟踪列、可见性和指标）；
4. 计数行：`Bids: added … removed … changed … changed only outside the tracked columns …`，以及按层级分组的新增 id 列表和被 `--allow-removed` 放行的删除 id 列表（没被放行的在 Failures 里）。每份列表在文本里最多列 20 个，完整的在 `--json` 里；
5. **`Changed bids, by what changed`**：按"改了什么"分组，例如 `issuer_type state→city: 11`、`lifecycle_status open→closed: 340`。只有下面这十个跟踪的列会被点名，其余列的任何改动都只出现在第 6 项，不说是哪一列。跟踪的列是 `issuer_type`、`jurisdiction_level`、`fips_code`、`lifecycle_status`、`is_active`、`display_status`、`issuer_name`、`title`、`deadline_date`、`source_bid_id`；
6. `Changed only outside the tracked columns`：哈希变了、十个跟踪列都没变的行（改了描述、`raw_payload`，或者 `updated_at`、`last_seen_at`……），只给 id 和个数；
7. `Metrics that moved`：每个层级、每个指标的前后值和差。

一次干净的比对：没有未解释的删除，没有可见性回归，`identityMismatch` 没有上升，`Changed bids` 里出现的每一组都能对应到这次改动本来要做的事。几类计划内改动在比对里长什么样：

| 改动 | 比对里应该看到 |
| --- | --- |
| FIPS 校正 | `issuer_type state→city`（或 county、township）若干条，加上同一批行的 `fips_code changed`；`identityMismatch` 下降 |
| NY 重键 | 旧 id 出现在删除里（要 `--allow-removed`），新 id 出现在新增里；`malformedNyIds` 下降；原来发布方是 Unknown 的行通常不再被藏，`openHidden` 下降 |
| 演示清理 | 删除里只有 `*_demo_readiness` 和纯数字 id；`demoLike`、`unregistered` 下降 |
| 截止日清扫 | `lifecycle_status open→closed` 与 `is_active 1→0` 成对出现；`expiredOpen` 下降；没有 `closed_without_reason`，除非那几条的 `raw_payload` 不是 JSON 对象（导入和清扫都不给这样的行记原因） |

## 4. 它证明什么，不证明什么

**它证明的**（在这个数据库里，针对改动前后）：

- 快照到快照之间：哪些招标没了、哪些行变了（行哈希覆盖每一列），以及十个跟踪列里是哪几列变了；其余列的改动只显示为"只在跟踪列之外变化"，不说是哪一列；
- 没有"本来搜得到、现在搜不到"的 open 招标；
- 招标与登记源在层级、州、FIPS 上是否一致（`identityMismatch`）、id 是否规范（`unregistered`、`nonCanonicalId`）、有没有演示数据（`demoLike`）；
- 每个层级入库数据的数量、可见性、关键字段、截止日状态，以及各层级启用的源的抓取健康。

**它不证明的**：

- **上游完整性**：这次列表有没有把门户上所有 open 招标抓全（列表是否走到底、有没有被预算/WAF/超时截断，见生命周期运维第 2 节的 `metadata.pagination`）；
- **正文是否与门户一致**。`withBody` 只说明有一段通过了正文质量门禁的文字，不说明它真实；
- **附件是否与上游文件清单一致**。报告不统计附件；
- **没抓到的招标**。从没入库的招标不在任何一个数字里，`sources` / `neverSucceeded` 只是线索，不是目标机构清单。

所以它**不能替代**[州、市、县／郡数据测试验收要求](../qa/jurisdiction-data-acceptance.md)。那份文档管整张验收矩阵，`data:integrity` 只是其中一部分证据：

| 验收项 | `data:integrity` 给出的证据 | 仍然需要 |
| --- | --- | --- |
| 来源可靠、辖区正确 | `identityMismatch`、`unregistered`、`nonCanonicalId` | 官方来源核验、来源 URL 与核验时间、同名县市/跨租户混入的人工抽查 |
| 列表完整 | 无（`newestLastSeenAt`、来源健康只说明抓取在不在跑） | 上游总数或可靠的结束证据、唯一 ID 对账、停止原因 |
| 招标字段完整 | `withIssuer`、`deadlineParseable`、`withSourceUrl`、`withBody` 的数量 | 联系人等没有统计的字段；上游有而我们缺的字段 |
| 正文真实可用 | `withBody`、`detailLockedAtSource`、`bodyMissing` | 与原始公告逐项核对，分层抽样 |
| 附件完整且属于本项目 | 无 | 对照上游公开文件清单，下载并校验 |
| 时效与生命周期 | `expiredOpen`、`closed` / `awarded` 数量、`closed_without_reason` 警告 | 来源既定的时效要求、修订记录 |
| 导入与展示一致 | `openVisible` / `openHidden` / `hiddenReasons` 与搜索一致；比对证明改动没有丢、没有藏 | 浏览器流程、API 层核验 |
| 缺失与恢复有去向 | `bodyMissing`、`hiddenReasons`、`failing` 指出缺口在哪 | 逐来源、逐记录的缺口清单，补采后复验 |

写测试报告时（`AGENTS.md` 的要求，口径同验收文档）：州 `state`、市 `city`、县／郡 `county`（县和郡都是 `county`，不重复计数）分别给出目标机构／来源数、已验证数、缺失/部分/过期数、未验证数。`data:integrity` 的数字属于"已入库"一侧的证据，**不能填成目标数**；没有目标清单的层级写"范围未确认／未验证"，不要写"通过"。

## 5. 截止日规则与清扫

完整的规则、示例表和 `closed_reason` 取值见[生命周期运维第 8 节](./bid-lifecycle-and-crawl-budget.md)。运维上需要记住的：

- **原则：宁可晚关，不可早关。** 门户印出来的时区（"CST"）不可信，文本又常有歧义，所以每处有歧义的地方都取最晚的读法。
- 一律按 **UTC−10**（夏威夷）读：只有日期的截止日 `D` 在 `D+1` 的 00:00（UTC−10）到期，当天整天有效；没有时区的时刻当作 UTC−10 的墙上时钟；明确带 `Z` 或偏移的才是精确时刻。读不懂、空白、年份不在 2000–2100 的（"0001-01-01"、"1970-01-01" 这类占位），**永远不到期**。实现是 `frontend/src/lib/bid-deadline.ts`。
- 两处执行：
  1. **导入时**：爬虫导入一条 open 招标，截止日按规则已到期，就直接存成 `closed`；这次导入说它仍是 open、截止日又在将来，则把此前关闭的招标重新打开；`awarded` 的招标不会被降级为 `closed`。
  2. **清扫**（`sweepExpiredBids`）：处理那些门户已经不再列出、或者所在源很久没抓的 open 招标——导入管不到它们。
- **worker 怎么跑清扫**：`crawler-worker` 每个 tick 结束前跑一次（`worker-tick.ts`：列表 → 预检队列 → 清扫 → 可选的详情补采）。tick 间隔是 `CRAWLER_WORKER_INTERVAL_MS`，默认 15 分钟；worker 正在停止时跳过。没关闭任何招标就不写日志；关闭了或失败了会写一条 `crawler_lifecycle_sweep`，失败还会上报 Sentry，**但不会让这个 tick 失败**。
- **一次性命令** `npm run bids:lifecycle:sweep`：首次补扫、没有 worker 的环境，或者想先看会关多少：

  ```bash
  npm run bids:lifecycle:sweep -- --dry-run     # 只统计，不写库
  npm run bids:lifecycle:sweep                  # 真的关闭
  npm run --silent bids:lifecycle:sweep -- --json   # 结果以 JSON 输出
  ```

  输出 `scanned`（检查了多少 open 招标）、`closed`、`unparseable`（截止日非空但读不懂，保持 open）和按 `issuer_type` 分的关闭数。只处理 open 的招标，所以重复跑是安全的，第二遍 `closed: 0`。

  目标库的选法与 `data:integrity`、`bids:purge-demo` 完全一样（第 2 节）：一打开就把 `Target:` 打印到 stderr；SQLite 文件不存在或是目录时退出码 `2`，什么也不建。**它从不迁移**：库没有迁移到清扫需要的结构（空文件、旧库）时退出码 `2`，提示先跑 `npm run db:migrate`（MySQL：`npm run db:mysql:migrate`），库一个字节不动。**`--dry-run` 在两种数据库上都不写**：SQLite 文件以只读方式打开，MySQL 上只发 `SELECT`、不开事务。该脚本没有 `--help`，只认 `--dry-run` 和 `--json`，其他参数一律打印用法、退出码 `1`，不会把预演变成真跑。
- **引擎要求**：MySQL 上的清扫用 `SELECT … FOR UPDATE SKIP LOCKED`，要求 **MySQL ≥ 8.0.1**（5.7 不支持这条语法）。导入正持有的招标会被跳过，留给下一轮清扫，不会阻塞也不会死锁。SQLite 上用 `BEGIN IMMEDIATE` 先拿写锁。每页 500 条一个事务，页内的待关闭招标在写锁下重读并再判断一次，所以刚被导入刷新的招标不会按过期的截止日关掉。
- **原因记在哪**：被截止日关闭的招标，`raw_payload.lifecycle` 里记 `closed_reason = "deadline_passed"`、`closed_observed_at` 和当时的 `deadline` 文本。**只有 `raw_payload` 是 JSON 对象时才记**；不是（NULL、纯文本）的，招标照样关闭，但 payload 原样不动、没有原因，导入和清扫都是这样，`data:integrity --compare` 会把它们报成 `closed_without_reason` 警告。

## 6. 演示/种子数据清理：`bids:purge-demo`

**清的是哪些招标。** id 前缀（第一个 `:` 之前的部分）**不是**任何 `data_sources.id`，并且满足二者之一：

- demo-readiness：id 以 `_demo_readiness` 结尾，且 `source_bid_id` 以 `demo:` 开头（`npm run demo:prepare` 生成，每州一条；`raw_payload.demoReadiness = true`）；
- mock 种子：id 全是数字，且 `source_bid_id` 是 `mock:<id>`（`npm run db:seed`）。

规则只认这两个标记，没命中的未登记招标一概不动。本地 `winbids` 数据里恰好是 50 + 6 条。命中超过 500 条时脚本直接报错（预演也一样），因为那说明数据或规则不对。实施计划里的覆盖核对结论是：50 个州都有登记源产生的真实州级 open 招标，清理不会让任何一个州的覆盖消失；仅有的只在演示数据里出现的州码是 `US`，因为 SAM.gov 还没有 API key。

**命令**

```bash
npm run bids:purge-demo                                    # 预演：打印将删除什么，不写库
npm run --silent bids:purge-demo -- --json                 # 预演，JSON 输出
npm run bids:purge-demo -- --apply --backup-file <备份文件>   # 真删，一个事务
```

- 默认是预演。`--apply` **必须**同时给 `--backup-file`，指向一个**已存在、非空的备份文件**：缺参数、文件不存在、为空、不是文件、或者就是 SQLite 数据库本身（数据库不是它自己的备份），都是退出码 `2`，什么都不写。脚本只检查文件在不在、有没有内容，不检查内容；备份是不是新的、能不能恢复，要自己负责。
- 删除的范围：一切沿 `migrate.ts` 里的 `REFERENCES` 能走到 `bids` 的表（附件、收藏、意向及工作区条目与评论、响应包与导出、产物、报价请求、截止日提醒、中标结果……），子表在前、`bids` 最后。`knowledge_items` 保留，只把指向被删招标或意向的链接置为 `NULL`。事务里最后做引用检查：SQLite 用 `PRAGMA foreign_key_check`，MySQL 逐条关系查孤儿，发现这次清理留下的悬空引用就整个回滚（退出码 `1`）。
- **有意不动、留作历史的**：`notification_outbox.matched_bid_ids`、`search_alert_digest_runs.matched_bid_ids_json`、`event_log.target_id` / `metadata_json`、`ai_call_logs.metadata_json`、`crawler_logs.metadata`。`storage_path` 指向的文件（产物库、响应包导出、已归档附件）也不删。
- 预演输出会逐表列出将删的行数、将被置 `NULL` 的链接数，是这次 `--apply` 会做的全部写入。再跑一遍 `--apply` 会报 "nothing to purge"，不写任何东西。

**MySQL 上必须有维护窗口：先停 web 应用和所有 worker。** MySQL 没有外键（`mysql.ts` 剥掉了所有 `REFERENCES`），清理期间 web 应用可以给一条演示招标新插一行子表数据（收藏、意向、工作区编辑），而这一行是在清理事务拍下快照之后提交的，引用检查看不到，提交后就成了孤儿。**脚本能强制的**只有三件：`--apply` 必须带 `--backup-file`；目标库（密码打码）在 stderr 上先于任何写入打印；默认只预演。**脚本强制不了的**是"应用和 worker 已经停了"，这要你自己保证。SQLite 不需要这个窗口：脚本用 `BEGIN IMMEDIATE` 一开始就拿写锁、整个事务期间持有，加上应用开启的外键，不会有行溜进来；拿不到锁会等最多 5 秒（`busy_timeout`），仍然拿不到就报错退出，没有写入。

**不要把演示数据再造出来。** 清理之后：

> **绝对不要对 `winbids` 或生产库运行 `npm run demo:prepare` 或 `npm run db:mysql:import-sqlite`**，二者都会重新造出演示招标。`npm run db:seed` 也一样。

- `demo:prepare` 往当前目标库写入 50 条 demo-readiness 招标（目标是 MySQL 就写进 MySQL；SQLite 下它还会先 `seedDatabase`，种入 mock 招标）；
- `db:seed` 往本地 SQLite 里写 mock 招标；
- `db:mysql:import-sqlite` 把一个本地 SQLite 文件整个拷进 MySQL，文件里还留着的演示/mock 行会一起进去。

万一发生了，`data:integrity` 的 `demoLike` 会非 0，这就是发现再污染的办法。

## 7. 两条数据迁移：FIPS 漂移与 NY 转包行

都在 `runMigrations`（SQLite，`npm run db:migrate`）和 `mysqlDataMigrationStatements()`（MySQL，`npm run db:mysql:migrate`）里，幂等，每次迁移都会跑，不需要单独的命令。

**FIPS 漂移校正（Aurora）。** 旧的本地招标存成 `state` 而被藏起来，上一轮的回填（P0）对其中一类特意没动：FIPS 与登记源不一致的行。现在这类行——州码精确一致、层级一致、两边 FIPS 都非空但不相等——会被改成登记源的层级和 FIPS，旧 FIPS 存进 `raw_payload.legacy_fips_code`（`raw_payload` 是 JSON 对象时；其他 payload 原样不动）。预期的结果是 `bidnet_co_city_aurora` 那 11 条已关闭招标变成 `city`、FIPS `0804000`。比对里表现为 `issuer_type state→city` 加 `fips_code changed`。州码大小写不一致的行仍然保持原样，下次重抓时自愈。

**NY 转包行重键。** NY Contract Reporter 的转包卡片，爬虫改好之前把公司名粘在了 CR# 后面，id 是 `ny_contract_reporter:<CR#> Company: <公司>`、发布方是 "Unknown state agency"、转包标记句挂在标题末尾。爬虫已经修好（认 `Company:` 标签、把标记句剥出标题、新 id 干净）；迁移把库里已有的遗留行也改过来：

- 没有干净孪生行、也没有任何子表数据的：`id` 和 `dedupe_key` 变成 `ny_contract_reporter:<CR#>`，`source_bid_id` 变成 `<CR#>`；发布方为空或以 "Unknown" 开头时换成公司名；标题剥掉末尾的 "This is a subcontracting opportunity"；与旧标题相同的描述被清空；`raw_payload` 里记 `contractor_company`，标题带标记时记 `subcontracting: true`，并移除当时按占位发布方算出来的 `data_quality` 结论，让这一行按现在的字段重新判断；
- 已经有干净孪生行、自己又没有子表数据的：删除遗留行，孪生行不动；
- **有子表数据的，或者重键被一条无关的行挡住的（唯一键冲突）：不动**。SQLite 有外键，改 id 会连带级联掉用户数据；MySQL 没有外键，改了就是孤儿。这些行留下来，计入 `malformedNyIds`，要逐条人工处理。

子表指"任何引用 `bids(id)` 的行"：十六张 `bid_id` 子表加 `knowledge_items.source_bid_id`，清单在 `frontend/src/server/db/bid-child-references.ts`（演示清理删除的表用同一份引用关系，二者由测试保持一致）。

## 8. BidNet 详情锁：为什么本地正文补不全

BidNet 的匿名访客在详情页上看到的是 "Description Locked — Registered members only"：发标机构、正文、招标文件、采购联系人都只给注册会员。公开部分只有编号、标题、地点、发布日和截止时间（2026-09-24 对 Denver 详情页实测，见[县/市/镇招标数据补全：设计](../superpowers/specs/2026-09-24-county-data-completeness-design.md)第 2 节）。

**所以通过 BidNet 抓取的县/市/镇招标，正文没法补全，除非用供应商账号登录——而项目从不这样做**：不注册账号、不登录、不绕 WAF、不解验证码。库里这些字段本来就是空的，不是抓取失败。

- 抓取时会把"哪些字段被锁"记进每条招标的 `raw_payload.detail_access`；招标详情页用提示条告诉用户（见生命周期运维第 3 节）；
- 在报告里，这类招标计入 `detailLockedAtSource`，不计入 `bodyMissing`。看正文缺口时，只有 `bodyMissing` 是可以补的；
- 在验收里，它们是"公开受限"：写进缺口清单，注明上游受限，不能记成"正文真实可用"，也不要为了让数字好看而填占位文字。

## 9. 排查速查

| 现象 | 可能原因 | 怎么办 |
| --- | --- | --- |
| 比对 `removed_unexplained` | 有招标被删，且没被放行：计划内的重键/清理漏了 `--allow-removed`，或者真的丢了 | 先看列出的 id 是不是计划内改动；是就放行（锚定的正则），不是就从备份恢复并排查 |
| 比对 `visibility_regression` | 改动把本来搜得到的 open 招标藏了 | 看这些 id 现在的 `hiddenReasons`（报告里同一指标），回退对应的改动 |
| `identityMismatch` 上升 | 招标与登记源的层级、州或 FIPS 对不上；或者源配置被改了 | 按 id 前缀找到登记源，对比 `issuer_type`、`state_code`、`fips_code` |
| `demoLike` 非 0 | 有人跑了 `demo:prepare`、`db:seed` 或 `db:mysql:import-sqlite` | 查是谁、在哪个库；再预演、`--apply` 清理 |
| `malformedNyIds` 非 0 | NY 重键跳过了有子表数据或新 id 冲突的行 | 逐条处理：先看它们的子表数据，再决定合并还是保留 |
| `expiredOpen` 清扫后仍非 0 | 清扫没在跑或失败了；或者 MySQL 上这些招标当时正被一次导入持有，被本轮清扫跳过（下一轮会关） | 看 worker 日志里的 `crawler_lifecycle_sweep`；MySQL 先确认 ≥ 8.0.1；再手动跑一次 `bids:lifecycle:sweep` |
| 比对 `closed_without_reason` 警告 | 招标被不记原因的路径关闭：迁移把 `is_active = 0` 的 open 行改成 closed，或者导入、清扫遇到 `raw_payload` 不是 JSON 对象的行 | 逐条确认是预期内的关闭 |
| `bodyMissing` 很大，`detailLockedAtSource` 很小 | 正文真的没抓到 | 走正文补采/详情补全，见[详情补全](./detail-enrichment.md)、[正文补采](./detail-backfill.md) |
