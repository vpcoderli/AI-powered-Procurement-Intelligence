import { CrawlerLeaseLostError, type CrawlerLeaseFence } from "./execution-context";

/** Called with the lease row read on the transaction's own connection. */
export function assertPersistenceLease(
  lease: CrawlerLeaseFence,
  row: { owner: string; expiresAt: string } | null | undefined,
) {
  if (lease.signal?.aborted || row?.owner !== lease.owner ||
    !(Date.parse(row.expiresAt) > Date.parse(lease.now()))) {
    throw new CrawlerLeaseLostError();
  }
}
