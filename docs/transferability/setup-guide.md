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
RISK_CHECK_SEED_DATA=true npm run risk:check   # on the seeded local database: exits 0, report headed "Risk checklist INCOMPLETE"
```

This is a developer's local run on seed data. The bootstrap above seeds `frontend/data/apsi.sqlite` with demo bids in five states, so 50-state coverage cannot be verified from it, and a plain `npm run risk:check` fails it (CI meets the same wall). `RISK_CHECK_SEED_DATA=true` is what CI sets on its seeded throwaway database: `state-coverage` and the missing-bid part of `state-data-quality-gate` are then reported `NOT RUN`, never `PASS`, the report is headed `Risk checklist INCOMPLETE (NOT RUN: state-coverage, state-data-quality-gate)` and the command exits 0. That is the passing result of this run: exit 0, exactly those two checks `NOT RUN`, every other line `PASS`; a `FAIL` line, or a different check set aside, is a problem. It is never release evidence. On a database that holds the real data (a copy of the business database), run `env -u RISK_CHECK_SEED_DATA npm run risk:check` instead and require exit 0 **and** a report headed `Risk checklist PASS`.

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
