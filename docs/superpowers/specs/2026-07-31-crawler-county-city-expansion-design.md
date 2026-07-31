# Phase 2: County/City Procurement Data Expansion

**Date:** 2026-07-31
**Branch:** `worktree-crawler-source-registry-phase1`
**Prerequisite:** Phase 1 (crawler source registry) merged

---

## 1. Goal

Expand the crawler from 56 sources (50 states + SAM.gov federal + 5 dedicated) to 600–1400+ sources by adding county- and city-level government procurement data. All data must be real — no mocks, no fixtures in production.

## 2. Strategy: Platform-First + Top-City Backfill (Option C)

Three sub-phases, each independently deployable:

| Sub-phase | Scope | New adapters | Est. sources |
|---|---|---|---|
| **2a** | BidNet Direct counties/cities + Bonfire platform | 1 new (bonfire) | 300–800 |
| **2b** | PublicPurchase + PlanetBids platforms | 2 new | 300–600 |
| **2c** | Top 50 large-city backfill (self-hosted portals) | 5–10 dedicated | 20–50 |

## 3. Platform Adapter Inventory

### 3.1 Existing (Phase 1)

| Platform | `provider_family` | Spider | Extension for Phase 2 |
|---|---|---|---|
| BidNet Direct | `"bidnet"` | `co_bidnet.py` via `fetch_bidnet_platform` wrapper | Add county/city `data_sources` rows — zero spider changes |
| Generic HTML table | `"generic"` | `generic_state.py` | Same — add rows with county/city portal URLs |

### 3.2 New in Phase 2

| Platform | `provider_family` | Approach | Work |
|---|---|---|---|
| **Bonfire** | `"bonfire"` | JSON API: `{tenant}.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData`. Extract from existing `ut_bonfire.py`, parameterize tenant subdomain. All tenants share the same API shape. | Small — refactor existing spider |
| **PublicPurchase** | `"publicpurchase"` | HTML scraping: `publicpurchase.com/gems/{entity},{state}/buyer/public/home`. Single domain, consistent structure across all tenants. | Medium — new spider |
| **PlanetBids** | `"planetbids"` | Portal: `vendors.planetbids.com/portal/{agencyId}/portal-home`. Numeric agency IDs. Heavy California presence (400K+ registered vendors). | Medium — new spider |

### 3.3 Adapter Registry Changes

```python
# crawler/apsi_crawler/adapters/registry.py
PLATFORM_ADAPTERS = {
    "bidnet": fetch_bidnet_platform,              # existing
    "generic": fetch_generic_state_opportunities,  # existing
    "bonfire": fetch_bonfire_opportunities,         # Phase 2a
    "publicpurchase": fetch_publicpurchase_opportunities,  # Phase 2b
    "planetbids": fetch_planetbids_opportunities,  # Phase 2b
}
```

Resolution order unchanged: `DEDICATED_ADAPTERS` (by `source_id`) → `PLATFORM_ADAPTERS` (by `provider_family`) → `AdapterNotFoundError`.

### 3.4 Design Invariant: Adapter–Jurisdiction Decoupling

Adapters are jurisdiction-agnostic. The same BidNet adapter serves a state source (`al_state_procurement`) and a county source (`bidnet_co_denver`). The `jurisdiction_level` column on `data_sources` is metadata for scheduling and display — spiders never read it.

## 4. Source Registration

### 4.1 ID Naming Convention

```
{platform}_{state}_{entity_slug}
```

Examples:
- `bidnet_co_denver` — Denver County via BidNet
- `bonfire_ky_louisville` — Louisville via Bonfire
- `pp_ca_sacramento` — Sacramento County via PublicPurchase
- `pb_ca_los_angeles_county` — LA County via PlanetBids
- `nyc_passport` — NYC PASSPort (dedicated, no platform prefix)

Platform prefixes: `bidnet_`, `bonfire_`, `pp_`, `pb_`. Dedicated city portals use the entity name directly.

### 4.2 data_sources Row Shape

```json
{
  "id": "bidnet_co_denver",
  "label": "Denver County (BidNet)",
  "issuer_type": "county",
  "state_code": "CO",
  "jurisdiction_level": "county",
  "jurisdiction_name": "Denver County",
  "fips_code": "08031",
  "provider_family": "bidnet",
  "cadence": "daily",
  "fetch_config": "{\"base_url\":\"https://www.bidnetdirect.com/denver-county/solicitations/open-bids\"}",
  "approval_status": null
}
```

### 4.3 FIPS Code Handling

Phase 1 added `fips_code` to both `data_sources` and `bids`. For county/city sources:

