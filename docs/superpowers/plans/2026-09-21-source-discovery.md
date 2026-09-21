# Source Discovery (BidNet) — Implementation Plan

> **For agentic workers:** TDD. Three implementers in parallel on disjoint file trees. Shared checkout; do NOT commit/stash/checkout/reset. **No live portal requests from tests** — three real directory pages are already saved under `crawler/tests/fixtures/discovery/`. Never touch the `winbids` MySQL database. Spec: `docs/superpowers/specs/2026-09-21-source-discovery-design.md` (read it first; decisions are settled there).

**Goal:** One read-only command enumerates BidNet's public agency directory, keeps only counties and cities, attaches a Census GEOID, and writes a candidate JSON a person reviews before `source:register` puts it in the database as an unapproved row.

**Non-goals (user-confirmed):** other platforms, special districts, automatic registration, scheduled runs, fuzzy name matching.

---

## Shared contracts

### C1. Harvester (Task A provides, Task C consumes)

```python
# crawler/apsi_crawler/discovery/bidnet.py
HarvestedAgency = {          # plain dicts, no dataclasses needed
    "name": "Franklin County Children Services",
    "tenant_path": "/ohio/franklincountychildrensservices",
    "tenant_url": "https://www.bidnetdirect.com/ohio/franklincountychildrensservices/solicitations/open-bids",
    "group": "ohio",
    "state_code": "OH",      # None when the group is not a state (mitn, bgis, ...)
}

def harvest_bidnet(request, session=None, sleep=None, fetch_html=None) -> dict:
    """{"agencies": [HarvestedAgency, ...], "stats": {...}}"""
```
`request` keys used: `max_pages` (default 400), `min_interval_seconds` (default 3), `timeout_seconds` (default 30), `states` (list of two-letter codes or None = all).
`stats`: `{"pages": int, "agencies": int, "stopped_reason": "exhausted"|"max_pages"|"waf_challenge"|"no_new_links", "duplicates": int}`.
Rules: group list from `/purchasing-groups`; paging via `GET /participating-buyers/changePage?target=paginationChange&purchasingGroupContext=true&pageNumber=N` starting at 1; stop when no `Next` control, no new tenant paths, or `max_pages`; HTTP 202 or a WAF challenge body stops the run with `stopped_reason="waf_challenge"` and returns what was collected; every request goes through the crawler's browser headers and is spaced by `min_interval_seconds` (inject the sleeper). A tenant path is two segments (`/<group>/<slug>`) or one (`/<slug>`); dedupe by path. `states` filters by resolved `state_code` (unresolved groups are kept and reported by Task C).

### C2. Jurisdictions (Task B provides, Task C consumes)

```python
# crawler/apsi_crawler/jurisdictions/__init__.py
def name_key(value: str) -> str: ...
def classify_agency(name: str) -> str:      # "county" | "city" | "special_district" | "unknown"
def load_jurisdictions(path=None) -> dict:  # {"county": {("OH","franklin"): {...}}, "place": {...}}  built from the bundled TSV
def match_jurisdiction(level: str, state_code: str, name: str, table=None) -> dict:
    """-> {"status": "exact", "geoid": "39049", "name": "Franklin County"}
        | {"status": "ambiguous", "candidates": [...]}
        | {"status": "not_found"}"""
```
`level` is `"county"` or `"city"` (city looks in the `place` table). Bundled table: `crawler/data/us_jurisdictions.tsv`, header comment carrying source URLs and generation date, columns `level, geoid, state, name, name_key`. Refresh script: `crawler/scripts/refresh_jurisdictions.py` (stdlib only; downloads the two Census gazetteer zips named in the spec, drops non-incorporated places, writes the TSV, prints a summary). Classification and normalization rules are in spec §4.4 and §4.5 — follow them exactly.

### C3. CLI (Task C)

`python -m apsi_crawler.cli discover-sources` — stdin JSON → stdout JSON exactly as spec §4.2, exit 0 on a completed (even partial) run, exit 2 on an invalid request. Diagnostics to stderr only.

---

## Task A — BidNet directory harvester (agent)

**Ownership:** `crawler/apsi_crawler/discovery/**` (new package), `crawler/tests/test_discovery_bidnet.py`, `crawler/tests/fixtures/discovery/**` (the three HTML files are already there; add small synthetic ones if useful). Nothing else.

- [ ] Failing tests first, driven by the saved fixtures: page 1 yields ~50 agencies with name + tenant path; page 2 yields a different set; the group page yields the state slug list; `Next` present/absent drives continuation; a page repeating page 1's links stops with `no_new_links`; `max_pages` caps; an HTTP 202 body stops with `waf_challenge` and still returns earlier pages; the sleeper is called between requests with `min_interval_seconds`; `states=["OH"]` filters.
- [ ] Implement `harvest_bidnet` per C1. Parse the agency name from the link text (strip the "Organization logo of …" prefix the markup carries) and the path from the href. Map state-named group slugs to two-letter codes with a module-level table (all 50 states plus DC); unknown groups → `state_code: None`.
- [ ] Use `apsi_crawler.html.public_page` for fetching (browser headers, `HtmlPageError` with `status_code`), stdlib `re`/`HTMLParser` for parsing. Python 3.9, stdlib + `requests` only.
- [ ] `cd crawler && python3 -m pytest -q` green (baseline 476).

