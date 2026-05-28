# Stripe Sandbox E2E Verification Runbook

本 runbook 用于在 Stripe test mode 下验证完整订阅链路：本地测试账户创建、Stripe Checkout、Stripe CLI webhook 转发、本地订阅和套餐同步、Customer Portal 创建，以及测试订阅清理。

## 1. Stripe Dashboard Test Mode Setup

在 Stripe Dashboard 右上角打开 **Test mode**，然后准备：

1. 创建 Pro 产品，添加 monthly recurring price，复制 price id。
2. 创建 Business 产品，添加 monthly recurring price，复制 price id。
3. 打开 Billing customer portal 配置，至少允许客户查看订阅和取消订阅。
4. 确认使用的是 test mode secret key，格式应为 `sk_test_...`。

不要把 test key 或 webhook secret 提交到仓库。

## 2. Local Environment

在 `frontend/.env.local` 或当前 shell session 中配置占位符对应的真实 test mode 值：

```bash
BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
STRIPE_PRICE_PRO_MONTHLY=price_REPLACE_ME
STRIPE_PRICE_BUSINESS_MONTHLY=price_REPLACE_ME
```

本地数据库默认使用 `frontend/data/apsi.sqlite`。dev server 和 verifier 都应在 `frontend` 目录运行，确保共享同一个 SQLite 数据库。

## 3. Start The Local App

```bash
cd frontend
npm run db:migrate
npm run dev
```

确认本地站点可访问：

```bash
open http://localhost:3000
```

## 4. Forward Stripe Webhooks

在另一个 terminal 中运行：

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
```

把 Stripe CLI 输出的 `whsec_...` 写入 `STRIPE_WEBHOOK_SECRET`。如果重新启动 `stripe listen`，通常需要同步更新这个 secret。

## 5. Run The Sandbox Verifier

Pro 默认验证：

```bash
cd frontend
npm run billing:stripe:sandbox -- --tier=pro
```

Business 验证：

```bash
npm run billing:stripe:sandbox -- --tier=business
```

可选参数：

```bash
npm run billing:stripe:sandbox -- --tier=pro --origin=http://localhost:3000 --timeout-ms=300000 --skip-cancel
```

脚本会输出 Stripe Checkout URL。打开该 URL 后使用 Stripe 测试卡：

```text
4242 4242 4242 4242
```

到期日填写任意未来日期，CVC 填任意三位数字。完成支付后回到 terminal 按 Enter，verifier 会继续轮询本地 API/DB。

## 6. Success Criteria

一次成功验证必须同时满足：

1. `/api/account/subscription/checkout` 返回 Stripe Checkout URL。
2. Stripe CLI 收到并转发 `checkout.session.completed` 或相关订阅事件。
3. 本地 `/api/account/subscription` 变为 `source=billing_provider`。
4. 订阅状态为 `active`、`trialing` 或 `past_due`。
5. 用户 `account_tier` 和 active owner organization `account_tier` 都更新为目标套餐。
6. `/api/account/billing/portal` 返回 Stripe Billing Portal URL。
7. 未传 `--skip-cancel` 时，`/api/account/subscription/cancel` 可安排 Stripe 测试订阅取消，并在本地显示 `cancelAtPeriodEnd=true` 或 `status=canceled`。

## 7. Troubleshooting

| Symptom | Check |
|---|---|
| `BILLING_PROVIDER must be stripe` | 当前 shell 或 `.env.local` 没有启用 Stripe provider。 |
| `STRIPE_SECRET_KEY must be a Stripe test mode secret key` | 使用了 live key 或非 `sk_test_...` key。不要在 sandbox 使用生产 key。 |
| Checkout API 返回 500 | 检查 price id 是否来自 test mode，Billing Portal 是否已配置，dev server 是否读取了最新 env。 |
| verifier 一直等待 webhook | 确认 `stripe listen --forward-to localhost:3000/api/billing/webhook` 正在运行，且 `STRIPE_WEBHOOK_SECRET` 是当前 CLI session 输出的 `whsec_...`。 |
| 订阅已在 Stripe 完成但本地 tier 未变 | 查看 dev server 日志中的 `/api/billing/webhook` 错误；常见原因是 webhook secret 不匹配或 dev server 与 verifier 使用了不同 SQLite 工作目录。 |
| Portal URL 创建失败 | 确认 checkout webhook 已写入 `providerCustomerId`，并在 Stripe test mode 中配置了 Billing Portal。 |

## 8. Cleanup

默认 verifier 会调用本地取消订阅 API，并让 Stripe 将测试订阅设为 period end cancel。若使用了 `--skip-cancel`，请手动清理：

1. 在 Stripe Dashboard test mode 中搜索脚本输出的测试邮箱。
2. 打开 customer，取消 active test subscription。
3. 删除不再需要的 test customer。
4. 如需重置本地数据，可删除 `frontend/data/apsi.sqlite*` 后重新运行 `npm run db:migrate`。
