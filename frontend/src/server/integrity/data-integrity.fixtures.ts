/**
 * Seed data shared by the SQLite tests (data-integrity.test.ts, scripts/data-integrity.test.ts) and the real-MySQL
 * integration test (data-integrity.mysql.integration.test.ts) of `data:integrity`, so both dialects are held to the
 * same scenario and the same expected report. Rows are plain `INSERT INTO <table> (<columns>) VALUES (?, ...)` values.
 *
 * Ten registered sources and 23 bids that cover every level and every metric once or twice:
 *
 *   state (13)  1 ca:RFQ-1            open, visible, everything present
 *               2 ca:RFQ-2            open, deadline long past (expiredOpen)
 *               3 tx:100              open, hidden: issuer "Unknown state agency"
 *               4 tx:101              closed (closed_reason deadline_passed)
 *               5 tx:102              awarded
 *               6 ny:CR9 Company: ..  open, hidden, the malformed legacy NY id (malformedNyIds)
 *               7 ca:RFQ-3            open, display_status suppressed
 *               8 ca:legacy-7         open, visible, id is not <source>:<source_bid_id>, no body, no deadline
 *               9 ca:RFQ-4            lifecycle open but is_active 0 (activeFlagMismatch)
 *              10 bidnet_co_aurora:202 a city source's bid still typed 'state' (identityMismatch, hidden by the guard)
 *              11 1                   mock seed bid (unregistered, demoLike, visible)
 *              12 al_..._demo_readiness demo-readiness bid (unregistered, demoLike, visible)
 *              13 legacy-100          its source label belongs to two sources (hidden, ambiguous)
 *   county (4)  14 :111 visible   15 :112 visible, body locked at the source   16 :113 FIPS mismatch, hidden   17 :114 closed
 *   city (3)    18 :201 visible   19 :203 visible, deadline long past            20 :204 awarded
 *   township(1) 21 :301 visible, body locked at the source
 *   federal (1) 22 sam_gov:abc123 visible
 *   other (1)   23 ca:RFQ-9, issuer_type 'agency' (identityMismatch, hidden)
 *
 * `NOW` is fixed: the freshness and expiry metrics depend on it.
 */
import type { IntegrityLevel, LevelReport } from "./data-integrity";

export type SeedValue = string | number | null;

export interface SeedStatement {
  table: "data_sources" | "bids";
  values: Record<string, SeedValue>;
}

export const INTEGRITY_NOW = new Date("2026-10-13T12:00:00.000Z");
const SEED_AT = "2026-10-13T00:00:00.000Z";

const CA = "California Cal eProcure";
const TX = "Texas ESBD";
const NY = "NY Contract Reporter";
const BOULDER = "Boulder County, CO (BidNet)";
const AURORA = "City of Aurora, CO (BidNet)";
const LOWER_MERION = "Lower Merion Township, PA (BidNet)";

interface SourceSeed {
  id: string;
  label: string;
  issuerType: string;
  stateCode: string;
  jurisdictionLevel?: string | null;
  fipsCode?: string | null;
  enabled?: boolean;
  lastSuccessAt?: string | null;
  consecutiveFailures?: number;
}