## Task B — Census jurisdictions table and matching (agent)

**Ownership:** `crawler/apsi_crawler/jurisdictions/**` (new package), `crawler/scripts/refresh_jurisdictions.py` (new), `crawler/data/us_jurisdictions.tsv` (new, committed), `crawler/tests/test_jurisdictions.py`, `crawler/tests/fixtures/jurisdictions/**`. Nothing else.

- [ ] Failing tests first: `name_key` (case, punctuation, "City and County of Denver" → `denver`, "St. Louis County" vs "Saint Louis County", trailing "County"/"Parish"/"Borough"/"City"/"Town"/"Village"); `classify_agency` over a table of real directory names taken from the saved fixtures (school/water/fire/library/transit/university → `special_district`; "Boulder County" → `county`; "City of Aurora" → `city`; "City and County of Denver …" → `county`); `match_jurisdiction` exact / ambiguous / not_found against a small fixture TSV; the loader tolerates the header comment and unknown extra columns.
- [ ] Build the real `crawler/data/us_jurisdictions.tsv` by running your own refresh script against the live Census files (that download is expected and allowed):
      `2024_Gaz_counties_national.zip` and `2024_Gaz_place_national.zip` under `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/`. Drop CDPs and other non-incorporated place types; keep counties and incorporated places only. Report the row counts you ended up with.
- [ ] The refresh script must be re-runnable, print what changed, and never be imported by runtime code (runtime only reads the TSV).
- [ ] `cd crawler && python3 -m pytest -q` green.

## Task C — CLI, candidate assembly, contract test, docs (agent)

**Ownership:** `crawler/apsi_crawler/discovery_service.py` (new; the orchestration that calls A and B), `crawler/apsi_crawler/cli.py`, `crawler/tests/test_discover_sources_cli.py`, `frontend/scripts/register-sources.test.ts` (add the contract case), `frontend/package.json` (script only), `docs/operations/source-discovery.md` (new), `CLAUDE.md`, `README.md`, `docs/architecture/crawler-enrichment-flow.md`. Nothing else — do not edit Task A's or Task B's packages.

- [ ] Failing tests first, with A and B injected as fakes (`harvest=`, `classify=`, `match=` parameters) so this task does not depend on their internals landing first: candidate shape matches `SourceCandidate` field-for-field; `special_district`/`unknown` go to `review` and never to `candidates`; `ambiguous`/`not_found` matches go to `review`; `existing_ids`/`existing_base_urls` deduplicate and increment `stats.duplicates`; `existing_sources` produce `existingMatches`; ids are `bidnet_<state>_<key>` and collisions get a numeric suffix; `stats` sums (`county + city + special_district + unknown == agencies`); stdout is exactly one JSON document; an invalid request exits 2 with the `INVALID_REQUEST` envelope.
- [ ] Wire `discover-sources` into `build_parser()` and the dispatcher, same stdin/stdout style as `archive-attachments` and `discover-tenant`.
- [ ] Node contract test: write a small fixture of two emitted candidates into `frontend/scripts/` test data and assert `validateCandidate` returns no errors for them, so the two languages cannot drift. Add `npm run source:discover` → prints the command (it is a Python CLI; the script just documents the invocation and pipes a request file). Keep it honest — if a wrapper script adds nothing, document the raw command in the ops guide instead of adding a script.
- [ ] Docs: `docs/operations/source-discovery.md` (Chinese, same tone as `local-source-approval.md`): 为什么不能猜路径、目录与分页端点、robots 结论、完整流程（发现 → 人工审阅 → register → 前置检查 → 批准）、分类与匹配规则、特别区为何不注册、Census 表如何刷新、成本与礼貌、四个待确认源如何用 `existingMatches` 收尾。Update the CLAUDE.md CLI-surface sentence (now eight subcommands) and its local-source paragraph, a README bullet, and a short section in the architecture doc.
- [ ] `cd crawler && python3 -m pytest -q`; `cd frontend && npx vitest run scripts/register-sources.test.ts`, `npm run lint`.

## Integration (controller)

- [ ] Wire the real A and B into C, run every suite, then a real `states: ["OH"]` run against the live directory and one full-platform dry run with `max_pages` capped; check the Ohio numbers against the six agencies seen on 2026-09-21.
- [ ] Feed the four pending 2026-09-16 sources in as `existing_sources` and report what the directory says about them.
- [ ] Ledger `.superpowers/sdd/2026-09-21-source-discovery/progress.md`; measured results appended to the ops guide.
