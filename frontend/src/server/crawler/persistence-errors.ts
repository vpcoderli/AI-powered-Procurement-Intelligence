import type { CrawlerJsonRunPayload } from "./mysql-json-importer";
import { CrawlerLeaseLostError } from "./execution-context";

export class CrawlerPersistenceError extends Error {
  failureLogged = false;

  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = "CrawlerPersistenceError";
  }
}

export function persistenceFailurePayload(payload: CrawlerJsonRunPayload, error: unknown): CrawlerJsonRunPayload {
  return {
    ...payload,
    status: "failure",
    finishedAt: new Date().toISOString(),
    bids: [],
    errorCode: error instanceof CrawlerLeaseLostError ? "CrawlerLeaseLostError" : "CrawlerPersistenceError",
    errorMessage: error instanceof Error ? error.message : String(error),
    errorStack: error instanceof Error ? error.stack : null,
    metadata: { ...payload.metadata, persistence: { status: "failure", fetchedBeforePersistence: Array.isArray(payload.bids) ? payload.bids.length : 0 } },
  };
}

/**
 * Contract C1: a list page the crawler positively identified as a *verified* empty state —
 * HTTP 200, an explicit "no open bids" phrase, and the tenant's own name on the page. Both
 * flags must be true: `verified` alone (without `tenant_confirmed`) can be a 200 from the
 * wrong tenant path, which must stay a normal empty-result failure.
 */
export function hasVerifiedEmptyState(metadata: CrawlerJsonRunPayload["metadata"]): boolean {
  const emptyState = metadata?.emptyState as Record<string, unknown> | undefined;
  if (!emptyState || typeof emptyState !== "object" || Array.isArray(emptyState)) return false;
  return emptyState.verified === true && emptyState.tenant_confirmed === true;
}

export function validateCrawlerImport(payload: CrawlerJsonRunPayload) {
  if (payload.bids !== undefined && !Array.isArray(payload.bids)) throw new Error("Crawler JSON bids must be an array.");
  if (payload.status !== "success" || (payload.bids?.length ?? 0) > 0) return;
  // A verified empty list is a legitimate zero-row success: the portal really has no open
  // solicitations right now, so recording it as a failure would degrade the source's health
  // for telling the truth.
  if (hasVerifiedEmptyState(payload.metadata)) return;
  const filter = payload.metadata?.dateFilter as Record<string, unknown> | undefined;
  const bound = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (filter && (bound(filter.from) || bound(filter.to)) && filter.kept === 0 &&
    typeof filter.dropped === "number" && Number.isInteger(filter.dropped) && filter.dropped > 0 && filter.unparsed === 0) return;
  throw new Error("Crawler JSON import refused a successful run with no bid rows.");
}
