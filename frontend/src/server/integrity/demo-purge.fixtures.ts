/**
 * Seed data shared by the SQLite test (demo-purge.test.ts) and the real-MySQL integration test
 * (demo-purge.mysql.integration.test.ts) of the demo/seed bid purge, so both dialects are held to the same
 * scenario and the same assertions. Rows are plain `INSERT INTO <table> (<columns>) VALUES (?, ...)` values.
 *
 * Eight bids:
 *   - two demo-readiness bids (`npm run demo:prepare` shape) and two mock seed bids (`db:seed` shape), which the
 *     purge must remove with every dependent row;
 *   - four bids that must survive: a real registered-source bid, an unregistered bid that matches no marker, and
 *     two look-alikes (an all-digit id without the `mock:` marker, an `_demo_readiness` id without `demo:`).
 * Every bid owns one row in every table that references `bids` (directly or through an intent, a workspace item,
 * an artifact, a quote request, a snapshot or an export), plus knowledge items that point back at it.
 */

export type SeedValue = string | number | null;

export interface SeedRow {
  table: string;
  values: Record<string, SeedValue>;
  /** The bid the row belongs to; null for shared rows (users, organisations, sources, partners, ...). */
  owner: string | null;
  /** The owner is a demo or seed bid, so the purge removes the row (knowledge items excepted). */
  demo: boolean;
}

export const SEED_AT = "2026-10-13T00:00:00.000Z";

export const REAL_BID_ID = "ca_caleprocure:RFQ-1001";
/** Its id prefix `orphan_source` is no data_sources.id, but it carries no demo or mock marker: it must survive. */
const UNREGISTERED_BID_ID = "orphan_source:9";
/** All digits, but its source_bid_id is not `mock:7`. */
const NUMERIC_LOOKALIKE_BID_ID = "7";
/** Ends with `_demo_readiness`, but its source_bid_id does not start with `demo:`. */
const SUFFIX_LOOKALIKE_BID_ID = "custom_demo_readiness";
export const SURVIVOR_BID_IDS: readonly string[] = [
  REAL_BID_ID,
  UNREGISTERED_BID_ID,
  NUMERIC_LOOKALIKE_BID_ID,
  SUFFIX_LOOKALIKE_BID_ID,
];

const REGISTERED_SOURCE_IDS = ["ca_caleprocure", "al_state_procurement", "wa_state_procurement"] as const;

interface SeedBid {
  id: string;
  source: string;
  sourceBidId: string;
  stateCode: string;
  demo: boolean;
}

const SEED_BIDS: readonly SeedBid[] = [
  { id: "al_state_procurement_demo_readiness", source: "Alabama State Procurement", sourceBidId: "demo:al_state_procurement", stateCode: "AL", demo: true },
  { id: "wa_state_procurement_demo_readiness", source: "Washington State Procurement", sourceBidId: "demo:wa_state_procurement", stateCode: "WA", demo: true },
  { id: "1", source: "Mock Source", sourceBidId: "mock:1", stateCode: "CA", demo: true },
  { id: "2", source: "Mock Source", sourceBidId: "mock:2", stateCode: "TX", demo: true },
  { id: REAL_BID_ID, source: "California Cal eProcure", sourceBidId: "RFQ-1001", stateCode: "CA", demo: false },
  { id: UNREGISTERED_BID_ID, source: "Orphan Source", sourceBidId: "9", stateCode: "OH", demo: false },
  { id: NUMERIC_LOOKALIKE_BID_ID, source: "Legacy Numbers", sourceBidId: "7", stateCode: "NY", demo: false },
  { id: SUFFIX_LOOKALIKE_BID_ID, source: "Custom Portal", sourceBidId: "custom", stateCode: "FL", demo: false },
];

export interface SeedOptions {
  /** More demo-readiness bids on top of the two above, to reach the real data's 50. */
  extraDemoReadiness?: number;
  /** More mock bids on top of the two above, to reach the real data's 6. */
  extraMock?: number;
}