- **State FIPS:** 2-digit code from existing `STATE_FIPS` lookup (e.g., `"08"` for CO)
- **County FIPS:** 5-digit code (state 2 + county 3, e.g., `"08031"` for Denver County)
- **City FIPS:** 7-digit FIPS place code where available; otherwise the enclosing county FIPS

FIPS codes are populated at source-registration time by the discovery script, not derived at runtime. The existing `fipsForStateCode()` function is unchanged — county/city FIPS are purely registration data in the `data_sources.fips_code` column.

### 4.4 fetch_config Schemas per Platform

| Platform | fetch_config keys | Example |
|---|---|---|
| bidnet | `base_url` | `{"base_url": "https://www.bidnetdirect.com/denver-county/solicitations/open-bids"}` |
| bonfire | `tenant`, `base_url` | `{"tenant": "louisvilleky", "base_url": "https://louisvilleky.bonfirehub.com/portal/"}` |
| publicpurchase | `entity`, `state`, `base_url` | `{"entity": "sacramentocounty", "state": "CA", "base_url": "https://www.publicpurchase.com/gems/sacramentocounty,ca/buyer/public/home"}` |
| planetbids | `agency_id`, `base_url` | `{"agency_id": "12345", "base_url": "https://vendors.planetbids.com/portal/12345/portal-home"}` |
| generic | `base_url` | `{"base_url": "https://some-county.gov/procurement/bids"}` |
| dedicated | platform-specific | Varies per spider |

## 5. Scheduling

### 5.1 Cadence Defaults by Jurisdiction

| Level | Default cadence | Rationale |
|---|---|---|
| federal | hourly | High volume, high value |
| state | daily | Established, stable |
| county | daily | Similar update frequency to states |
| city | weekly | Lower volume, less frequent updates |

Cadence is per-source in `data_sources.cadence` — these are defaults for the registration scripts. Individual sources can be overridden.

### 5.2 Platform Concurrency Cap

Phase 1's provider_family interleaving prevents dense bursts within a single sort pass, but with hundreds of BidNet sources all coming due at the same time, a single scheduling cycle could still send too many requests to one platform.

New mechanism: **per-platform cap per scheduling cycle.**

```typescript
const PLATFORM_CONCURRENCY_CAP = 10;
```

In `selectDueSources`, after interleaving, cap each `provider_family` to at most N sources per cycle. Excess sources remain due and are picked up next cycle. This is a soft throttle, not a skip — no data is lost.

Implementation: add a post-filter step in `selectDueSources` that counts per-family and drops excess entries from the result (they stay due because `last_success_at` is not updated).

### 5.3 Scheduler Code Changes

The existing `JURISDICTION_ORDER` already includes `"county"` and `"city"`. No schema or core logic changes needed. The only addition is the platform concurrency cap (§5.2).

## 6. Source Discovery Tool

### 6.1 Discovery Script

```
frontend/scripts/discover-sources.ts
```

CLI:
```bash
npm run source:discover -- --platform bidnet    # enumerate BidNet entities
npm run source:discover -- --platform bonfire   # enumerate Bonfire tenants
npm run source:discover -- --output candidates.json
```

The script:
1. Fetches the platform's public directory/listing page
2. Extracts entity slugs, names, jurisdictions, state codes
3. Cross-references against existing `data_sources` rows to find unregistered entities
4. Outputs a JSON file of candidate sources

### 6.2 Registration Script

```bash
npm run source:register -- --file candidates.json [--dry-run]
```

Reads the candidate JSON, validates each entry, and upserts into `data_sources` with `approval_status = NULL`. Dual-dialect (SQLite + MySQL) like the existing `migrate-source-registry.ts`.

### 6.3 Governance Flow

```
Discover → Review → Register (approval_status=NULL) → Approve → Scheduled
```

- **Discover:** automated script outputs candidates
- **Review:** human reviews candidates list, removes false positives
- **Register:** script writes to `data_sources` with `approval_status = NULL`
- **Approve:** admin sets `approval_status = "approved"` via admin UI or SQL
- **Scheduled:** scheduler picks up approved sources on their next due cycle

Phase 1's `listCrawlableSources` treats `approval_status = NULL` as "never reviewed, not denied" and allows crawling. For state sources this is fine — they were manually vetted during Phase 1. But county/city sources will be bulk-registered by discovery scripts, so NULL must mean "pending review, do not crawl." The fix: `listCrawlableSources` adds `AND (approval_status = 'approved' OR (approval_status IS NULL AND jurisdiction_level IN ('federal', 'state')))` — state/federal sources keep the Phase 1 NULL-is-allowed behavior, while county/city sources require explicit `approval_status = 'approved'` before their first crawl.

## 7. Python Spider Design

### 7.1 Bonfire Spider (refactored from ut_bonfire.py)