const SOURCES: readonly SourceSeed[] = [
  // Exactly two days before NOW: inside the two-day window, the boundary included.
  { id: "ca_caleprocure", label: CA, issuerType: "state", stateCode: "CA", lastSuccessAt: "2026-10-11T12:00:00.000Z" },
  // Exactly seven days before NOW: inside the seven-day window only.
  { id: "tx_esbd", label: TX, issuerType: "state", stateCode: "TX", lastSuccessAt: "2026-10-06T12:00:00.000Z" },
  // An empty jurisdiction_level reads as state, like NULL.
  { id: "ny_contract_reporter", label: NY, issuerType: "state", stateCode: "NY", jurisdictionLevel: "", consecutiveFailures: 3 },
  { id: "sam_gov", label: "SAM.gov", issuerType: "federal", stateCode: "US", lastSuccessAt: "2026-09-13T12:00:00.000Z", consecutiveFailures: 1 },
  // Disabled sources are not part of the freshness numbers.
  { id: "oh_state_disabled", label: "Ohio State (disabled)", issuerType: "state", stateCode: "OH", enabled: false },
  // Two sources share one label: a legacy bid that names only the label cannot be attributed.
  { id: "dup_label_a", label: "Duplicate Label", issuerType: "state", stateCode: "WA", enabled: false },
  { id: "dup_label_b", label: "Duplicate Label", issuerType: "state", stateCode: "WA", enabled: false },
  {
    id: "bidnet_co_boulder", label: BOULDER, issuerType: "county", stateCode: "CO", jurisdictionLevel: "county", fipsCode: "08013",
    lastSuccessAt: "2026-10-13T06:00:00.000Z",
  },
  {
    id: "bidnet_co_aurora", label: AURORA, issuerType: "city", stateCode: "CO", jurisdictionLevel: "city", fipsCode: "0804000",
    // Two days and one second before NOW: outside the two-day window, inside the seven-day one.
    lastSuccessAt: "2026-10-11T11:59:59.000Z", consecutiveFailures: 2,
  },
  {
    id: "bidnet_pa_lower_twp", label: LOWER_MERION, issuerType: "township", stateCode: "PA", jurisdictionLevel: "township",
    fipsCode: "4209142000", lastSuccessAt: "2026-10-13T00:00:00.000Z",
  },
];

interface BidSeed {
  id: string;
  source: string;
  sourceBidId: string;
  title: string;
  description: string;
  issuerName: string;
  issuerType: string;
  stateCode: string;
  deadline: string;
  lastSeenAt: string;
  lifecycle?: "open" | "closed" | "awarded";
  isActive?: number;
  displayStatus?: string;
  jurisdictionLevel?: string | null;
  fipsCode?: string | null;
  rawPayload?: object | null;
  awardedDate?: string | null;
}

const LOCKED = { detail_access: { platform: "bidnet", restricted: ["description", "documents", "contact"] } };
const DESCRIPTION_ONLY_LOCKED = { detail_access: { platform: "bidnet", restricted: ["description"] } };

