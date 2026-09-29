import { CRAWLABLE_SOURCE_WHERE_SQL } from "@/server/crawler/source-registry";
import { COVERAGE_LEVELS } from "./data-source-list-contract";

/*
 * SQL fragments shared by the admin overview, source list, index and detail. Plain SQL that both
 * SQLite and MySQL accept; each fragment is parenthesised so it can be embedded in SELECT, WHERE
 * and GROUP BY alike. They read columns that data_sources has (LEVEL_SQL also works on bids,
 * which carries jurisdiction_level and issuer_type too).
 */
const KNOWN_LEVELS_SQL = COVERAGE_LEVELS.filter((level) => level !== "unknown")
  .map((level) => `'${level}'`)
  .join(", ");

/** Spec §4.2: jurisdiction_level, else issuer_type; anything outside the known levels is 'unknown'. */
export const LEVEL_SQL = `(CASE WHEN COALESCE(jurisdiction_level, issuer_type) IN (${KNOWN_LEVELS_SQL}) THEN COALESCE(jurisdiction_level, issuer_type) ELSE 'unknown' END)`;

/** The orchestrator gate's "local": any level other than federal/state, issuer_type as the fallback. */
export const LOCAL_SOURCE_SQL = `(COALESCE(jurisdiction_level, issuer_type) NOT IN ('federal', 'state'))`;

/** data-sources-repository's defaultProviderFamily for a NULL provider_family. */
export const PLATFORM_SQL = `(COALESCE(provider_family, CASE WHEN issuer_type = 'state' THEN 'state_portal' WHEN issuer_type = 'federal' THEN 'federal_portal' ELSE 'public_portal' END))`;

/** Plan decision 8: the gate's view — NULL approval is approved for federal/state, awaiting for local. */
export const APPROVAL_STATE_SQL = `(CASE WHEN approval_status = 'blocked' THEN 'blocked' WHEN approval_status = 'approved' THEN 'approved' WHEN approval_status = 'needs_review' THEN 'awaiting' WHEN ${LOCAL_SOURCE_SQL} THEN 'awaiting' ELSE 'approved' END)`;

/** Spec §5.1 health, first match wins: disabled > failing > healthy > never_run. */
export const HEALTH_STATE_SQL = `(CASE WHEN is_enabled = 0 THEN 'disabled' WHEN consecutive_failures > 0 THEN 'failing' WHEN last_success_at IS NOT NULL THEN 'healthy' ELSE 'never_run' END)`;

/** Spec §4.2 "in the crawl schedule": the scheduler's own predicate. */
export const SCHEDULED_SQL = `(${CRAWLABLE_SOURCE_WHERE_SQL})`;
