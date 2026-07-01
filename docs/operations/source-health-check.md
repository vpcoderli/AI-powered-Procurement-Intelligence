# Source Health Check Runbook

## Purpose

`source:health:check` is an operator-run live availability probe for the 50 state source registry. It complements deterministic local checks such as `risk:check`; it does not replace them, because public government portals can legitimately return 403, timeout, bot-check, or CAPTCHA responses from local networks.

## Commands

Production-like operations alias, intended for a daily operator run or an external scheduler wrapper:

```bash
cd frontend
npm run source:health:ops
```

`source:health:scheduled` is a readable alias for the same command:

```bash
cd frontend
npm run source:health:scheduled
```

Both aliases run fixed, non-credentialed parameters:

```bash
tsx scripts/source-health-check.ts --all --timeout-ms 10000 --inspect-body --write-snapshot --report-only
```

They intentionally do not create a real cloud schedule and do not require public portals to be reachable in unit tests.

Run all 50 state sources:

```bash
cd frontend
npm run source:health:check -- --all --timeout-ms 5000 --report-only
```

Run a release-grade probe that also checks successful pages for empty bodies, login pages, CAPTCHA, or bot-check content:

```bash
cd frontend
npm run source:health:check -- --all --timeout-ms 10000 --report-only --persist --inspect-body
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
npm run source:health:check -- --all --timeout-ms 5000 --report-only --write-snapshot
```

When `DATABASE_URL` or `MYSQL_DATABASE_URL` points to MySQL, `--persist` writes `source_health_snapshots` to MySQL so the running Admin UI reads the same live-health snapshot. Without a MySQL URL, it writes to the local SQLite database.

Export the latest persisted source health snapshot without probing public portals:

```bash
cd frontend
npm run source:health:report -- --format=markdown
npm run source:health:report -- --format=json --output reports/source-health.json
npm run source:health:report -- --format=csv --output reports/source-health.csv
```

`source:health:report` reads the current DB runtime only. When MySQL is configured through `DATABASE_URL` or `MYSQL_DATABASE_URL`, it reads MySQL; otherwise it reads local SQLite. It does not call the live source probe, fetch external URLs, or refresh snapshots.

The report includes:

- Snapshot summary counts.
- Unhealthy classification counts.
- Per-source owner, disposition, and next review date when the Admin Data Sources triage fields exist.
- A safe source URL for operator follow-up, with username, password, query string, and fragment stripped.
- Trend sample size, current status streak, healthy percentage, and last unhealthy timestamp from recent persisted snapshots.
- Recommended action and operational severity for each source.

The export intentionally omits raw portal URLs with query strings/fragments, external attachment URL secrets, raw evidence snippets, and long HTML bodies. Safe source URLs are normalized to HTTP(S), with username, password, query string, and fragment removed before JSON, CSV, or Markdown output is written. Credential-like assignments such as `password=...`, `token=...`, `secret=...`, API keys, sessions, and bearer tokens are redacted.

Generate a release/operations evidence bundle from the latest persisted snapshot:

```bash
cd frontend
npm run source:health:evidence -- --allow-blocked
npm run source:health:evidence -- --format=json --output reports/source-health-evidence.json
```

`source:health:evidence` does not call public portals. It reads the latest persisted snapshot from the current shell runtime, checks that the evidence covers 50 states, marks snapshots stale after 72 hours by default, includes safe source URLs for high-priority follow-up rows, and blocks release handoff when unhealthy sources are missing owner, disposition, or next-review date. Use `--allow-blocked` for daily/weekly evidence generation; omit it for release signoff.

Useful options:

```bash
npm run source:health:evidence -- --stale-after-hours=48
npm run source:health:evidence -- --expected-state-count=50
```

The consolidated launch handoff command references this evidence path:

```bash
npm run ops:launch-handoff -- --allow-blocked
```

Set either `SOURCE_HEALTH_OPS_EVIDENCE_URL` or `SOURCE_HEALTH_OPS_EVIDENCE_FILE` after saving the evidence bundle, and set either `SOURCE_HEALTH_ACCESS_REVIEW_URL` or `SOURCE_HEALTH_ACCESS_REVIEW_FILE` after generating the access-review packet. Do not store portal credentials or raw page bodies in those evidence fields. When `SOURCE_HEALTH_OPS_EVIDENCE_FILE` is set, `ops:launch-handoff` reads the JSON file and requires the bundle to be ready (`ok=true`, full state coverage, fresh snapshot, zero critical unhealthy sources, and no missing owner/disposition/next-review blockers) rather than accepting a path-only marker. When `SOURCE_HEALTH_ACCESS_REVIEW_FILE` is set, `ops:launch-handoff` also reads the JSON packet and requires enough review entries for the unhealthy source count, with `reviewMode` and `requiredEvidence` on each entry. Local `ops-evidence/` files are ignored by Git and should be regenerated or attached to the external release record as needed.