const BIDS: readonly BidSeed[] = [
  // ---- state ----
  {
    id: "ca_caleprocure:RFQ-1", source: CA, sourceBidId: "RFQ-1", title: "Road salt supply",
    description: "Supply and delivery of road salt for winter maintenance.", issuerName: "California Department of Transportation",
    issuerType: "state", stateCode: "CA", deadline: "2026-12-01", lastSeenAt: "2026-10-13T08:00:00.000Z",
  },
  {
    id: "ca_caleprocure:RFQ-2", source: CA, sourceBidId: "RFQ-2", title: "Janitorial services",
    description: "Janitorial services for state office buildings in Sacramento.", issuerName: "California Department of General Services",
    issuerType: "state", stateCode: "CA", deadline: "2026-09-01", lastSeenAt: "2026-10-12T20:00:00.000Z",
  },
  {
    id: "tx_esbd:100", source: TX, sourceBidId: "100", title: "Fleet vehicle maintenance",
    description: "Preventive maintenance for the state vehicle fleet.", issuerName: "Unknown state agency",
    issuerType: "state", stateCode: "TX", deadline: "2026-11-15", lastSeenAt: "2026-10-11T00:00:00.000Z",
  },
  {
    id: "tx_esbd:101", source: TX, sourceBidId: "101", title: "Office furniture",
    description: "Purchase of office furniture for the Capitol complex.", issuerName: "Texas Facilities Commission",
    issuerType: "state", stateCode: "TX", deadline: "2026-08-01", lastSeenAt: "2026-09-01T00:00:00.000Z", lifecycle: "closed",
    rawPayload: { lifecycle: { closed_reason: "deadline_passed", closed_observed_at: "2026-08-02T00:00:00.000Z", deadline: "2026-08-01" } },
  },
  {
    id: "tx_esbd:102", source: TX, sourceBidId: "102", title: "Printing services",
    description: "Printing of state forms and publications.", issuerName: "Texas Comptroller of Public Accounts",
    issuerType: "state", stateCode: "TX", deadline: "2026-07-01", lastSeenAt: "2026-08-01T00:00:00.000Z", lifecycle: "awarded",
    awardedDate: "2026-07-20",
  },
  {
    id: "ny_contract_reporter:CR9 Company: Acme Inc", source: NY, sourceBidId: "CR9 Company: Acme Inc",
    title: "Subcontract: janitorial work", description: "Subcontracting opportunity for janitorial work at state facilities.",
    issuerName: "Unknown state agency", issuerType: "state", stateCode: "NY", deadline: "2026-12-15", lastSeenAt: "2026-10-10T00:00:00.000Z",
  },
  {
    id: "ca_caleprocure:RFQ-3", source: CA, sourceBidId: "RFQ-3", title: "Landscaping",
    description: "Landscaping and grounds care for state parks.", issuerName: "California Department of Parks and Recreation",
    issuerType: "state", stateCode: "CA", deadline: "2026-12-10", lastSeenAt: "2026-10-13T01:00:00.000Z", displayStatus: "suppressed",
  },
  {
    // The id is not <source>:<source_bid_id>; no body, no deadline.
    id: "ca_caleprocure:legacy-7", source: CA, sourceBidId: "RFQ-7", title: "Laboratory supplies", description: "",
    issuerName: "California Department of Public Health", issuerType: "state", stateCode: "CA", deadline: "",
    lastSeenAt: "2026-10-09T00:00:00.000Z",
  },
  {
    // The lifecycle says open, the flag the search path reads says not.
    id: "ca_caleprocure:RFQ-4", source: CA, sourceBidId: "RFQ-4", title: "IT hardware",
    description: "Laptops and docking stations for state employees.", issuerName: "California Department of Technology",
    issuerType: "state", stateCode: "CA", deadline: "2026-12-12", lastSeenAt: "2026-10-13T02:00:00.000Z", lifecycle: "open", isActive: 0,
  },
  {
    // A city source's bid that kept the pre-backfill type 'state'.
    id: "bidnet_co_aurora:202", source: AURORA, sourceBidId: "202", title: "Street sweeping",
    description: "Street sweeping services for city streets.", issuerName: "City of Aurora",
    issuerType: "state", stateCode: "CO", deadline: "2026-12-03", lastSeenAt: "2026-10-13T03:00:00.000Z",
  },
  {
    id: "1", source: "Mock Source", sourceBidId: "mock:1", title: "Mock bid one",
    description: "Mock seed bid for local development.", issuerName: "Mock Agency",
    issuerType: "state", stateCode: "CA", deadline: "2026-12-31", lastSeenAt: "2026-10-13T04:00:00.000Z",
  },
  {
    id: "al_state_procurement_demo_readiness", source: "Alabama State Procurement", sourceBidId: "demo:al_state_procurement",
    title: "Demo readiness bid", description: "Demo readiness bid used by demo:prepare.", issuerName: "Alabama Department of Finance",
    issuerType: "state", stateCode: "AL", deadline: "2026-12-20", lastSeenAt: "2026-10-13T04:30:00.000Z",
  },
  {
    id: "legacy-100", source: "Duplicate Label", sourceBidId: "100", title: "Legacy paper bid",
    description: "Legacy bid whose source label two sources share.", issuerName: "Washington Department of Enterprise Services",
    issuerType: "state", stateCode: "WA", deadline: "2026-12-08", lastSeenAt: "2026-10-13T03:30:00.000Z",
  },
  // ---- county ----
  {
    id: "bidnet_co_boulder:111", source: BOULDER, sourceBidId: "111", title: "Culvert replacement",
    description: "Culvert replacement on County Road 7.", issuerName: "Boulder County", issuerType: "county", stateCode: "CO",
    deadline: "11/30/2026 5:00 PM", lastSeenAt: "2026-10-13T06:00:00.000Z", jurisdictionLevel: "county", fipsCode: "08013",
  },
  {
    id: "bidnet_co_boulder:112", source: BOULDER, sourceBidId: "112", title: "Roofing repairs", description: "",
    issuerName: "Boulder County", issuerType: "county", stateCode: "CO", deadline: "Not Available",
    lastSeenAt: "2026-10-13T05:00:00.000Z", jurisdictionLevel: "county", fipsCode: "08013", rawPayload: LOCKED,
  },
  {
    // The bid's FIPS contradicts its source's.
    id: "bidnet_co_boulder:113", source: BOULDER, sourceBidId: "113", title: "Snow plow lease",
    description: "Seasonal lease of snow plows.", issuerName: "Boulder County", issuerType: "county", stateCode: "CO",
    deadline: "12/05/2026", lastSeenAt: "2026-10-13T04:00:00.000Z", jurisdictionLevel: "county", fipsCode: "08014",
  },
  {
    id: "bidnet_co_boulder:114", source: BOULDER, sourceBidId: "114", title: "Pavement marking",
    description: "Pavement marking along county roads.", issuerName: "Boulder County", issuerType: "county", stateCode: "CO",
    deadline: "09/15/2026", lastSeenAt: "2026-10-01T00:00:00.000Z", jurisdictionLevel: "county", fipsCode: "08013", lifecycle: "closed",
    // Closed rows are not part of the open-row completeness numbers, locked or not.
    rawPayload: { ...DESCRIPTION_ONLY_LOCKED, lifecycle: { closed_reason: "delisted", closed_observed_at: "2026-10-02T00:00:00.000Z" } },
  },
  // ---- city ----
  {
    id: "bidnet_co_aurora:201", source: AURORA, sourceBidId: "201", title: "Water main repair",
    description: "Emergency water main repair on East Colfax.", issuerName: "City of Aurora", issuerType: "city", stateCode: "CO",
    deadline: "2026-11-20", lastSeenAt: "2026-10-13T07:00:00.000Z", jurisdictionLevel: "city", fipsCode: "0804000",
  },
  {
    id: "bidnet_co_aurora:203", source: AURORA, sourceBidId: "203", title: "Park benches", description: "Supply of park benches.",
    issuerName: "City of Aurora", issuerType: "city", stateCode: "CO", deadline: "10/01/2026",
    lastSeenAt: "2026-10-12T00:00:00.000Z", jurisdictionLevel: "city", fipsCode: "0804000",
  },
  {
    id: "bidnet_co_aurora:204", source: AURORA, sourceBidId: "204", title: "Traffic signals", description: "Traffic signal upgrades.",
    issuerName: "City of Aurora", issuerType: "city", stateCode: "CO", deadline: "08/15/2026",
    lastSeenAt: "2026-09-20T00:00:00.000Z", jurisdictionLevel: "city", fipsCode: "0804000", lifecycle: "awarded", awardedDate: "2026-09-01",
  },
  // ---- township ----
  {
    id: "bidnet_pa_lower_twp:301", source: LOWER_MERION, sourceBidId: "301", title: "Library roof", description: "",
    issuerName: "Lower Merion Township", issuerType: "township", stateCode: "PA", deadline: "2026-12-05",
    lastSeenAt: "2026-10-13T00:00:00.000Z", jurisdictionLevel: "township", fipsCode: "4209142000", rawPayload: DESCRIPTION_ONLY_LOCKED,
  },
  // ---- federal ----
  {
    id: "sam_gov:abc123", source: "SAM.gov", sourceBidId: "abc123", title: "Federal fleet vehicles",
    description: "Acquisition of fleet vehicles for federal agencies.", issuerName: "General Services Administration",
    issuerType: "federal", stateCode: "US", deadline: "2026-12-31T23:59:00Z", lastSeenAt: "2026-10-12T00:00:00.000Z",
  },
  // ---- other ----
  {
    id: "ca_caleprocure:RFQ-9", source: CA, sourceBidId: "RFQ-9", title: "Misfiled bid",
    description: "A bid stored with an issuer type the app does not know.", issuerName: "California Department of Water Resources",
    issuerType: "agency", stateCode: "CA", deadline: "2026-12-18", lastSeenAt: "2026-10-11T12:00:00.000Z",
  },
];