function seedBids({ extraDemoReadiness = 0, extraMock = 0 }: SeedOptions): SeedBid[] {
  const extra: SeedBid[] = [];
  for (let n = 1; n <= extraDemoReadiness; n += 1) {
    extra.push({ id: `gen${n}_state_procurement_demo_readiness`, source: `Generated State ${n}`, sourceBidId: `demo:gen${n}_state_procurement`, stateCode: "GA", demo: true });
  }
  for (let n = 1; n <= extraMock; n += 1) {
    extra.push({ id: String(100 + n), source: "Mock Source", sourceBidId: `mock:${100 + n}`, stateCode: "NV", demo: true });
  }
  return [...SEED_BIDS, ...extra];
}

/** Primary-key columns of the tables the seed writes, for reading a row back. */
const SEED_KEY_COLUMNS: Record<string, readonly string[]> = {
  saved_bids: ["user_id", "bid_id"],
  response_workspace_item_artifacts: ["item_id", "artifact_id"],
  quote_request_artifacts: ["quote_request_id", "artifact_id"],
};

export function seedKeyColumns(table: string): readonly string[] {
  return SEED_KEY_COLUMNS[table] ?? ["id"];
}

export function seedRowKey(row: SeedRow): string {
  return seedKeyColumns(row.table).map((column) => String(row.values[column])).join("|");
}

/** The part of a bid id that goes into the ids of its rows (`intent_<tag>`, `item_<tag>_1`, ...). */
export const seedTag = (bidId: string) => bidId.replace(/[^A-Za-z0-9]/g, "_");

function sharedRows(): SeedRow[] {
  const shared = (table: string, values: Record<string, SeedValue>): SeedRow => ({ table, values, owner: null, demo: false });
  return [
    shared("users", { id: "u_alice", email: "alice@example.test", display_name: "Alice", created_at: SEED_AT, updated_at: SEED_AT }),
    shared("users", { id: "u_bob", email: "bob@example.test", display_name: "Bob", created_at: SEED_AT, updated_at: SEED_AT }),
    shared("organizations", { id: "org_acme", name: "Acme Supply", created_at: SEED_AT, updated_at: SEED_AT }),
    shared("sourcing_partners", {
      id: "partner_1", organization_id: "org_acme", created_by_user_id: "u_alice", name: "Partner One",
      created_at: SEED_AT, updated_at: SEED_AT,
    }),
    ...REGISTERED_SOURCE_IDS.map((id) => shared("data_sources", {
      id, label: `${id} label`, issuer_type: "state", state_code: id.slice(0, 2).toUpperCase(),
      created_at: SEED_AT, updated_at: SEED_AT,
    })),
    // Nothing points at it: the purge must not touch it.
    shared("knowledge_items", {
      id: "ki_unrelated", organization_id: "org_acme", created_by_user_id: "u_alice", title: "Unrelated note",
      body: "No source.", type: "note", source_kind: "manual", source_intent_id: null, source_bid_id: null,
      created_at: SEED_AT, updated_at: SEED_AT,
    }),
  ];
}