Bulk assign source-health triage fields when the evidence bundle is blocked only because unhealthy sources are missing owner, disposition, or next-review date:

```bash
cd frontend
npm run source:health:triage -- --owner=source-ops@example.com
npm run source:health:triage -- --owner=source-ops@example.com --apply
```

The command defaults to dry-run. It only updates unhealthy sources that are missing one or more triage fields. Use `--all-unhealthy` only when the operator intentionally wants to overwrite existing unhealthy-source triage. The default next-review date is 7 days from the run time:

```bash
npm run source:health:triage -- --owner=source-ops@example.com --next-review-days=3
```

Default disposition mapping:

| Classification/action | Disposition |
|---|---|
| `timeout` / `retry_or_increase_timeout` | `retry_with_longer_timeout` |
| `login_required` | `vendor_account_review` |
| `bot_check` / `forbidden` | `browser_access_review` |
| `empty_or_placeholder` | `parser_or_access_review` |
| `tls_or_network_error` / `network_or_tls_review` | `network_or_tls_review` |
| `http_error` | `portal_status_review` |
| `update_registry_url` / `add_base_url` | `registry_url_review` |

Generate the browser/vendor/production-network access review packet for unhealthy sources:

```bash
cd frontend
npm run source:health:access-review
npm run source:health:access-review -- --format=json --output=../ops-evidence/source-health/source-health-access-review.json
npm run source:health:access-review -- --mode=browser_access,vendor_account --format=csv --output=../ops-evidence/source-health/source-health-access-review.csv
```

`source:health:access-review` reads the latest persisted source-health snapshot and triage fields from the current DB runtime. It does not call public portals, open a browser, or store portal credentials. It groups unhealthy sources into `browser_access`, `vendor_account`, `long_timeout_retry`, `network_tls`, `registry_url`, `portal_status`, `parser_or_access`, or `manual_review`, includes the sanitized source URL, and lists the evidence required for each next operator step.

Local launch handoff example:

```bash
SOURCE_HEALTH_OWNER=source-ops@example.com \
SOURCE_HEALTH_OPS_EVIDENCE_FILE=../ops-evidence/source-health/source-health-evidence.json \
SOURCE_HEALTH_ACCESS_REVIEW_FILE=../ops-evidence/source-health/source-health-access-review.json \
npm run ops:launch-handoff -- --allow-blocked
```

## Interpreting Results

- `PASS`: the source returned a successful HTTP response through HEAD or GET. When `--inspect-body` is enabled, a successful GET must also return non-empty content that does not look like a login, CAPTCHA, or bot-check page.
- `HTTP 403`: the portal exists but blocks this local probe or requires browser/vendor context. Treat as live-ops risk, not a deterministic data failure.
- `empty_body`: the portal returned HTTP success but no useful body while `--inspect-body` was enabled. Treat as an access/parser risk and recheck from another network before changing source metadata.
- `access_challenge`: the portal returned HTTP success but the body looks like login, CAPTCHA, bot-check, or browser verification content. Treat as an operations access review item.
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

## Operator Actions

