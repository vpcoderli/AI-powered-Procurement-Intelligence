# 持久历史正文补采

补采使用 `bids.raw_payload.enrichment.outcome` 保存每条记录的实际尝试和下次重试时间，不需要新表或迁移。普通配置运行和手动 state / SAM 运行也读取持久历史：复用已有正文、保留原验证时间，并按最早实际尝试或首次观察时间轮换请求预算。

## 手动运行一轮

在 `frontend/` 中执行：

```sh
npx tsx scripts/run-detail-backfill-once.ts il_bidbuy sam_gov
```

不传源 ID 时处理所有已启用、已通过治理且有合格待补正文记录的源。这里的 ID 是 `data_sources.id`。手动补采可包括 `cadence=manual` 的源；仍执行审批、法律审核、源租约和取消检查。配置来源、Python 和私有 extractor 的环境与现有 crawler worker 相同。

## 现有 worker 的可控自动补采

默认关闭。给启动现有 worker 的 Node 进程设置：

```sh
CRAWLER_DETAIL_BACKFILL_ENABLED=true
CRAWLER_DETAIL_BACKFILL_MAX_SOURCES_PER_TICK=10
```

仍通过现有 `npm run worker:crawler` / `npm run crawler:once` 入口运行；没有新增定时任务。worker 的顺序为正常列表→预检队列→可选正文补采，补采使用两步之后的剩余额度；独立 `crawler:once` 保留列表→可选补采顺序。补采覆盖已离开当前列表或发布日期窗口的旧记录。自动模式排除 `cadence=manual`，state 源还须显式设置 `fetch_config.enrichment.enabled=true`。源数量上限默认 10，可设 1–100；暂停或无预算的源不占用这个上限。

列表、预检和历史补采共享同一个平台预算、暂停注册器、平台间隔追踪器。先前步骤已消耗的请求额度不能再用于补采；有平台预算的源，其补采详情上限会压到本次预留额度。每次真实重试单独结算报告成本；未知成本保留预留量，不能当零。账本采用采集结果报告的请求数，不代表未报告的其他 HTTP 工作的精确总数。每条详情仍遵守原来的请求起始间隔和超时，429 会停止本源后续正文请求，源租约丢失会终止子进程并阻止导入。

源内和源间都以持久的最早实际尝试时间排序，未尝试记录使用首次观察时间。冷却中的记录暂不参与自动调度。核心不合法或与当前注册源身份不符的历史记录不会占详情请求预算，应通过质量报告和明确的数据修复处理。

## 记录与调度边界

- `outcome.status`：`success`、`failure`、`deferred`、`budget`、`disabled`、`not_configured`、`restricted`、`reused`、`not_needed`。
- `reason` 保存预算用尽、冷却、限流、配置缺失或公开访问受限等原因；`attempted_at` / `attempt_count` 只在真实详情请求时推进，观察到预算或冷却不会伪造新尝试。
- 暂时失败、限流或配置缺失冷却 1 小时；公开登录/403 限制冷却 24 小时。实际成功取得选中正文后，当前列表的详情复查冷却 7 天。历史补采只处理缺失正文，不重复请求已具备合格正文的历史记录。
- `valid_body` 判断当前有效正文；`verified_at` 只在新抓取的合格正文确实被选入记录时推进。复用旧正文、仅补联系人/分类、未尝试记录均不会刷新正文验证时间。短而具体的采购正文有效；标题回显、接口 URL、登录/错误页、导航和占位值无效。
- `metadata.enrichment.enriched` 统计字段写入；`valid_bodies` 单独统计本轮真正抓得并选中的合格正文。字段更新不能冒充正文取得成功。
- 历史运行强制 `metadata.mode=detail_backfill`、`pagination.complete=false`，不能把未出现的机会关闭，也不更新列表健康 `last_success_at`，不触发新列表的提醒匹配或通知。所有持久化均经过父进程共享质量门禁；隔离无效候选不覆盖现有合格记录。

历史读取按精确 canonical ID 命名空间进行，先应用共享核心及源身份校验；只有匹配的 ID、标题和详情 URL 能复用历史详情。历史候选保留原生命周期，包括 closed / awarded。读取没有 newest-first 截断，避免再次形成永远无法轮到的尾部队列；大型来源的全量历史读取需要相应进程内存。

本次实现与验证仅使用离线 fixture、模拟网络和临时数据库；没有执行以上命令接触生产数据库或门户。