/** Every row a bid owns, parents before children so that SQLite's foreign keys accept the inserts in order. */
function bidRows(bid: SeedBid): SeedRow[] {
  const t = seedTag(bid.id);
  const own = (table: string, values: Record<string, SeedValue>): SeedRow => ({ table, values, owner: bid.id, demo: bid.demo });
  const intent = `intent_${t}`;
  const bidRef = { bid_id: bid.id };
  const intentRef = { intent_id: intent, ...bidRef };
  const artifact = `artifact_${t}`;
  const item1 = `item_${t}_1`;
  const snapshot = `snapshot_${t}`;
  const exportId = `export_${t}`;
  const quote = `quote_${t}`;
  const file = {
    file_name: `${t}.pdf`, content_type: "application/pdf", byte_size: 1024,
    storage_path: `vault/${t}.pdf`, checksum_sha256: "0".repeat(64),
  };

  return [
    own("bids", {
      id: bid.id, source: bid.source, source_bid_id: bid.sourceBidId, dedupe_key: `dedupe:${bid.id}`,
      title: `Bid ${bid.id}`, description: "Seed bid", issuer_name: `Issuer ${bid.id}`, issuer_type: "state",
      state_code: bid.stateCode, source_url: `https://example.test/bids/${t}`,
      first_seen_at: SEED_AT, last_seen_at: SEED_AT, created_at: SEED_AT, updated_at: SEED_AT,
    }),
    own("bid_attachments", { id: `attachment_${t}_1`, ...bidRef, name: "Scope.pdf", url: `https://example.test/${t}/1.pdf`, created_at: SEED_AT }),
    own("bid_attachments", { id: `attachment_${t}_2`, ...bidRef, name: "Terms.pdf", url: `https://example.test/${t}/2.pdf`, created_at: SEED_AT }),
    own("bid_field_corrections", {
      id: `correction_${t}`, ...bidRef, field_name: "title", corrected_by: "u_alice", corrected_at: SEED_AT,
    }),
    own("saved_bids", { user_id: "u_alice", ...bidRef, created_at: SEED_AT }),
    own("intent_to_bid", { id: intent, user_id: "u_alice", ...bidRef, created_at: SEED_AT, updated_at: SEED_AT }),
    own("submission_paths", { id: `path_${t}`, ...intentRef, user_id: "u_alice", created_at: SEED_AT, updated_at: SEED_AT }),
    own("submission_confirmations", {
      id: `confirmation_${t}`, intent_id: intent, user_id: "u_alice", submitted_at: SEED_AT, method: "portal",
      created_at: SEED_AT, updated_at: SEED_AT,
    }),
    own("compliance_manifest_items", {
      id: `manifest_${t}`, ...intentRef, user_id: "u_alice", title: "Insurance certificate", category: "insurance",
      created_at: SEED_AT, updated_at: SEED_AT,
    }),
    own("pursuit_decisions", {
      id: `pursuit_${t}`, ...intentRef, user_id: "u_alice", decision: "pursue", created_at: SEED_AT, updated_at: SEED_AT,
    }),
    own("supplier_artifacts", {
      id: artifact, ...intentRef, user_id: "u_alice", title: "Capability statement", artifact_type: "capability",
      purpose: "bid", ...file, created_at: SEED_AT, updated_at: SEED_AT,
    }),
    own("artifact_versions", {
      id: `version_${t}`, artifact_id: artifact, ...intentRef, user_id: "u_alice", version_number: 1,
      title: "Capability statement", ...file, created_by_user_id: "u_alice", created_at: SEED_AT,
    }),
    own("award_outcomes", {
      id: `award_${t}`, organization_id: "org_acme", ...intentRef, user_id: "u_alice",
      tabulation_artifact_id: artifact, created_at: SEED_AT, updated_at: SEED_AT,
    }),
    own("response_workspace_items", {
      id: item1, ...intentRef, user_id: "u_alice", kind: "section", title: "Executive summary",
      created_at: SEED_AT, updated_at: SEED_AT,
    }),
    own("response_workspace_items", {
      id: `item_${t}_2`, ...intentRef, user_id: "u_alice", kind: "section", title: "Pricing",
      created_at: SEED_AT, updated_at: SEED_AT,
    }),
    own("response_workspace_comments", {
      id: `comment_${t}`, intent_id: intent, item_id: item1, author_user_id: "u_alice", body: "Looks good.",
      created_at: SEED_AT, updated_at: SEED_AT,
    }),
    own("response_workspace_activity", {
      id: `activity_${t}`, intent_id: intent, item_id: item1, actor_user_id: "u_alice", event_type: "status_changed",
      created_at: SEED_AT,
    }),
    own("response_workspace_item_artifacts", { item_id: item1, artifact_id: artifact, created_at: SEED_AT }),
    own("response_package_snapshots", {
      id: snapshot, ...intentRef, user_id: "u_alice", created_by_user_id: "u_alice", title: "Package v1", created_at: SEED_AT,
    }),
    own("response_package_exports", {
      id: exportId, snapshot_id: snapshot, ...intentRef, user_id: "u_alice", requested_by_user_id: "u_alice",
      ...file, created_at: SEED_AT, updated_at: SEED_AT,
    }),
    own("response_package_export_review_events", {
      id: `review_${t}`, export_id: exportId, snapshot_id: snapshot, ...intentRef, user_id: "u_alice",
      actor_user_id: "u_bob", from_review_status: "pending_review", to_review_status: "approved", created_at: SEED_AT,
    }),
    own("quote_requests", {
      id: quote, organization_id: "org_acme", ...intentRef, partner_id: "partner_1", created_by_user_id: "u_alice",
      title: "Quote request", created_at: SEED_AT, updated_at: SEED_AT,
    }),
    own("quote_request_artifacts", { quote_request_id: quote, artifact_id: artifact, created_at: SEED_AT }),
    own("deadline_reminders", {
      id: `reminder_${t}`, organization_id: "org_acme", user_id: "u_alice", ...intentRef, kind: "bid_deadline",
      linked_object_type: "bid", linked_object_id: bid.id, dedupe_key: `reminder:${bid.id}`, title: "Deadline",
      due_at: SEED_AT, reminder_at: SEED_AT, created_at: SEED_AT, updated_at: SEED_AT,
    }),
    // Knowledge items outlive the bid. One points at the bid and its intent, one only at the intent.
    own("knowledge_items", {
      id: `knowledge_${t}`, organization_id: "org_acme", created_by_user_id: "u_alice", title: `Lessons ${bid.id}`,
      body: "Worth remembering.", type: "lesson", source_kind: "intent", source_intent_id: intent, source_bid_id: bid.id,
      created_at: SEED_AT, updated_at: SEED_AT,
    }),
    own("knowledge_items", {
      id: `knowledge_${t}_intent_only`, organization_id: "org_acme", created_by_user_id: "u_alice",
      title: `Intent note ${bid.id}`, body: "Only the intent.", type: "note", source_kind: "intent",
      source_intent_id: intent, source_bid_id: null, created_at: SEED_AT, updated_at: SEED_AT,
    }),
  ];
}