function sourceStatement(source: SourceSeed): SeedStatement {
  return {
    table: "data_sources",
    values: {
      id: source.id, label: source.label, issuer_type: source.issuerType, state_code: source.stateCode,
      is_enabled: source.enabled === false ? 0 : 1, jurisdiction_level: source.jurisdictionLevel ?? null,
      fips_code: source.fipsCode ?? null, last_success_at: source.lastSuccessAt ?? null,
      consecutive_failures: source.consecutiveFailures ?? 0, created_at: SEED_AT, updated_at: SEED_AT,
    },
  };
}

function bidStatement(bid: BidSeed): SeedStatement {
  const lifecycle = bid.lifecycle ?? "open";
  return {
    table: "bids",
    values: {
      id: bid.id, source: bid.source, source_bid_id: bid.sourceBidId, dedupe_key: `dedupe:${bid.id}`, title: bid.title,
      description: bid.description, issuer_name: bid.issuerName, issuer_type: bid.issuerType, state_code: bid.stateCode,
      source_url: `https://example.test/bids/${encodeURIComponent(bid.id)}`, deadline_date: bid.deadline,
      is_active: bid.isActive ?? (lifecycle === "open" ? 1 : 0), lifecycle_status: lifecycle,
      display_status: bid.displayStatus ?? "published", jurisdiction_level: bid.jurisdictionLevel ?? null,
      fips_code: bid.fipsCode ?? null, awarded_date: bid.awardedDate ?? null,
      raw_payload: bid.rawPayload ? JSON.stringify(bid.rawPayload) : null,
      first_seen_at: SEED_AT, last_seen_at: bid.lastSeenAt, created_at: SEED_AT, updated_at: SEED_AT,
    },
  };
}

