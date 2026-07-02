# P0/P1 集成与全量测试报告（2026-07-02）

## 结果总览

| 检查项 | 结果 |
|---|---|
| 前端 vitest（280 文件 / 12 分片） | **1569/1569 通过** |
| 爬虫 pytest | **209/209 通过** |
| ESLint（--max-warnings=0） | **0 错误 0 警告** |
| risk:check（数据源治理/URL 校验） | **PASS** |
| secrets-scan（897 文件） | **PASS（0 findings）** |
| npm audit（--omit=dev, moderate） | **0 漏洞** |
| tsc --noEmit | src 源码 0 错误；.test.ts 内 mock 类型债 315 处（基线即有 305，见跟进项） |
| next build | 沙箱 arm64 下 swc 崩溃无法执行，需在 CI / 本机验证（见跟进项） |

## 合并内容

`main` 已从旧位置快进 282 个提交：`codex/apsi-docs-reorganization` 基线（250）+ 14 个 P0/P1 分支的按序 no-ff 合并（28）+ 4 个集成修复提交。合并顺序 p0-1→p0-8、p1-1→p1-6（p1-4 取 `-impl` 分支）。7 处冲突均为叠加型，按并集解决；`package.json` 的 `risk:check` 采用 p0-7 加强版（含 secrets:scan）。

## 集成修复（4 个提交）

1. **@sentry/nextjs ^9 → ^10.63.0**：v9 的 peer 依赖不含 Next 16，`npm install` 直接失败（P0-3 交付时未安装验证）；同时重新生成 package-lock。
2. **分支自带测试失败修复（15 处）**：
   - `csrf.ts`：仅在未配置显式允许列表时信任请求自身 origin（修复 P1-6 同源放行缺陷，保留显式列表的 fail-closed 语义）
   - `s3-object-storage.ts`：凭据检查前移至 client() 获取处，注入 client 也不可绕过（P0-4 规格）
   - `confidence.ts`：±Infinity 钳制到边界而非归零（P1-4 规格）
   - `intents/page.test.ts`：断言更新为 P1-5 迁移后的 i18n key
   - 其余 9 处为环境问题（.bin 链接、空 SQLite 库），非代码缺陷
3. **lint 清零 + secrets-scan 窄豁免**：4 处 prefer-const、1 处未用 import；扫描器为已文档化的占位符 runbook 和 README 声明的本地开发凭据（admin-reset.ts）加文件级豁免。
4. **跨分支类型错误清零（src）**：P1-2 给 `dataSources` 加的 12 个合规列补进 `risk/checklist.ts` 与 `state-data-quality.ts` 的 MySQL 行映射（否则 MySQL 运行时字段丢失）；`generateIntentBrief` 返回类型收紧（`aiRun` 非可选）；`mysql-backup.ts` env 类型对齐。

## 失败分类结论

19 个初始失败：**0 个由合并引入**。4 个基线预先存在（`bids/service.test.ts`，因本地 SQLite 空库，`npm run db:migrate` 后通过），15 个为分支交付时自带（分支从未跑过测试）。

## 跟进项（按优先级）

1. **在你的 Mac 上执行 `git push origin --all`**——沙箱无 GitHub 凭据，14 个分支 + 新 main 仍只在本机。
2. **本机 `cd frontend && npm install`**——新增依赖（@aws-sdk/client-s3、@aws-sdk/client-sesv2、@sendgrid/mail、@sentry/nextjs@10）尚未装入你的 node_modules。
3. **本机跑一次 `npm run build`**——沙箱无法执行 next build；push 后 CI（p0-1 的 ci.yml）也会跑。
4. **本机 `npm run db:migrate`**——你的 `frontend/data/apsi.sqlite` 是空库，4 个 bids 测试在本机会因此失败。
5. 测试文件 mock 类型债 315 处（基线 305 + 新分支 10）——建议单开任务清理，或在 tsconfig 排除 `*.test.ts` 后以 `tsc --noEmit` 进 CI。
6. 验证无误后删除 14 个 `codex/p0-*`/`codex/p1-*` 分支与 `.integration-backup-20260702/` 目录。