/** The whole seed, parents first. */
export function buildDemoPurgeSeed(options: SeedOptions = {}): SeedRow[] {
  const perBid = seedBids(options).flatMap(bidRows);
  // The shared rows need nothing but each other; every bid-owned row needs its `bids` row, and the rest of a bid's
  // rows come in the order bidRows() wrote them.
  return [
    ...sharedRows(),
    ...perBid.filter((row) => row.table === "bids"),
    ...perBid.filter((row) => row.table !== "bids"),
  ];
}

/**
 * Rows the purge removes, per table, for the four demo bids above: one of each dependent row per bid, except two
 * attachments and two workspace items. Written out so that a change to the seed or to the purge shows up here.
 */
export const EXPECTED_DEMO_DEPENDENTS: Record<string, number> = {
  response_package_export_review_events: 4,
  response_package_exports: 4,
  response_package_snapshots: 4,
  response_workspace_comments: 4,
  response_workspace_activity: 4,
  response_workspace_item_artifacts: 4,
  quote_request_artifacts: 4,
  artifact_versions: 4,
  award_outcomes: 4,
  quote_requests: 4,
  supplier_artifacts: 4,
  response_workspace_items: 8,
  submission_confirmations: 4,
  submission_paths: 4,
  compliance_manifest_items: 4,
  pursuit_decisions: 4,
  deadline_reminders: 4,
  bid_attachments: 8,
  bid_field_corrections: 4,
  saved_bids: 4,
  intent_to_bid: 4,
};

/** Two knowledge items per demo bid lose a link; `ki_unrelated` and the survivors' items are untouched. */
export const EXPECTED_KNOWLEDGE_ITEMS_TO_DETACH = 8;

/** EXPECTED_DEMO_DEPENDENTS for a seed with `demoBidCount` demo bids instead of four. */
export function expectedDemoDependents(demoBidCount: number): Record<string, number> {
  return Object.fromEntries(Object.entries(EXPECTED_DEMO_DEPENDENTS).map(([table, count]) => [table, (count / 4) * demoBidCount]));
}

/** True for a row that belongs to a demo or seed bid. */
export function isDemoOwned(row: SeedRow): boolean {
  return row.demo;
}

/**
 * For every seeded row, whether it is still there after a purge of the demo bids: the demo bids and their
 * dependents are gone, knowledge items and everything else stay.
 */
export function expectedPresence(rows: readonly SeedRow[], { purged }: { purged: boolean }): Array<{ table: string; key: string; present: boolean }> {
  return rows.map((row) => ({
    table: row.table,
    key: seedRowKey(row),
    present: !(purged && isDemoOwned(row) && row.table !== "knowledge_items"),
  }));
}

/** The INSERT for one row: `INSERT INTO <table> (<columns>) VALUES (?, ...)` and its values. */
export function insertStatement(row: SeedRow): { sql: string; params: SeedValue[] } {
  const columns = Object.keys(row.values);
  return {
    sql: `INSERT INTO ${row.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    params: columns.map((column) => row.values[column]),
  };
}