/**
 * A valid, visible, open state bid with the id it is given (`ca_caleprocure:<anything>`), for the tests that need many
 * rows or rows with particular ids (paging, non-ASCII ids). Its source_bid_id is the part of the id after the first colon.
 */
export function plainStateBid(id: string, overrides: Record<string, SeedValue> = {}): SeedStatement {
  return {
    table: "bids",
    values: {
      id, source: CA, source_bid_id: id.slice(id.indexOf(":") + 1), dedupe_key: `dedupe:${id}`, title: `Plain bid ${id}`,
      description: "Plain body text for a bid used by a paging or encoding check.", issuer_name: "California Department of Plain Bids",
      issuer_type: "state", state_code: "CA", source_url: `https://example.test/plain/${encodeURIComponent(id)}`,
      deadline_date: "2026-12-01", is_active: 1, lifecycle_status: "open", display_status: "published",
      first_seen_at: SEED_AT, last_seen_at: "2026-10-01T00:00:00.000Z", created_at: SEED_AT, updated_at: SEED_AT,
      ...overrides,
    },
  };
}

/**
 * Ids that are not plain ASCII: an accent, an en dash, a CJK name, an umlaut. A unique number ends each, so that no two
 * of them are equal under an accent- and case-insensitive collation (`cafe-1` and `café-1` would be one key on MySQL).
 */
export function nonAsciiBidIds(count: number): string[] {
  const names = ["cafe", "café–A", "北京–B", "Zürich–C"];
  return Array.from({ length: count }, (_, n) => `ca_caleprocure:${names[n % names.length]}-${n}`);
}

/** The whole seed, sources first. */
export function buildIntegritySeed(): SeedStatement[] {
  return [...SOURCES.map(sourceStatement), ...BIDS.map(bidStatement)];
}