```python
# crawler/apsi_crawler/spiders/bonfire.py

def fetch_bonfire_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_json=None):
    """Platform spider for all Bonfire tenants.

    Reads tenant subdomain from source.fetch_config["tenant"].
    The API endpoint is consistent across all tenants.
    """
    tenant = source.fetch_config.get("tenant")
    if not tenant:
        raise ValueError(f"Bonfire source {source.id} missing fetch_config.tenant")

    api_url = f"https://{tenant}.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData"
    portal_url = f"https://{tenant}.bonfirehub.com/portal/?tab=openOpportunities"
    # ... reuse _projects_from_payload / _record_from_project logic from ut_bonfire.py
```

`ut_bonfire.py` becomes a thin wrapper or is retired in favor of the platform spider with `provider_family = "bonfire"`.

### 7.2 PublicPurchase Spider

```python
# crawler/apsi_crawler/spiders/publicpurchase.py

def fetch_publicpurchase_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_html=None):
    """Platform spider for PublicPurchase.com tenants."""
    url = source.fetch_config.get("base_url") or source.base_url
    # HTML table scraping — consistent structure across all tenants
```

### 7.3 PlanetBids Spider

```python
# crawler/apsi_crawler/spiders/planetbids.py

def fetch_planetbids_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_html=None):
    """Platform spider for PlanetBids tenants."""
    agency_id = source.fetch_config.get("agency_id")
    # Portal page or API endpoint
```

### 7.4 Spider Signature Convention

All platform spiders follow the same signature established in Phase 1:

```python
def fetch_X_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_html=None):
```

This is the contract that `resolve_adapter` + `fetch_task` CLI enforces. No changes needed to the dispatch layer.

## 8. Frontend Changes

### 8.1 Admin Console Enhancements

The admin source health page (`/admin`) currently shows state sources. Extend to:
- Filter by `jurisdiction_level` (federal / state / county / city)
- Filter by `provider_family`
- Show source count per platform
- Bulk approve/deny for newly discovered sources

### 8.2 Search & Display

Bids from county/city sources inherit `jurisdiction_level` and `jurisdiction_name` via the `stampJurisdiction` step in `crawl-task-persistence.ts` (Phase 1). The search page can add a jurisdiction filter facet. No schema changes needed.

### 8.3 state-crawler-sources.ts

This file retains governance metadata for 50 state sources (used by `risk:check` and admin UI). County/city sources do NOT go in this file — their governance lives entirely in `data_sources` table rows. No changes to this file.

## 9. Testing Strategy

### 9.1 Per-Spider Tests

Each new spider gets fixture-based tests mirroring the existing pattern:
- `tests/fixtures/{platform}_sample.html` (or `.json` for API-based)
- `tests/test_{platform}_spider.py` — parse fixture, assert normalized output

### 9.2 Platform Adapter Integration

- `test_adapter_registry.py` extended: new platform families resolve correctly
- `test_adapter_coverage.py` extended: every registered `provider_family` has an adapter

### 9.3 Discovery Script Tests

- Mock HTTP responses for platform directory pages
- Assert correct candidate extraction and dedup against existing sources

### 9.4 Scheduling Tests

- `scheduler.test.ts` extended: platform concurrency cap behavior
- Verify excess sources remain due (not dropped)

### 9.5 E2E Verification

- Register a test county source → approve → run `crawler:once` → verify bid lands in DB with correct `jurisdiction_level`/`fips_code`

## 10. Migration Path

### 10.1 Phase 1 Must Merge First

Phase 2 builds on the `data_sources` schema columns (`jurisdiction_level`, `jurisdiction_name`, `fips_code`, `fetch_config`) and the adapter registry infrastructure from Phase 1. Phase 1 branch must be merged before Phase 2 work begins.

### 10.2 No Schema Migration Needed

All database columns needed for county/city sources already exist from Phase 1. Phase 2 is purely:
- New Python spider files
- New `data_sources` rows (via discovery + registration scripts)
- Scheduler concurrency cap (small TS change)
- Admin UI filter enhancements

### 10.3 Rollback

Remove `data_sources` rows for county/city sources. State-level crawling is unaffected — the infrastructure is additive.

## 11. Deprioritized / Out of Scope

- **DemandStar** — requires account signup; revisit if Euna opens public API
- **OpenGov/ProcureNow** — no central portal; per-entity scraping too fragmented
- **Periscope/BuySpeed** — back-office tool; public data goes through BidSync aggregator
- **CivicPlus/Municode** — 4,200+ independent municipal sites; no uniform pattern
- **Paid platform API integrations** — Phase 3; requires API key management and billing
- **County/city-level `state-crawler-sources.ts` entries** — governance for sub-state sources lives in `data_sources` only
