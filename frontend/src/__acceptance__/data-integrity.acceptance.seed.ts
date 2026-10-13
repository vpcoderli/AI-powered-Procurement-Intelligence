/**
 * Dialect-neutral seed data for the data-integrity acceptance suites.
 *
 * Every scenario is written as plain `INSERT ... VALUES (?, ...)` statements run through a `SqlRunner`, so the
 * SQLite suite (`better-sqlite3`) and the MySQL parity suite (`mysql2`) seed byte-identical rows and can compare
 * their results. Expected values are derived here from the requirement text alone
 * (`.superpowers/sdd/2026-10-13-data-integrity/test-phase-requirements.md` and the plan), never from the code
 * under test.
 */

export type SqlRunner = (sql: string, params?: unknown[]) => Promise<unknown> | unknown;

/** The instant at which the import / sweep observes the bids: 2026-10-13T12:00:00Z. */
export const OBSERVED_AT = "2026-10-13T12:00:00.000Z";
export const OBSERVED_AT_MS = Date.UTC(2026, 9, 13, 12, 0, 0);

const T0 = "2026-10-01T00:00:00.000Z";

export interface SourceSeed {
  id: string;
  label?: string;
  issuerType: string;
  stateCode: string;
  jurisdictionLevel?: string | null;
  jurisdictionName?: string | null;
  fipsCode?: string | null;
  isEnabled?: 0 | 1;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  consecutiveFailures?: number;
}

export interface BidSeed {
  id: string;
  source?: string;
  sourceBidId?: string | null;
  dedupeKey?: string;
  title?: string;
  description?: string;
  fullDescription?: string | null;
  issuerName?: string;
  issuerType: string;
  stateCode: string;
  sourceUrl?: string;
  lifecycleStatus?: "open" | "closed" | "awarded";
  displayStatus?: string;
  rawPayload?: string | null;
  jurisdictionLevel?: string | null;
  fipsCode?: string | null;
  deadlineDate?: string | null;
  publishedDate?: string | null;
  awardedDate?: string | null;
  lastSeenAt?: string;
}

export const BID_INSERT_COLUMNS = [
  "id", "source", "source_bid_id", "dedupe_key", "title", "description", "full_description", "issuer_name", "issuer_type",
  "state_code", "source_url", "is_active", "raw_payload", "display_status", "jurisdiction_level", "fips_code",
  "lifecycle_status", "deadline_date", "published_date", "awarded_date", "first_seen_at", "last_seen_at", "created_at", "updated_at",
] as const;

export function bidInsert(seed: BidSeed): [string, unknown[]] {
  const lifecycle = seed.lifecycleStatus ?? "open";
  const sourceBidId = seed.sourceBidId === undefined ? seed.id.slice(seed.id.indexOf(":") + 1) : seed.sourceBidId;
  const values = [
    seed.id,
    seed.source ?? (seed.id.includes(":") ? seed.id.slice(0, seed.id.indexOf(":")) : seed.id),
    sourceBidId,
    seed.dedupeKey ?? seed.id,
    seed.title ?? `Title ${seed.id}`,
    seed.description ?? "",
    seed.fullDescription ?? null,
    seed.issuerName ?? `Issuer ${seed.id}`,
    seed.issuerType,
    seed.stateCode,
    seed.sourceUrl ?? `https://example.gov/bids/${encodeURIComponent(seed.id)}`,
    // Lifecycle invariant from the requirements: is_active is exactly lifecycle_status === 'open'.
    lifecycle === "open" ? 1 : 0,
    seed.rawPayload === undefined ? null : seed.rawPayload,
    seed.displayStatus ?? "published",
    seed.jurisdictionLevel ?? null,
    seed.fipsCode ?? null,
    lifecycle,
    seed.deadlineDate ?? null,
    seed.publishedDate ?? null,
    seed.awardedDate ?? null,
    T0,
    seed.lastSeenAt ?? T0,
    T0,
    T0,
  ];
  return [
    `INSERT INTO bids (${BID_INSERT_COLUMNS.join(", ")}) VALUES (${BID_INSERT_COLUMNS.map(() => "?").join(", ")})`,
    values,
  ];
}

export function sourceInsert(seed: SourceSeed): [string, unknown[]] {
  return [
    "INSERT INTO data_sources (id, label, issuer_type, state_code, jurisdiction_level, jurisdiction_name, fips_code, is_enabled, last_success_at, last_failure_at, consecutive_failures, created_at, updated_at)"
      + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      seed.id,
      seed.label ?? seed.id,
      seed.issuerType,
      seed.stateCode,
      seed.jurisdictionLevel ?? null,
      seed.jurisdictionName ?? null,
      seed.fipsCode ?? null,
      seed.isEnabled ?? 1,
      seed.lastSuccessAt ?? null,
      seed.lastFailureAt ?? null,
      seed.consecutiveFailures ?? 0,
      T0,
      T0,
    ],
  ];
}

export async function seedSources(run: SqlRunner, sources: SourceSeed[]) {
  for (const source of sources) {
    const [sql, params] = sourceInsert(source);
    await run(sql, params);
  }
}

