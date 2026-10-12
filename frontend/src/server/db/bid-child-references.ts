/**
 * Every column that points at bids(id): the sixteen bid_id child tables plus knowledge_items.source_bid_id.
 *
 * A bid that has any such row can be neither re-keyed nor deleted by a data migration without touching user
 * data. SQLite declares these as foreign keys (ON DELETE CASCADE, except knowledge_items: ON DELETE SET NULL;
 * none has ON UPDATE CASCADE), so a delete would silently cascade and a re-key would abort the whole migration.
 * MySQL has no foreign keys at all, so a re-key or delete there would silently orphan the rows. Soft, unkeyed
 * mentions of a bid id (notification_outbox.matched_bid_ids, event_log.target_id, ...) are history, not children.
 *
 * ny-subcontract-rekey.test.ts pins this list against the foreign keys the SQLite schema really declares, so a
 * table added later cannot be forgotten.
 */
export interface BidChildReference {
  table: string;
  column: string;
}

export const BID_CHILD_REFERENCES: readonly BidChildReference[] = [
  { table: "bid_attachments", column: "bid_id" },
  { table: "bid_field_corrections", column: "bid_id" },
  { table: "saved_bids", column: "bid_id" },
  { table: "intent_to_bid", column: "bid_id" },
  { table: "submission_paths", column: "bid_id" },
  { table: "award_outcomes", column: "bid_id" },
  { table: "compliance_manifest_items", column: "bid_id" },
  { table: "pursuit_decisions", column: "bid_id" },
  { table: "response_workspace_items", column: "bid_id" },
  { table: "response_package_snapshots", column: "bid_id" },
  { table: "response_package_exports", column: "bid_id" },
  { table: "response_package_export_review_events", column: "bid_id" },
  { table: "supplier_artifacts", column: "bid_id" },
  { table: "artifact_versions", column: "bid_id" },
  { table: "quote_requests", column: "bid_id" },
  { table: "deadline_reminders", column: "bid_id" },
  { table: "knowledge_items", column: "source_bid_id" },
];

/**
 * One `NOT EXISTS (...)` predicate per child reference, joined by AND: true only for a bid nothing else points
 * at. The same text is valid in SQLite and MySQL. `bidIdExpression` is the bid's id as the enclosing statement
 * spells it (`bids.id`).
 */
export function noBidChildRowsSql(bidIdExpression = "bids.id"): string {
  return BID_CHILD_REFERENCES
    .map(({ table, column }) => `NOT EXISTS (SELECT 1 FROM ${table} WHERE ${table}.${column} = ${bidIdExpression})`)
    .join(" AND ");
}