/** `INSERT INTO <table> (<columns>) VALUES (?, ...)` and its values. */
export function insertSql(statement: SeedStatement): { sql: string; params: SeedValue[] } {
  const columns = Object.keys(statement.values);
  return {
    sql: `INSERT INTO ${statement.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    params: columns.map((column) => statement.values[column]),
  };
}

/** The ids of the seeded bids, in the order the seed lists them. */
export const SEEDED_BID_IDS: readonly string[] = BIDS.map((bid) => bid.id);

const NO_SOURCES = { sources: 0, neverSucceeded: 0, succeededWithin2d: 0, succeededWithin7d: 0, failing: 0 };

function level(overrides: Partial<LevelReport>): LevelReport {
  return {
    total: 0, open: 0, closed: 0, awarded: 0, openVisible: 0, openHidden: 0, hiddenReasons: {},
    identityMismatch: 0, unregistered: 0, demoLike: 0, nonCanonicalId: 0, activeFlagMismatch: 0,
    withBody: 0, detailLockedAtSource: 0, bodyMissing: 0, withIssuer: 0, deadlineParseable: 0, withSourceUrl: 0,
    expiredOpen: 0, newestLastSeenAt: null, sourceHealth: { ...NO_SOURCES },
    ...overrides,
  };
}

/**
 * The report the seed must produce at INTEGRITY_NOW, level by level, worked out by hand from the table at the top.
 * Reasons are listed by count (most first), then by code.
 */
export const EXPECTED_LEVELS: Record<IntegrityLevel, LevelReport> = {
  state: level({
    total: 13, open: 11, closed: 1, awarded: 1, openVisible: 5, openHidden: 6,
    hiddenReasons: {
      invalid_issuer: 2, inactive_flag: 1, registered_source_ambiguous: 1, registered_source_mismatch: 1, suppressed: 1,
    },
    identityMismatch: 1, unregistered: 3, demoLike: 2, nonCanonicalId: 4, activeFlagMismatch: 1,
    withBody: 10, detailLockedAtSource: 0, bodyMissing: 1, withIssuer: 9, deadlineParseable: 10, withSourceUrl: 11,
    expiredOpen: 1, newestLastSeenAt: "2026-10-13T08:00:00.000Z",
    sourceHealth: { sources: 3, neverSucceeded: 1, succeededWithin2d: 1, succeededWithin7d: 2, failing: 1 },
  }),
  county: level({
    total: 4, open: 3, closed: 1, openVisible: 2, openHidden: 1, hiddenReasons: { registered_source_mismatch: 1 },
    identityMismatch: 1, withBody: 2, detailLockedAtSource: 1, bodyMissing: 0, withIssuer: 3, deadlineParseable: 2, withSourceUrl: 3,
    newestLastSeenAt: "2026-10-13T06:00:00.000Z",
    sourceHealth: { sources: 1, neverSucceeded: 0, succeededWithin2d: 1, succeededWithin7d: 1, failing: 0 },
  }),
  city: level({
    total: 3, open: 2, awarded: 1, openVisible: 2, withBody: 2, withIssuer: 2, deadlineParseable: 2, withSourceUrl: 2,
    expiredOpen: 1, newestLastSeenAt: "2026-10-13T07:00:00.000Z",
    sourceHealth: { sources: 1, neverSucceeded: 0, succeededWithin2d: 0, succeededWithin7d: 1, failing: 1 },
  }),
  township: level({
    total: 1, open: 1, openVisible: 1, withBody: 0, detailLockedAtSource: 1, withIssuer: 1, deadlineParseable: 1, withSourceUrl: 1,
    newestLastSeenAt: "2026-10-13T00:00:00.000Z",
    sourceHealth: { sources: 1, neverSucceeded: 0, succeededWithin2d: 1, succeededWithin7d: 1, failing: 0 },
  }),
  special_district: level({}),
  federal: level({
    total: 1, open: 1, openVisible: 1, withBody: 1, withIssuer: 1, deadlineParseable: 1, withSourceUrl: 1,
    newestLastSeenAt: "2026-10-12T00:00:00.000Z",
    sourceHealth: { sources: 1, neverSucceeded: 0, succeededWithin2d: 0, succeededWithin7d: 0, failing: 1 },
  }),
  other: level({
    total: 1, open: 1, openHidden: 1, hiddenReasons: { invalid_issuer_type: 1, registered_source_mismatch: 1 },
    identityMismatch: 1, withBody: 1, withIssuer: 1, deadlineParseable: 1, withSourceUrl: 1,
    newestLastSeenAt: "2026-10-11T12:00:00.000Z",
  }),
};

/**
 * The totals row of that report, written out rather than summed from EXPECTED_LEVELS so that a wrong fold in the
 * report builder cannot hide behind the same arithmetic here. Reasons: most first, then by code.
 */
export const EXPECTED_TOTALS: LevelReport = level({
  total: 23, open: 19, closed: 2, awarded: 2, openVisible: 11, openHidden: 8,
  hiddenReasons: {
    registered_source_mismatch: 3, invalid_issuer: 2, inactive_flag: 1, invalid_issuer_type: 1,
    registered_source_ambiguous: 1, suppressed: 1,
  },
  identityMismatch: 3, unregistered: 3, demoLike: 2, nonCanonicalId: 4, activeFlagMismatch: 1,
  withBody: 16, detailLockedAtSource: 2, bodyMissing: 1, withIssuer: 17, deadlineParseable: 17, withSourceUrl: 19,
  expiredOpen: 2, newestLastSeenAt: "2026-10-13T08:00:00.000Z",
  sourceHealth: { sources: 7, neverSucceeded: 1, succeededWithin2d: 3, succeededWithin7d: 5, failing: 3 },
});

/** The legacy NY ids in the seed: `ny_contract_reporter:CR9 Company: Acme Inc`. */
export const EXPECTED_MALFORMED_NY_IDS = 1;