export async function seedBids(run: SqlRunner, bids: BidSeed[]) {
  for (const bid of bids) {
    const [sql, params] = bidInsert(bid);
    await run(sql, params);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Scenario 1: the deadline sweep. Four jurisdiction levels, identical rows per level.
// ---------------------------------------------------------------------------------------------------------------

export const SWEEP_LEVELS = [
  { level: "state", prefix: "tx_esbd", stateCode: "TX", fips: null as string | null, jurisdictionLevel: null as string | null },
  { level: "county", prefix: "bidnet_co_boulder", stateCode: "CO", fips: "08013", jurisdictionLevel: "county" },
  { level: "city", prefix: "bidnet_co_aurora", stateCode: "CO", fips: "0804000", jurisdictionLevel: "city" },
  { level: "township", prefix: "bidnet_mi_canton", stateCode: "MI", fips: "2616314000", jurisdictionLevel: "township" },
] as const;

export interface SweepExpectations {
  /** Rows the sweep must close, with the deadline text it must record. */
  closes: Array<{ id: string; level: string; deadline: string; rawPayloadBefore: string | null; stampable: boolean }>;
  /** Rows the sweep must leave byte-identical. */
  untouched: string[];
  /** Open rows with a non-blank deadline the parser rejects. */
  unparseable: number;
  /** Open rows the sweep examines. */
  scanned: number;
  closedByIssuerType: Record<string, number>;
}

export interface SweepDates {
  /** A date-only deadline that has expired at the observation instant. */
  pastDate: string;
  /** A zoned ISO deadline that has expired at the observation instant. */
  pastIso: string;
  /** A date-only deadline still open at the observation instant. */
  futureDate: string;
  /** A wall-clock deadline still open at the observation instant. */
  futureTime: string;
}

/** Deadlines around OBSERVED_AT (2026-10-13T12:00Z), for callers that control `now`. */
export const SWEEP_DATES_AT_OBSERVED: SweepDates = {
  pastDate: "10/12/2026",
  pastIso: "2026-10-13T11:59:59Z",
  futureDate: "10/13/2026",
  futureTime: "10/13/2026 2:00 PM CST",
};

/** Deadlines decades away on either side, for the CLI, which only knows the wall clock. */
export const SWEEP_DATES_FOR_WALL_CLOCK: SweepDates = {
  pastDate: "01/15/2020",
  pastIso: "2020-06-15T15:30:00Z",
  futureDate: "12/31/2099",
  futureTime: "12/31/2099 2:00 PM CST",
};

export async function seedSweepScenario(run: SqlRunner, dates: SweepDates = SWEEP_DATES_AT_OBSERVED): Promise<SweepExpectations> {
  const expectations: SweepExpectations = { closes: [], untouched: [], unparseable: 0, scanned: 0, closedByIssuerType: {} };
  await seedSources(run, SWEEP_LEVELS.map((entry) => ({
    id: entry.prefix,
    issuerType: entry.level,
    stateCode: entry.stateCode,
    jurisdictionLevel: entry.jurisdictionLevel,
    fipsCode: entry.fips,
  })));

  for (const entry of SWEEP_LEVELS) {
    const base = { issuerType: entry.level, stateCode: entry.stateCode, jurisdictionLevel: entry.jurisdictionLevel, fipsCode: entry.fips };
    const row = (suffix: string, extra: Partial<BidSeed>): BidSeed => ({ id: `${entry.prefix}:${suffix}`, ...base, ...extra });
    const objectPayload = JSON.stringify({ kept: true, lifecycle: { earlier: "note" } });

    const bids: BidSeed[] = [
      // Expired at the observation instant (with the defaults: 10/12 expires at 2026-10-13T10:00Z, 00:00 UTC-10 on 10/13).
      row("past-date", { deadlineDate: dates.pastDate, rawPayload: objectPayload }),
      row("past-iso", { deadlineDate: dates.pastIso, rawPayload: objectPayload }),
      // A non-object raw_payload must still close, and must never be stamped.
      row("nonjson-past", { deadlineDate: dates.pastDate, rawPayload: "not json at all" }),
      row("array-past", { deadlineDate: dates.pastDate, rawPayload: "[1,2]" }),
      row("null-raw-past", { deadlineDate: dates.pastDate, rawPayload: null }),
      // Still open at the observation instant.
      row("future-date", { deadlineDate: dates.futureDate, rawPayload: objectPayload }),
      row("future-time", { deadlineDate: dates.futureTime, rawPayload: objectPayload }),
      row("tbd", { deadlineDate: "TBD", rawPayload: objectPayload }),
      row("blank", { deadlineDate: null, rawPayload: objectPayload }),
      // Never touched by the sweep.
      row("awarded-past", { lifecycleStatus: "awarded", awardedDate: "2026-10-05", deadlineDate: dates.pastDate, rawPayload: objectPayload }),
      row("closed-past", { lifecycleStatus: "closed", deadlineDate: dates.pastDate, rawPayload: JSON.stringify({ lifecycle: { closed_reason: "delisted", closed_observed_at: T0 } }) }),
    ];
    await seedBids(run, bids);

    for (const suffix of ["past-date", "past-iso", "nonjson-past", "array-past", "null-raw-past"]) {
      const seed = bids.find((bid) => bid.id === `${entry.prefix}:${suffix}`)!;
      expectations.closes.push({
        id: seed.id,
        level: entry.level,
        deadline: seed.deadlineDate!,
        rawPayloadBefore: seed.rawPayload ?? null,
        stampable: suffix === "past-date" || suffix === "past-iso",
      });
    }
    for (const suffix of ["future-date", "future-time", "tbd", "blank", "awarded-past", "closed-past"]) {
      expectations.untouched.push(`${entry.prefix}:${suffix}`);
    }
    expectations.unparseable += 1;
    expectations.scanned += 9;
    expectations.closedByIssuerType[entry.level] = 5;
  }
  return expectations;
}

// ---------------------------------------------------------------------------------------------------------------
// Scenario 2: the two data migrations on a legacy-shaped database.
// ---------------------------------------------------------------------------------------------------------------

export const NY_SOURCE = "ny_contract_reporter";
export const NY_MARKER = "This is a subcontracting opportunity";

export interface MigrationExpectations {
  /** FIPS-drifted rows: expected level and FIPS after the migration, and the stale FIPS that must be kept. */
  driftCorrected: Array<{ id: string; level: string; fips: string; legacyFips: string; rawPayloadBefore: string | null }>;
  /** Rows no migration may touch. */
  untouched: string[];
  rekeyed: Array<{
    oldId: string;
    newId: string;
    sourceBidId: string;
    company: string;
    issuerName: string;
    title: string;
    description: string;
    /** null or "" are both "blank"; a non-echo body is kept verbatim. */
    fullDescriptionBlank: boolean;
    fullDescription: string | null;
    rawKeep: Record<string, unknown>;
    markerInOldTitle: boolean;
  }>;
  /** Malformed rows whose clean twin exists and that have no children: deleted, twin unchanged. */
  deletedDuplicates: Array<{ oldId: string; twinId: string }>;
  /** Malformed rows that stay malformed (child reference, or a key clash) — and must appear in `malformedNyIds`. */
  skippedMalformed: string[];
}

export async function seedMigrationScenario(run: SqlRunner): Promise<MigrationExpectations> {
  await seedSources(run, [
    { id: "bidnet_co_aurora", issuerType: "city", stateCode: "CO", jurisdictionLevel: "city", jurisdictionName: "Aurora", fipsCode: "0804000" },
    { id: "bidnet_co_boulder", issuerType: "county", stateCode: "CO", jurisdictionLevel: "county", jurisdictionName: "Boulder County", fipsCode: "08013" },
    { id: NY_SOURCE, issuerType: "state", stateCode: "NY" },
    { id: "tx_esbd", issuerType: "state", stateCode: "TX" },
  ]);
  await run("INSERT INTO users (id, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", ["u-mig", "mig@example.test", "user", T0, T0]);

  const expectations: MigrationExpectations = { driftCorrected: [], untouched: [], rekeyed: [], deletedDuplicates: [], skippedMalformed: [] };

  // --- 3a. FIPS drift -----------------------------------------------------------------------------------------
  const drift: Array<BidSeed & { expectLevel: string; expectFips: string }> = [
    { id: "bidnet_co_aurora:A1", issuerType: "state", stateCode: "CO", fipsCode: "0800001", rawPayload: JSON.stringify({ k: 1 }), expectLevel: "city", expectFips: "0804000" },
    { id: "bidnet_co_aurora:A2", issuerType: "state", stateCode: "CO", fipsCode: "0800002", rawPayload: "plain text payload", expectLevel: "city", expectFips: "0804000" },
    { id: "bidnet_co_aurora:A3", issuerType: "state", stateCode: "CO", fipsCode: "0800003", jurisdictionLevel: "city", rawPayload: JSON.stringify({ k: 3 }), expectLevel: "city", expectFips: "0804000" },
    { id: "bidnet_co_boulder:B1", issuerType: "state", stateCode: "CO", fipsCode: "08999", rawPayload: null, expectLevel: "county", expectFips: "08013" },
  ];
  await seedBids(run, drift);
  for (const seed of drift) {
    expectations.driftCorrected.push({ id: seed.id, level: seed.expectLevel, fips: seed.expectFips, legacyFips: seed.fipsCode!, rawPayloadBefore: seed.rawPayload ?? null });
  }
  const driftControls: BidSeed[] = [
    // State disagrees with the source: not a drift correction candidate.
    { id: "bidnet_co_aurora:A4", issuerType: "state", stateCode: "TX", fipsCode: "0800004", rawPayload: JSON.stringify({ k: 4 }) },
    // Already a local level: the rule only corrects rows still typed 'state'.
    { id: "bidnet_co_aurora:A6", issuerType: "county", stateCode: "CO", fipsCode: "0800006", jurisdictionLevel: "county", rawPayload: JSON.stringify({ k: 6 }) },
    // Row-level jurisdiction disagrees with the source level.
    { id: "bidnet_co_aurora:A7", issuerType: "state", stateCode: "CO", fipsCode: "0800007", jurisdictionLevel: "county", rawPayload: JSON.stringify({ k: 7 }) },
    // A genuine state bid under a state source.
    { id: "tx_esbd:T1", issuerType: "state", stateCode: "TX", fipsCode: "48", rawPayload: JSON.stringify({ k: 8 }) },
  ];
  await seedBids(run, driftControls);
  expectations.untouched.push(...driftControls.map((seed) => seed.id));

  // --- 3b. NY re-key ------------------------------------------------------------------------------------------
  const malformed = (cr: string, company: string, extra: Partial<BidSeed> = {}): BidSeed => ({
    id: `${NY_SOURCE}:${cr} Company: ${company}`,
    source: NY_SOURCE,
    sourceBidId: `${cr} Company: ${company}`,
    dedupeKey: `${NY_SOURCE}:${cr} Company: ${company}`,
    issuerType: "state",
    stateCode: "NY",
    sourceUrl: `https://www.nyscr.ny.gov/Ads/Details/${cr}`,
    ...extra,
  });

  const r1Title = `CUNY Queens College - Razran Hall ${NY_MARKER}`;
  const r1 = malformed("2138289", "E.W. Howell Co., LLC.", {
    title: r1Title,
    description: r1Title,
    fullDescription: r1Title,
    issuerName: "Unknown state agency",
    rawPayload: JSON.stringify({ data_quality: { issues: ["invalid_issuer"] }, x: 1 }),
  });
  const r2 = malformed("2138300", "Acme Sub LLC", {
    title: "Plain title without the marker",
    description: "A real body of text about the work to be done.",
    fullDescription: null,
    issuerName: "NYS Office of General Services",
    rawPayload: JSON.stringify({ y: 2 }),
  });
  // A clean twin already exists: the malformed row is a duplicate and goes away; the twin stays as it is.
  const twin3: BidSeed = { id: `${NY_SOURCE}:2138281`, source: NY_SOURCE, sourceBidId: "2138281", issuerType: "state", stateCode: "NY", title: "Clean twin", issuerName: "Pike Construction Services, Inc.", rawPayload: JSON.stringify({ z: 3 }) };
  const r3 = malformed("2138281", "Pike Construction Services, Inc.", { title: `Dup ${NY_MARKER}`, issuerName: "Unknown state agency" });
  // Referenced by a child row: left exactly as it is.
  const r4 = malformed("2138400", "Held LLC", { title: `Held ${NY_MARKER}`, issuerName: "Unknown state agency", rawPayload: JSON.stringify({ data_quality: { issues: [] } }) });
  // Twin exists AND a child references the malformed row: still left as it is (never deleted, never re-keyed).
  const twin5: BidSeed = { id: `${NY_SOURCE}:2138500`, source: NY_SOURCE, sourceBidId: "2138500", issuerType: "state", stateCode: "NY", title: "Clean twin five" };
  const r5 = malformed("2138500", "Twin Held Inc", { title: `Twin held ${NY_MARKER}`, issuerName: "Unknown state agency" });
  // A clean NY row that merely mentions "Company:" in its title is never a re-key candidate.
  const r6: BidSeed = { id: `${NY_SOURCE}:2138600`, source: NY_SOURCE, sourceBidId: "2138600", issuerType: "state", stateCode: "NY", title: "Something Company: not an id problem", issuerName: "NYS DOT" };
  // Key clash: another row already owns (source, source_bid_id) = (ny_contract_reporter, 2138700), so the re-key would
  // violate the unique index. UPDATE OR IGNORE / UPDATE IGNORE must skip this row, leaving it malformed.
  const clashOwner: BidSeed = { id: "legacy-2138700", source: NY_SOURCE, sourceBidId: "2138700", dedupeKey: "legacy:2138700", issuerType: "state", stateCode: "NY", title: "Legacy owner of the clean key" };
  const r7 = malformed("2138700", "Clash Co", { title: `Clash ${NY_MARKER}`, issuerName: "Unknown state agency" });

  await seedBids(run, [r1, r2, twin3, r3, r4, twin5, r5, r6, clashOwner, r7]);
  await run("INSERT INTO saved_bids (user_id, bid_id, created_at) VALUES (?, ?, ?)", ["u-mig", r4.id, T0]);
  await run("INSERT INTO bid_attachments (id, bid_id, name, url, created_at) VALUES (?, ?, ?, ?, ?)", ["att-r5", r5.id, "plans.pdf", "https://example.test/plans.pdf", T0]);

  expectations.rekeyed.push(
    {
      oldId: r1.id, newId: `${NY_SOURCE}:2138289`, sourceBidId: "2138289", company: "E.W. Howell Co., LLC.", issuerName: "E.W. Howell Co., LLC.",
      title: "CUNY Queens College - Razran Hall", description: "", fullDescriptionBlank: true, fullDescription: null, rawKeep: { x: 1 }, markerInOldTitle: true,
    },
    {
      oldId: r2.id, newId: `${NY_SOURCE}:2138300`, sourceBidId: "2138300", company: "Acme Sub LLC", issuerName: "NYS Office of General Services",
      title: "Plain title without the marker", description: "A real body of text about the work to be done.", fullDescriptionBlank: false, fullDescription: null, rawKeep: { y: 2 }, markerInOldTitle: false,
    },
  );
  expectations.deletedDuplicates.push({ oldId: r3.id, twinId: twin3.id });
  expectations.skippedMalformed.push(r4.id, r5.id, r7.id);
  expectations.untouched.push(twin3.id, r4.id, twin5.id, r5.id, r6.id, clashOwner.id, r7.id);
  return expectations;
}

// ---------------------------------------------------------------------------------------------------------------
// Scenario 3: the demo purge. Demo bids, near misses and a full set of dependents on every bid.
// ---------------------------------------------------------------------------------------------------------------

export const DEMO_BID_IDS = {
  demoReadiness: ["al_state_procurement_demo_readiness", "ak_state_procurement_demo_readiness"],
  mockSeed: ["1", "2"],
} as const;

export const NEAR_MISS_BID_IDS = [
  "co_state_procurement_demo_readiness", // suffix matches, source_bid_id does not start with demo:
  "3", // all digits, source_bid_id is mock:4, not mock:3
  "77", // all digits + mock:77, but "77" IS a data_sources.id
  "wa_state_procurement_demo_readiness", // demo: marker, but the whole id IS a data_sources.id
  "orphan_source:9", // unregistered, no marker at all
  "tx_esbd:TX-1", // a real registered bid
  "al_state_procurement:demo_readiness", // ends with demo_readiness but not _demo_readiness; prefix registered
  "12a", // not all digits
  "al_state_procurement_demo_readiness2", // suffix does not match
] as const;

/** Tables that reference bids directly through bid_id (from the REFERENCES clauses of migrate.ts). */
export const DIRECT_BID_CHILD_TABLES = [
  "bid_attachments", "bid_field_corrections", "saved_bids", "intent_to_bid", "submission_paths", "award_outcomes",
  "compliance_manifest_items", "pursuit_decisions", "response_workspace_items", "response_package_snapshots",
  "response_package_exports", "response_package_export_review_events", "supplier_artifacts", "artifact_versions",
  "quote_requests", "deadline_reminders",
] as const;

/** Tables that reach bids only through another child (intent, workspace item, quote request, artifact). */
export const INDIRECT_BID_CHILD_TABLES = [
  "submission_confirmations", "response_workspace_comments", "response_workspace_activity",
  "response_workspace_item_artifacts", "quote_request_artifacts",
] as const;

/** Every parent/child relationship on the bid graph, as declared by REFERENCES in migrate.ts. */
export const BID_GRAPH_RELATIONSHIPS: Array<{ table: string; column: string; parent: string }> = [
  ...DIRECT_BID_CHILD_TABLES.map((table) => ({ table, column: "bid_id", parent: "bids" })),
  { table: "submission_paths", column: "intent_id", parent: "intent_to_bid" },
  { table: "submission_confirmations", column: "intent_id", parent: "intent_to_bid" },
  { table: "award_outcomes", column: "intent_id", parent: "intent_to_bid" },
  { table: "award_outcomes", column: "tabulation_artifact_id", parent: "supplier_artifacts" },
  { table: "compliance_manifest_items", column: "intent_id", parent: "intent_to_bid" },
  { table: "pursuit_decisions", column: "intent_id", parent: "intent_to_bid" },
  { table: "response_workspace_items", column: "intent_id", parent: "intent_to_bid" },
  { table: "response_workspace_comments", column: "intent_id", parent: "intent_to_bid" },
  { table: "response_workspace_comments", column: "item_id", parent: "response_workspace_items" },
  { table: "response_workspace_activity", column: "intent_id", parent: "intent_to_bid" },
  { table: "response_workspace_activity", column: "item_id", parent: "response_workspace_items" },
  { table: "response_package_snapshots", column: "intent_id", parent: "intent_to_bid" },
  { table: "response_package_exports", column: "snapshot_id", parent: "response_package_snapshots" },
  { table: "response_package_exports", column: "intent_id", parent: "intent_to_bid" },
  { table: "response_package_export_review_events", column: "export_id", parent: "response_package_exports" },
  { table: "response_package_export_review_events", column: "snapshot_id", parent: "response_package_snapshots" },
  { table: "response_package_export_review_events", column: "intent_id", parent: "intent_to_bid" },
  { table: "supplier_artifacts", column: "intent_id", parent: "intent_to_bid" },
  { table: "artifact_versions", column: "artifact_id", parent: "supplier_artifacts" },
  { table: "artifact_versions", column: "intent_id", parent: "intent_to_bid" },
  { table: "response_workspace_item_artifacts", column: "item_id", parent: "response_workspace_items" },
  { table: "response_workspace_item_artifacts", column: "artifact_id", parent: "supplier_artifacts" },
  { table: "quote_requests", column: "intent_id", parent: "intent_to_bid" },
  { table: "quote_request_artifacts", column: "quote_request_id", parent: "quote_requests" },
  { table: "quote_request_artifacts", column: "artifact_id", parent: "supplier_artifacts" },
  { table: "deadline_reminders", column: "intent_id", parent: "intent_to_bid" },
  { table: "knowledge_items", column: "source_intent_id", parent: "intent_to_bid" },
  { table: "knowledge_items", column: "source_bid_id", parent: "bids" },
];

export interface DemoPurgeContext {
  userId: string;
  orgId: string;
  partnerId: string;
}

export const DEMO_CONTEXT: DemoPurgeContext = { userId: "u-demo", orgId: "org-demo", partnerId: "partner-demo" };

/** Give one bid a full set of dependents: one row per table of the bid graph, all keyed by `tag`. */
export async function attachDependents(run: SqlRunner, bidId: string, tag: string, ctx: DemoPurgeContext = DEMO_CONTEXT) {
  const intent = `int-${tag}`;
  const item = `rwi-${tag}`;
  const snapshot = `rps-${tag}`;
  const exportId = `rpe-${tag}`;
  const artifact = `art-${tag}`;
  const quote = `qr-${tag}`;
  const u = ctx.userId;
  await run("INSERT INTO bid_attachments (id, bid_id, name, url, created_at) VALUES (?, ?, ?, ?, ?)", [`att-${tag}`, bidId, "spec.pdf", `https://example.test/${tag}/spec.pdf`, T0]);
  await run("INSERT INTO bid_field_corrections (id, bid_id, field_name, original_value, corrected_value, corrected_by, corrected_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [`bfc-${tag}`, bidId, "title", "a", "b", u, T0]);
  await run("INSERT INTO saved_bids (user_id, bid_id, created_at) VALUES (?, ?, ?)", [u, bidId, T0]);
  await run("INSERT INTO intent_to_bid (id, user_id, bid_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [intent, u, bidId, T0, T0]);
  await run("INSERT INTO submission_paths (id, intent_id, bid_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [`sp-${tag}`, intent, bidId, u, T0, T0]);
  await run("INSERT INTO submission_confirmations (id, intent_id, user_id, submitted_at, method, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [`sc-${tag}`, intent, u, T0, "portal", T0, T0]);
  await run("INSERT INTO compliance_manifest_items (id, intent_id, bid_id, user_id, title, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [`cmi-${tag}`, intent, bidId, u, "Insurance", "legal", T0, T0]);
  await run("INSERT INTO pursuit_decisions (id, intent_id, bid_id, user_id, decision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [`pd-${tag}`, intent, bidId, u, "pursue", T0, T0]);
  await run("INSERT INTO response_workspace_items (id, intent_id, bid_id, user_id, kind, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [item, intent, bidId, u, "task", "Draft", T0, T0]);
  await run("INSERT INTO response_workspace_comments (id, intent_id, item_id, author_user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [`rwc-${tag}`, intent, item, u, "comment", T0, T0]);
  await run("INSERT INTO response_workspace_activity (id, intent_id, item_id, actor_user_id, event_type, created_at) VALUES (?, ?, ?, ?, ?, ?)", [`rwa-${tag}`, intent, item, u, "status_changed", T0]);
  await run("INSERT INTO response_package_snapshots (id, intent_id, bid_id, user_id, created_by_user_id, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [snapshot, intent, bidId, u, u, "Snapshot", T0]);
  await run("INSERT INTO response_package_exports (id, snapshot_id, intent_id, bid_id, user_id, requested_by_user_id, file_name, content_type, byte_size, storage_path, checksum_sha256, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [exportId, snapshot, intent, bidId, u, u, "pkg.md", "text/markdown", 10, `exports/${tag}.md`, "0".repeat(64), T0, T0]);
  await run("INSERT INTO response_package_export_review_events (id, export_id, snapshot_id, intent_id, bid_id, user_id, actor_user_id, from_review_status, to_review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [`rper-${tag}`, exportId, snapshot, intent, bidId, u, u, "pending_review", "approved", T0]);
  await run("INSERT INTO supplier_artifacts (id, intent_id, bid_id, user_id, title, artifact_type, purpose, file_name, content_type, byte_size, storage_path, checksum_sha256, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [artifact, intent, bidId, u, "Tab", "document", "tabulation", "tab.pdf", "application/pdf", 5, `vault/${tag}.pdf`, "1".repeat(64), T0, T0]);
  await run("INSERT INTO artifact_versions (id, artifact_id, intent_id, bid_id, user_id, version_number, title, file_name, content_type, byte_size, storage_path, checksum_sha256, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [`av-${tag}`, artifact, intent, bidId, u, 1, "Tab v1", "tab.pdf", "application/pdf", 5, `vault/${tag}-v1.pdf`, "2".repeat(64), u, T0]);
  await run("INSERT INTO response_workspace_item_artifacts (item_id, artifact_id, created_at) VALUES (?, ?, ?)", [item, artifact, T0]);
  await run("INSERT INTO award_outcomes (id, organization_id, intent_id, bid_id, user_id, tabulation_artifact_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [`ao-${tag}`, ctx.orgId, intent, bidId, u, artifact, T0, T0]);
  await run("INSERT INTO quote_requests (id, organization_id, intent_id, bid_id, partner_id, created_by_user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [quote, ctx.orgId, intent, bidId, ctx.partnerId, u, "Quote", T0, T0]);
  await run("INSERT INTO quote_request_artifacts (quote_request_id, artifact_id, created_at) VALUES (?, ?, ?)", [quote, artifact, T0]);
  await run("INSERT INTO deadline_reminders (id, organization_id, user_id, intent_id, bid_id, kind, linked_object_type, linked_object_id, dedupe_key, title, due_at, reminder_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [`dr-${tag}`, ctx.orgId, u, intent, bidId, "deadline", "bid", bidId, `dr:${tag}`, "Due soon", T0, T0, T0, T0]);
  await run("INSERT INTO knowledge_items (id, organization_id, created_by_user_id, title, body, type, source_kind, source_intent_id, source_bid_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [`ki-${tag}`, ctx.orgId, u, "Lesson", "Body", "lesson", "intent", intent, bidId, T0, T0]);
}

export interface DemoPurgeExpectations {
  demoBidIds: string[];
  keepBidIds: string[];
  /** One dependent row per demo bid in each of these tables. */
  dependentsPerTable: Record<string, number>;
  /** Knowledge items whose links are set to NULL (their own rows stay). */
  knowledgeItemsDetached: string[];
  /** award_outcomes rows on kept bids whose tabulation_artifact_id pointed into the purged set. */
  awardOutcomesDetached: string[];
  tags: Record<string, string>;
}

export async function seedDemoPurgeScenario(run: SqlRunner): Promise<DemoPurgeExpectations> {
  const ctx = DEMO_CONTEXT;
  await run("INSERT INTO users (id, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [ctx.userId, "demo@example.test", "user", T0, T0]);
  await run("INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)", [ctx.orgId, "Demo Org", T0, T0]);
  await run("INSERT INTO sourcing_partners (id, organization_id, created_by_user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [ctx.partnerId, ctx.orgId, ctx.userId, "Partner", T0, T0]);
  await seedSources(run, [
    { id: "al_state_procurement", issuerType: "state", stateCode: "AL" },
    { id: "ak_state_procurement", issuerType: "state", stateCode: "AK" },
    { id: "co_state_procurement", issuerType: "state", stateCode: "CO" },
    { id: "tx_esbd", issuerType: "state", stateCode: "TX" },
    { id: "77", label: "A source whose id is all digits", issuerType: "state", stateCode: "ZZ" },
    { id: "wa_state_procurement_demo_readiness", label: "A source whose id carries the demo suffix", issuerType: "state", stateCode: "WA" },
  ]);

  const bids: Array<BidSeed & { tag: string }> = [
    // Demo readiness rows (npm run demo:prepare shape: no colon in the id, demo: source_bid_id).
    { tag: "D1", id: "al_state_procurement_demo_readiness", source: "al_state_procurement", sourceBidId: "demo:al_state_procurement", issuerType: "state", stateCode: "AL", rawPayload: JSON.stringify({ demoReadiness: true }) },
    { tag: "D2", id: "ak_state_procurement_demo_readiness", source: "ak_state_procurement", sourceBidId: "demo:ak_state_procurement", issuerType: "state", stateCode: "AK", rawPayload: JSON.stringify({ demoReadiness: true }) },
    // Mock seed rows (db:seed shape).
    { tag: "M1", id: "1", source: "SAM.gov", sourceBidId: "mock:1", issuerType: "federal", stateCode: "US" },
    { tag: "M2", id: "2", source: "Cal eProcure", sourceBidId: "mock:2", issuerType: "state", stateCode: "CA" },
    // Near misses: every one of these must survive.
    { tag: "N1", id: "co_state_procurement_demo_readiness", source: "co_state_procurement", sourceBidId: "seed:co", issuerType: "state", stateCode: "CO" },
    { tag: "N2", id: "3", source: "Texas SmartBuy", sourceBidId: "mock:4", issuerType: "state", stateCode: "TX" },
    { tag: "N4", id: "77", source: "77", sourceBidId: "mock:77", issuerType: "state", stateCode: "ZZ" },
    { tag: "N5", id: "wa_state_procurement_demo_readiness", source: "wa_state_procurement_demo_readiness", sourceBidId: "demo:wa", issuerType: "state", stateCode: "WA" },
    { tag: "N6", id: "orphan_source:9", source: "orphan_source", sourceBidId: "9", issuerType: "state", stateCode: "TX" },
    { tag: "N7", id: "tx_esbd:TX-1", source: "tx_esbd", sourceBidId: "TX-1", issuerType: "state", stateCode: "TX" },
    { tag: "N8", id: "al_state_procurement:demo_readiness", source: "al_state_procurement", sourceBidId: "demo:x", issuerType: "state", stateCode: "AL" },
    { tag: "N9", id: "12a", source: "mockish", sourceBidId: "mock:12a", issuerType: "state", stateCode: "TX" },
    { tag: "N10", id: "al_state_procurement_demo_readiness2", source: "al_state_procurement", sourceBidId: "demo:al2", issuerType: "state", stateCode: "AL" },
  ];
  await seedBids(run, bids);
  const tags: Record<string, string> = {};
  for (const bid of bids) {
    tags[bid.id] = bid.tag;
    await attachDependents(run, bid.id, bid.tag, ctx);
  }
  // Cross links from rows that stay into rows that go: these must be detached (set NULL), not deleted.
  await run("INSERT INTO knowledge_items (id, organization_id, created_by_user_id, title, body, type, source_kind, source_intent_id, source_bid_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ["ki-cross", ctx.orgId, ctx.userId, "Cross", "Body", "lesson", "bid", "int-D1", "al_state_procurement_demo_readiness", T0, T0]);
  await run("UPDATE award_outcomes SET tabulation_artifact_id = ? WHERE id = ?", ["art-D1", "ao-N7"]);

  const demoBidIds = [...DEMO_BID_IDS.demoReadiness, ...DEMO_BID_IDS.mockSeed];
  const dependentsPerTable: Record<string, number> = {};
  for (const table of [...DIRECT_BID_CHILD_TABLES, ...INDIRECT_BID_CHILD_TABLES]) dependentsPerTable[table] = demoBidIds.length;
  return {
    demoBidIds,
    keepBidIds: [...NEAR_MISS_BID_IDS],
    dependentsPerTable,
    knowledgeItemsDetached: ["ki-D1", "ki-D2", "ki-M1", "ki-M2", "ki-cross"],
    awardOutcomesDetached: ["ao-N7"],
    tags,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Scenario 4: the data:integrity report. Rows at every level with known metric contributions.
// ---------------------------------------------------------------------------------------------------------------

export const INTEGRITY_LEVELS = ["state", "county", "city", "township", "federal", "other"] as const;
export type IntegrityLevel = (typeof INTEGRITY_LEVELS)[number];

export interface LevelExpectation {
  total: number;
  open: number;
  closed: number;
  awarded: number;
  identityMismatch: number;
  unregistered: number;
  demoLike: number;
  nonCanonicalId: number;
  withBody: number;
  detailLockedAtSource: number;
  withIssuer: number;
  deadlineParseable: number;
  withSourceUrl: number;
  expiredOpen: number;
  sources: number;
  neverSucceeded: number;
  succeededWithin2d: number;
  succeededWithin7d: number;
  failing: number;
}

export interface IntegrityExpectations {
  levels: Record<IntegrityLevel, LevelExpectation>;
  malformedNyIds: string[];
  /** Ids used by the compare scenario. */
  removedId: string;
  regressionId: string;
  retypedId: string;
  demoId: string;
  driftId: string;
}

const hoursBefore = (base: number, hours: number) => new Date(base - hours * 3_600_000).toISOString();

interface IntegrityBidSpec extends BidSeed {
  level: IntegrityLevel;
  registered: boolean;
  demo?: boolean;
  nonCanonical?: boolean;
  identityMismatch?: boolean;
  hasBody?: boolean;
  locked?: boolean;
  deadlineParseable?: boolean;
  expired?: boolean;
}

/**
 * Seed the integrity scenario. `baseNowMs` is the wall clock the report will run at (the CLI has no `--now`), so
 * deadlines are far in the past (2020) or far in the future (2099) and source health timestamps are relative.
 */
export async function seedIntegrityScenario(run: SqlRunner, baseNowMs: number): Promise<IntegrityExpectations> {
  await seedSources(run, [
    { id: "tx_esbd", issuerType: "state", stateCode: "TX", lastSuccessAt: hoursBefore(baseNowMs, 24) },
    { id: NY_SOURCE, issuerType: "state", stateCode: "NY", lastFailureAt: hoursBefore(baseNowMs, 2), consecutiveFailures: 3 },
    { id: "ca_caleprocure", issuerType: "state", stateCode: "CA", lastSuccessAt: hoursBefore(baseNowMs, 5 * 24) },
    { id: "sam_gov", issuerType: "federal", stateCode: "US", lastSuccessAt: hoursBefore(baseNowMs, 12 * 24) },
    { id: "bidnet_co_boulder", issuerType: "county", stateCode: "CO", jurisdictionLevel: "county", fipsCode: "08013", lastSuccessAt: hoursBefore(baseNowMs, 60) },
    { id: "bidnet_co_larimer", issuerType: "county", stateCode: "CO", jurisdictionLevel: "county", fipsCode: "08069", lastFailureAt: hoursBefore(baseNowMs, 1), consecutiveFailures: 1 },
    { id: "bidnet_co_aurora", issuerType: "city", stateCode: "CO", jurisdictionLevel: "city", fipsCode: "0804000", lastSuccessAt: hoursBefore(baseNowMs, 12) },
    { id: "bidnet_co_denver_disabled", issuerType: "city", stateCode: "CO", jurisdictionLevel: "city", fipsCode: "0820000", isEnabled: 0, lastSuccessAt: hoursBefore(baseNowMs, 1) },
    { id: "bidnet_mi_canton", issuerType: "township", stateCode: "MI", jurisdictionLevel: "township", fipsCode: "2616314000", lastSuccessAt: hoursBefore(baseNowMs, 24) },
  ]);

  const BODY = "Furnish and install replacement HVAC units at the county office complex, including controls.";
  const FUTURE = "12/31/2099";
  const PAST = "01/01/2020";
  const specs: IntegrityBidSpec[] = [
    // --- state ---
    { level: "state", registered: true, id: "tx_esbd:1", issuerType: "state", stateCode: "TX", description: BODY, deadlineDate: FUTURE, hasBody: true, deadlineParseable: true, lastSeenAt: hoursBefore(baseNowMs, 6) },
    { level: "state", registered: true, id: "tx_esbd:2", issuerType: "state", stateCode: "TX", issuerName: "Unknown state agency", deadlineDate: "TBD" },
    { level: "state", registered: true, id: "tx_esbd:3", issuerType: "state", stateCode: "TX", lifecycleStatus: "closed", description: BODY, deadlineDate: PAST },
    { level: "state", registered: true, id: `${NY_SOURCE}:2138289 Company: E.W. Howell Co., LLC.`, source: NY_SOURCE, sourceBidId: "2138289 Company: E.W. Howell Co., LLC.", issuerType: "state", stateCode: "NY", issuerName: "Unknown state agency", deadlineDate: FUTURE, deadlineParseable: true },
    { level: "state", registered: false, id: "orphan_source:9", issuerType: "state", stateCode: "TX", issuerName: "Orphan Agency", description: BODY, hasBody: true, deadlineDate: FUTURE, deadlineParseable: true },
    { level: "state", registered: false, demo: true, id: "al_state_procurement_demo_readiness", source: "al_state_procurement", sourceBidId: "demo:al_state_procurement", issuerType: "state", stateCode: "AL", description: BODY, hasBody: true, deadlineDate: "2099-12-01", deadlineParseable: true },
    { level: "state", registered: true, id: "tx_esbd:7", issuerType: "state", stateCode: "TX", description: BODY, hasBody: true, deadlineDate: PAST, deadlineParseable: true, expired: true },
    { level: "state", registered: true, id: "tx_esbd:8", issuerType: "state", stateCode: "TX", lifecycleStatus: "awarded", awardedDate: "2026-09-01", description: BODY, deadlineDate: PAST },
    { level: "state", registered: true, id: "tx_esbd:9", issuerType: "state", stateCode: "TX", displayStatus: "suppressed", description: BODY, hasBody: true, deadlineDate: FUTURE, deadlineParseable: true },
    { level: "state", registered: true, id: "tx_esbd:10", issuerType: "state", stateCode: "TX", sourceUrl: "", description: BODY, hasBody: true, deadlineDate: FUTURE, deadlineParseable: true },
    { level: "state", registered: true, identityMismatch: true, id: "tx_esbd:11", issuerType: "state", stateCode: "OK", description: BODY, hasBody: true, deadlineDate: FUTURE, deadlineParseable: true },
    // A FIPS-drifted legacy row: typed state, under a city source. Counts under 'state', and is an identity mismatch.
    { level: "state", registered: true, identityMismatch: true, id: "bidnet_co_aurora:drift", issuerType: "state", stateCode: "CO", fipsCode: "0800001", description: BODY, hasBody: true, deadlineDate: FUTURE, deadlineParseable: true },
    // --- county ---
    { level: "county", registered: true, locked: true, id: "bidnet_co_boulder:1", issuerType: "county", stateCode: "CO", jurisdictionLevel: "county", fipsCode: "08013", rawPayload: JSON.stringify({ detail_access: { platform: "bidnet", restricted: ["description"] } }), deadlineDate: FUTURE, deadlineParseable: true },
    { level: "county", registered: true, identityMismatch: true, id: "bidnet_co_boulder:2", issuerType: "county", stateCode: "CO", jurisdictionLevel: "county", fipsCode: "08014", description: BODY, hasBody: true, deadlineDate: FUTURE, deadlineParseable: true },
    { level: "county", registered: true, id: "bidnet_co_boulder:3", issuerType: "county", stateCode: "CO", jurisdictionLevel: "county", fipsCode: "08013", lifecycleStatus: "closed", description: BODY, deadlineDate: PAST },
    { level: "county", registered: true, id: "bidnet_co_larimer:1", issuerType: "county", stateCode: "CO", jurisdictionLevel: "county", fipsCode: "08069", description: BODY, hasBody: true, deadlineDate: FUTURE, deadlineParseable: true },
    // --- city ---
    { level: "city", registered: true, id: "bidnet_co_aurora:1", issuerType: "city", stateCode: "CO", jurisdictionLevel: "city", fipsCode: "0804000", description: BODY, hasBody: true, deadlineDate: FUTURE, deadlineParseable: true },
    { level: "city", registered: true, nonCanonical: true, id: "bidnet_co_aurora:x1", sourceBidId: "zzz", issuerType: "city", stateCode: "CO", jurisdictionLevel: "city", fipsCode: "0804000", description: BODY, hasBody: true, deadlineDate: FUTURE, deadlineParseable: true },
    { level: "city", registered: true, id: "bidnet_co_aurora:4", issuerType: "city", stateCode: "CO", jurisdictionLevel: "city", fipsCode: "0804000", description: BODY, hasBody: true, deadlineDate: "2020-01-01T11:00:00Z", deadlineParseable: true, expired: true },
    // --- township ---
    { level: "township", registered: true, id: "bidnet_mi_canton:1", issuerType: "township", stateCode: "MI", jurisdictionLevel: "township", fipsCode: "2616314000", description: BODY, hasBody: true, deadlineDate: FUTURE, deadlineParseable: true },
    { level: "township", registered: true, id: "bidnet_mi_canton:2", issuerType: "township", stateCode: "MI", jurisdictionLevel: "township", fipsCode: "2616314000", issuerName: "Unknown township", description: BODY, hasBody: true, deadlineDate: FUTURE, deadlineParseable: true },
    // --- federal / other ---
    { level: "federal", registered: true, id: "sam_gov:F1", issuerType: "federal", stateCode: "US", description: BODY, hasBody: true, deadlineDate: FUTURE, deadlineParseable: true },
    { level: "other", registered: false, id: "weird:1", issuerType: "tribal", stateCode: "AZ", description: BODY, hasBody: true, deadlineDate: FUTURE, deadlineParseable: true },
  ];
  await seedBids(run, specs);

  const sourceHealth: Record<IntegrityLevel, Pick<LevelExpectation, "sources" | "neverSucceeded" | "succeededWithin2d" | "succeededWithin7d" | "failing">> = {
    state: { sources: 3, neverSucceeded: 1, succeededWithin2d: 1, succeededWithin7d: 2, failing: 1 },
    county: { sources: 2, neverSucceeded: 1, succeededWithin2d: 0, succeededWithin7d: 1, failing: 1 },
    city: { sources: 1, neverSucceeded: 0, succeededWithin2d: 1, succeededWithin7d: 1, failing: 0 },
    township: { sources: 1, neverSucceeded: 0, succeededWithin2d: 1, succeededWithin7d: 1, failing: 0 },
    federal: { sources: 1, neverSucceeded: 0, succeededWithin2d: 0, succeededWithin7d: 0, failing: 0 },
    other: { sources: 0, neverSucceeded: 0, succeededWithin2d: 0, succeededWithin7d: 0, failing: 0 },
  };

  const levels = Object.fromEntries(INTEGRITY_LEVELS.map((level) => {
    const rows = specs.filter((spec) => spec.level === level);
    const open = rows.filter((spec) => (spec.lifecycleStatus ?? "open") === "open");
    const count = (predicate: (spec: IntegrityBidSpec) => boolean) => open.filter(predicate).length;
    const expectation: LevelExpectation = {
      total: rows.length,
      open: open.length,
      closed: rows.filter((spec) => spec.lifecycleStatus === "closed").length,
      awarded: rows.filter((spec) => spec.lifecycleStatus === "awarded").length,
      identityMismatch: rows.filter((spec) => spec.identityMismatch).length,
      unregistered: rows.filter((spec) => !spec.registered).length,
      demoLike: rows.filter((spec) => spec.demo).length,
      nonCanonicalId: rows.filter((spec) => spec.nonCanonical).length,
      withBody: count((spec) => Boolean(spec.hasBody)),
      detailLockedAtSource: count((spec) => Boolean(spec.locked)),
      withIssuer: count((spec) => !(spec.issuerName ?? "Issuer").startsWith("Unknown")),
      deadlineParseable: count((spec) => Boolean(spec.deadlineParseable)),
      withSourceUrl: count((spec) => spec.sourceUrl !== ""),
      expiredOpen: count((spec) => Boolean(spec.expired)),
      ...sourceHealth[level],
    };
    return [level, expectation];
  })) as Record<IntegrityLevel, LevelExpectation>;

  return {
    levels,
    malformedNyIds: [`${NY_SOURCE}:2138289 Company: E.W. Howell Co., LLC.`],
    removedId: "tx_esbd:1",
    regressionId: "bidnet_co_aurora:1",
    retypedId: "bidnet_mi_canton:1",
    demoId: "al_state_procurement_demo_readiness",
    driftId: "bidnet_co_aurora:drift",
  };
}
