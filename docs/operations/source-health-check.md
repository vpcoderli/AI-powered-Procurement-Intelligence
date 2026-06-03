# Source Health Check Runbook

## Purpose

`source:health:check` is an operator-run live availability probe for the 50 state source registry. It complements deterministic local checks such as `risk:check`; it does not replace them, because public government portals can legitimately return 403, timeout, bot-check, or CAPTCHA responses from local networks.

## Commands

Run all 50 state sources:

```bash
cd frontend
npm run source:health:check -- --all --timeout-ms 5000 --report-only
```

Run one state or source id:

```bash
cd frontend
npm run source:health:check -- --source CA --timeout-ms 5000 --report-only
npm run source:health:check -- --source wy_state_procurement --timeout-ms 5000 --report-only
```

Persist the latest snapshot for Admin Data Sources:

```bash
cd frontend
npm run source:health:check -- --all --timeout-ms 5000 --report-only --persist
```

## Interpreting Results

- `PASS`: the source returned a successful HTTP response through HEAD or GET.
- `HTTP 403`: the portal exists but blocks this local probe or requires browser/vendor context. Treat as live-ops risk, not a deterministic data failure.
- `fetch_error: This operation was aborted`: timeout under the configured limit. Recheck later or with a longer timeout before changing source metadata.
- `HTTP 404`: registry URL is likely stale. Verify the current official or approved fallback URL and update both frontend and crawler registries.
- `fetch failed`: network/TLS/DNS/server failure. Re-run from another network and record the outcome before marking a source blocked.

Each result also includes an operator classification:

- `recommendedAction=update_registry_url`, `operationalSeverity=critical`: stale or removed registry URL, usually HTTP 404/410.
- `recommendedAction=browser_or_access_review`, `operationalSeverity=warning`: blocked, rate-limited, auth/browser-required, or other access-sensitive portal response.
- `recommendedAction=retry_or_increase_timeout`, `operationalSeverity=warning`: local timeout or aborted fetch.
- `recommendedAction=network_or_tls_review`, `operationalSeverity=warning`: DNS, TLS, or network fetch failure.
- `recommendedAction=add_base_url`, `operationalSeverity=critical`: registry metadata is missing a base URL.
- `recommendedAction=none`, `operationalSeverity=none`: healthy result.

Admin Data Sources surfaces the same action and severity beside the latest live health result, so operators can triage without opening raw JSON.

## Current Baseline

Last local report-only run on 2026-06-02:

- Command: `npm run source:health:check -- --all --timeout-ms 5000 --report-only`
- Result: 20/50 healthy, 30 unhealthy, 0 skipped.
- Fixed hard 404 rows:
  - OH: `https://www.bidnetdirect.com/ohio/solicitations/open-bids`
  - WY: `https://ai.wyo.gov/divisions/general-services/purchasing/bid-opportunities`
- Remaining unhealthy rows are 403, timeout/abort, or fetch failure and now include action/severity labels in CLI and Admin UI.

## Required Follow-Up

1. Re-run all-source health weekly and after source registry changes.
2. For repeated 404s, update registry URLs immediately and add a note to implementation status.
3. For repeated 403/timeouts, decide whether to keep source as beta/fallback, switch to an approved aggregator fallback, or mark as blocked/manual review.
4. Do not store or expose raw external attachment URLs directly to users; use local attachment download APIs or explicit unavailable states.
5. Keep `npm run risk:check` green before treating source data as usable in product flows.
