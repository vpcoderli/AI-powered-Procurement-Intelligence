# Setup Guide

This guide gets a new developer from a fresh checkout to a running local WinBids / APSI instance.

## Prerequisites

- Node.js compatible with the Next.js version in `frontend/package.json`.
- npm.
- Python 3 for crawler tests and local crawler utilities.
- `rg` for repository search.
- Optional: Stripe CLI for billing sandbox webhook forwarding.

Check tool availability:

```bash
node --version
npm --version
python3 --version
rg --version
```

## Local Bootstrap

From the repository root:

```bash
cd frontend
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open the local application at:

```text
http://localhost:3000
```

Local data is expected to live under `frontend/data/`. The default SQLite database path is `frontend/data/apsi.sqlite` unless `DATABASE_PATH` is set.

## Local Verification

Run this before transferring work to another developer:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run db:migrate
npm run risk:check
```

Crawler-specific verification:

```bash
PYTHONPATH=crawler python3 -m pytest crawler/tests
```

If crawler tests are not available in the local environment, record the missing dependency and run at least:

```bash
cd frontend
npm run crawler:once
```

## Optional Local Workers

Notification worker, one pass:

```bash
cd frontend
NOTIFICATION_WORKER_RUN_ONCE=1 npm run worker:notifications
```

Notification worker, preflight:

```bash
cd frontend
npm run worker:notifications:check
```

Crawler worker, one pass:

```bash
cd frontend
npm run crawler:once
```

## Local vs Production

Local is allowed to use file delivery, console delivery, fixture data, test Stripe keys, and a disposable SQLite file. Production must use managed secrets, production-safe notification delivery, durable storage, backups, and monitored worker processes.

Never use production secrets in local `.env.local`.
