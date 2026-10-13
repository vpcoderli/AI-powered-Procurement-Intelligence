import { matchesExpectedSourceNamespace } from "@/lib/source-identity";
import { createImportQualityGate, evaluateCrawlerBid, existingIdentityIssues, qualityRecord, stampPersistedBidQuality } from "./data-quality";
import { mergePersistedAttachments, mergePersistedBid } from "./persistence-merge";
import { delistingApplies, withLifecycleMetadata } from "./lifecycle";
import { validateCrawlerImport } from "./persistence-errors";

type BidRow = Record<string, unknown>;
type ImportCounts = Pick<CrawlerJsonImportResult, "fetchedCount" | "insertedCount" | "updatedCount">;

export interface CrawlerJsonImportResult {
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  logCount: number;
  delistedCount?: number;
}

export interface CrawlerJsonRunPayload {
  source: string;
  runId: string;
  status: "success" | "failure";
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  metadata?: BidRow | null;
  bids?: BidRow[];
  errorCode?: string | null;
  errorMessage?: string | null;
  errorStack?: string | null;
}

/** Bid-specific persistence operations performed on the caller's transaction. */
export interface BidIntakeStore {
  findBid(id: string, dedupeKey: string): BidRow | null | undefined;
  readAttachments(bidId: string): BidRow[];
  writeBid(row: BidRow): void;
  writeAttachments(bidId: string, rows: BidRow[], existing: BidRow[]): void;
  delistMissingOpenBids(source: string, seen: Set<string>, at: string): number;
  writeLog(payload: CrawlerJsonRunPayload, counts: ImportCounts): void;
}

export type AsyncBidIntakeStore = {
  [Key in keyof BidIntakeStore]: (...args: Parameters<BidIntakeStore[Key]>) => Promise<ReturnType<BidIntakeStore[Key]>>;
};

export interface BidIntakeOutcome {
  result: CrawlerJsonImportResult;
  metadata: CrawlerJsonRunPayload["metadata"];
}

/**
 * The single domain workflow. Yielding transaction operations lets the SQLite driver stay
 * synchronous while MySQL awaits the same reads and writes. SQL and lease mechanics live
 * in the adapters; candidate admission, effective snapshots and log ordering live here.
 */
function* bidIntake(payload: CrawlerJsonRunPayload, store: BidIntakeStore | AsyncBidIntakeStore): Generator<unknown, BidIntakeOutcome, unknown> {
  validateCrawlerImport(payload);
  const gate = createImportQualityGate(payload);
  const expectedSourceId = qualityRecord(payload.metadata?.sourceIdentity).id;
  let insertedCount = 0;
  let updatedCount = 0;
  const seen = new Set<string>();
  for (const { row, index } of gate.rows) {
    const prior = (yield store.findBid(String(row.id), String(row.dedupe_key ?? ""))) as BidRow | null | undefined;
    const id = String(prior?.id ?? row.id);
    // Dedupe lookup can select a different persisted ID, even when the candidate namespace is valid.
    if (!matchesExpectedSourceNamespace(id, expectedSourceId)) {
      // Admission may derive a blank ID; retain the original incoming evidence in diagnostics.
      gate.quarantine(qualityRecord(payload.bids?.[index]), index, ["source_identity_mismatch:id"]);
      continue;
    }
    const identityIssues = prior && evaluateCrawlerBid(prior).coreValid ? existingIdentityIssues(row, prior) : [];
    if (identityIssues.length) {
      gate.quarantine(row, index, identityIssues);
      continue;
    }
    const existingAttachments = (yield store.readAttachments(id)) as BidRow[];
    const incomingAttachments = Array.isArray(row.attachments) ? row.attachments as BidRow[] : [];
    const attachments = mergePersistedAttachments(existingAttachments, incomingAttachments, id);
    const merged = stampPersistedBidQuality(row,
      { ...mergePersistedBid(row, prior ?? undefined, { now: payload.finishedAt ?? payload.startedAt }), id, attachments },
      prior ?? undefined, gate.manifest.checkedAt);
    yield store.writeBid(merged);
    // Do not rewrite unobserved files; assess them in the effective snapshot above.
    if (incomingAttachments.length) yield store.writeAttachments(id, attachments, existingAttachments);
    if (prior) updatedCount += 1;
    else insertedCount += 1;
    seen.add(id);
    gate.accepted(id, merged);
  }
  const qualityPayload = gate.finish();
  const delisted = delistingApplies(qualityPayload)
    ? (yield store.delistMissingOpenBids(payload.source, seen, payload.finishedAt ?? payload.startedAt)) as number
    : null;
  const counts = { fetchedCount: payload.bids?.length ?? 0, insertedCount, updatedCount };
  const loggedPayload = delisted === null ? qualityPayload : withLifecycleMetadata(qualityPayload, delisted);
  yield store.writeLog(loggedPayload, counts);
  return { result: { ...counts, logCount: 1, ...(delisted === null ? {} : { delistedCount: delisted }) }, metadata: loggedPayload.metadata };
}

/** Returns metadata for the adapter to publish only after its transaction commits. */
export function intakeCrawlerRun(payload: CrawlerJsonRunPayload, store: BidIntakeStore): BidIntakeOutcome {
  const workflow = bidIntake(payload, store);
  let step = workflow.next();
  while (!step.done) step = workflow.next(step.value);
  return step.value;
}

export async function intakeCrawlerRunAsync(payload: CrawlerJsonRunPayload, store: AsyncBidIntakeStore): Promise<BidIntakeOutcome> {
  const workflow = bidIntake(payload, store);
  let step = workflow.next();
  while (!step.done) step = workflow.next(await step.value);
  return step.value;
}