| Finding | Meaning | First action | Escalate when |
|---|---|---|---|
| `HTTP 403` / `classification=forbidden` | Portal blocks the probe, rate-limits, or requires browser/vendor context. | Re-run once from the production-like operator network; check whether the portal opens in a normal browser without credentials. | It repeats for 2 daily runs or affects a launch-critical state; ask Source Ops to approve a browser/vendor access path or fallback source. |
| `classification=timeout` / aborted fetch | Probe exceeded `--timeout-ms`. | Re-run with the same alias, then once with `--timeout-ms 30000` for the affected source only. | It repeats for 2 daily runs or blocks a weekly signoff; ask Source Ops to confirm whether the portal is slow, down, or needs a crawler timeout adjustment. |
| `classification=bot_check` | Body inspection found CAPTCHA, browser verification, Cloudflare/Akamai-style checks, or similar content. | Do not change registry metadata. Capture the sanitized evidence snippet and validate from a browser session. | It repeats in weekly review; escalate to Source Ops for approved browser automation/vendor account/fallback-source decision. |
| `classification=login_required` | Body inspection found login, SSO, password, vendor-account, or authentication-required content. | Confirm whether the source is expected to require a registered vendor account. Keep credentials out of the registry and runbook. | It affects production ingestion; escalate to Product + Source Ops for APSI Registration Vault or manual-review decision. |
| `errorCode=empty_body` / `empty_or_placeholder` | HTTP success did not produce useful content. | Re-run from another network and inspect the official portal in a browser. | It repeats weekly; assign registry or parser review depending on browser evidence. |
| `HTTP 404` / `HTTP 410` | Registry URL is likely stale or removed. | Verify the current official or approved fallback URL and update source registry metadata. | Any confirmed repeat; this is a critical registry fix, not a crawler retry. |
| TLS/DNS/`fetch failed` | Local network, DNS, TLS, server, or certificate path failed. | Re-run from another network and record whether browser access works. | It repeats across networks; escalate to Infrastructure/Source Ops with timestamp, source id, and sanitized error. |

Never store real portal credentials in CLI arguments, package scripts, source registry rows, snapshots, or documentation.

## Cadence

- Daily operations: run `npm run source:health:ops` from the production-like operator network. Review critical actions first, then warnings. Record the summary counts and any repeated state/source ids in the operations log.
- Weekly operations: run `npm run source:health:scheduled`, compare against the previous weekly snapshot, and decide whether repeated 403/timeout/bot-check/login-required findings need fallback-source, browser-access, or manual-review treatment.
- Release candidate: run `npm run source:health:ops` and attach the summary plus top unhealthy classifications to the release checklist.
- After any source registry change: run the affected state/source ids with `--inspect-body --persist`.
- Do not make `--inspect-body` part of normal unit tests or CI unless the environment is explicitly allowed to call public procurement portals.

## Release Acceptance

Before a production or demo release:

1. `npm run risk:check` is still the deterministic release gate and must pass without external network assumptions.
2. `npm run source:health:ops` has been run from the production-like operator network, or the release notes explicitly state why live probes were deferred.
3. No confirmed `update_registry_url` or `add_base_url` critical finding is open for a launch-critical source.
4. Repeated `forbidden`, `timeout`, `bot_check`, or `login_required` warnings have an owner, disposition, and next review date.
5. The snapshot write path works locally or in staging without using real portal credentials.

## Failure Escalation

Use this escalation order when the daily or weekly run has unhealthy results:

1. Operator retries once with the same alias and records whether the classification changed.
2. Operator retries only affected source ids with a longer timeout when the classification is `timeout`.
3. Source Ops validates browser access and official URL status for repeated access or body-inspection findings.
4. Product decides whether the affected source remains beta, becomes manual-review, or needs an approved aggregator fallback.
5. Infrastructure joins only for repeated TLS/DNS/network failures across operator networks.
6. Engineering updates registry metadata only after official/fallback URL evidence is captured.

## Current Baseline

Local MVP 50-state validity check on 2026-06-24:

- Deterministic release gate command: `npm run risk:check`
- Latest deterministic release gate result remains PASS from the previous freeze: the local check validated 50/50 required states with active bids, 1,146 state bids for required content, 1,146 bid detail routes, 216 state attachments, account tier separation, 50 source governance records, 50 source validity metadata records, 1,147 active bid URLs for global URL validity, and state/global source URL validity. `npm audit --omit=dev --audit-level=moderate` found 0 vulnerabilities.
- Live source health command: `npm run source:health:ops`
- Live source health result: command completed and persisted snapshot `source_health_cf0ede1c-10f1-4863-bb90-fde92c10c3ee` to the current SQLite runtime, but the live report status was FAIL: 21/50 healthy, 29 unhealthy, 0 skipped.
- Live failure summary: 12 `login_required`, 5 timeout/abort fetches, 5 HTTP 403 access blocks, 3 `bot_check`, 2 TLS/network fetch failures, 1 `empty_or_placeholder`, and 1 HTTP 503 service response.
- Source health evidence bundle command: `npm run source:health:evidence -- --allow-blocked --format=json --output=/tmp/winbids-source-health-evidence.2026-06-24.post-triage.json`
- Source health evidence result before triage refresh: generated a current 50/50 coverage evidence bundle with snapshot age under 1 hour and no critical unhealthy sources, but marked handoff blocked because 29 unhealthy sources had overdue next-review dates.
- Source health triage command: `npm run source:health:triage -- --owner=source-ops@winbids.local --all-unhealthy --apply --format=json --output=/tmp/winbids-source-health-triage.2026-06-24.apply.json`
- Source health triage result: refreshed owner/disposition/next-review for 29 unhealthy sources in the current SQLite runtime.
- Source health evidence result after triage refresh: `npm run source:health:evidence -- --allow-blocked --format=json --output=/tmp/winbids-source-health-evidence.2026-06-24.post-triage.json` returned `ok=true`, 50/50 observed state sources, 0 critical unhealthy, 0 unassigned unhealthy, 0 missing disposition, 0 missing next-review, and 0 overdue next-review.
- Source health access review command: `SOURCE_HEALTH_OWNER=source-ops@winbids.local npm run source:health:access-review -- --format=json --output=../ops-evidence/source-health/source-health-access-review.json`
- Source health access review result: 29/50 sources require operator follow-up, grouped as 8 `browser_access`, 12 `vendor_account`, 5 `long_timeout_retry`, 2 `network_tls`, 1 `portal_status`, and 1 `parser_or_access`; JSON/CSV outputs include sanitized source URLs and 0 unsafe URL/query or credential assignment matches.
- Launch handoff result: `SOURCE_HEALTH_OWNER=source-ops@winbids.local SOURCE_HEALTH_OPS_EVIDENCE_FILE=../ops-evidence/source-health/source-health-evidence.json SOURCE_HEALTH_ACCESS_REVIEW_FILE=../ops-evidence/source-health/source-health-access-review.json npm run ops:launch-handoff -- --allow-blocked --format=json --output=../ops-evidence/source-health/launch-handoff-source-health.json` returned Live Source Health Operations `status=ready`.
- Fixed during this pass: MS no longer returns HTTP 404 after updating `ms_state_procurement` from the stale DFA page to `https://www.ms.gov/dfa/contract_bid_search/Bid?autoloadGrid=true`; the follow-up single-source probe returned PASS. `source-health-check --persist` is now MySQL-runtime aware, and Admin Data Sources classification filters read the latest MySQL snapshot.
- Operational risk states: AL, AK, AZ, AR, CA, CO, GA, ID, IL, IA, LA, MD, MA, MN, MO, NC, ND, NE, NJ, NM, NY, OH, OR, RI, SC, TN, TX, VA, and VT.
- Release interpretation: local MVP publication uses deterministic `risk:check` as the release gate. Live source health is an operations risk report because public procurement portals can block local probes, require browser/vendor context, return bot-check/login pages, or fail due to network/TLS/temporary service behavior.

Previous local body-inspection report-only run on 2026-06-13:

- Command: `npm run source:health:ops`
- Result: 21/50 healthy, 29 unhealthy, 0 skipped.
- Live failure summary: 11 `login_required`, 6 timeout/abort fetches, 5 HTTP 403 access blocks, 3 `bot_check`, 2 TLS/network fetch failures, 1 `empty_or_placeholder`, and 1 HTTP 503 service response.
- Source health access review result: 29/50 sources required operator follow-up, grouped as 8 `browser_access`, 11 `vendor_account`, 6 `long_timeout_retry`, 2 `network_tls`, 1 `portal_status`, and 1 `parser_or_access`.

Previous local body-inspection report-only run on 2026-06-05:

- Command: `npm run source:health:check -- --all --timeout-ms 10000 --report-only --persist --inspect-body`
- Result: 20/50 healthy, 30 unhealthy, 0 skipped.
- Live failure summary: 15 `access_challenge` body-inspection findings, 6 HTTP 403 access blocks, 5 timeout/abort fetches, 3 network/TLS fetch failures, and 1 HTTP 503 service response.
- Operational risk states: AL, AK, AZ, AR, CA, CT, GA, ID, IL, LA, ME, MA, MN, MS, MT, NE, NJ, NM, NC, ND, OK, OR, RI, SC, TN, TX, UT, VT, VA, and WV.

Previous local body-inspection report-only run on 2026-06-03:

- Command: `npm run source:health:check -- --all --timeout-ms 5000 --report-only --inspect-body`
- Result: 15/50 healthy, 35 unhealthy, 0 skipped.
- New body-inspection findings include 200 responses that still look like access challenges for IL, MA, MN, NJ, ND, OR, TX, UT, and VA.
- Remaining unhealthy rows are 403, timeout/abort, fetch failure, 503, or access-challenge pages and should be triaged as live operations access risks.

Previous local report-only run on 2026-06-02:

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
