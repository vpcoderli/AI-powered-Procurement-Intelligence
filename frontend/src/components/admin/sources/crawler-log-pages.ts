import type { AdminCrawlerLog, AdminCrawlerLogsCursor, AdminCrawlerLogsResponse } from "@/lib/api/admin";

/**
 * One page of crawler runs, newest first, tagged with the source set it was read for (`key`: the list's
 * `sources` joined, "" for every run). A cursor only pages the set it came from.
 */
export interface CrawlerLogPage extends AdminCrawlerLogsResponse {
  key: string;
}

/** The pages "load more" appended after a first page, and the cursor of that first page they started from. */
export interface CrawlerLogMore extends CrawlerLogPage {
  after: AdminCrawlerLogsCursor | null;
}

export interface VisibleCrawlerLogs {
  /** The first page when it was read for the requested source set, else null (nothing is known for that set yet). */
  first: CrawlerLogPage | null;
  logs: AdminCrawlerLog[];
  /** Where "load more" continues; null at the end of the list and whenever nothing is loaded for the set. */
  cursor: AdminCrawlerLogsCursor | null;
}

function sameCursor(a: AdminCrawlerLogsCursor | null, b: AdminCrawlerLogsCursor | null) {
  return a === b || (a !== null && b !== null && a.before === b.before && a.beforeId === b.beforeId);
}

function uniqueById(logs: readonly AdminCrawlerLog[]): AdminCrawlerLog[] {
  const seen = new Set<string>();
  return logs.filter((log) => {
    if (seen.has(log.id)) return false;
    seen.add(log.id);
    return true;
  });
}

/** The appended pages that still belong to `first`: the same source set, started from its cursor. */
function continuation(first: CrawlerLogPage, more: CrawlerLogMore | null): CrawlerLogMore | null {
  return more !== null && more.key === first.key && sameCursor(more.after, first.nextCursor) ? more : null;
}

/**
 * What the list shows for source set `key`: the first page followed by the appended pages, each run once,
 * and the cursor "load more" continues from. A first page read for another set (the resource keeps the previous
 * set's page while a new one loads) and appended pages that do not continue from the first page are not used,
 * so a cursor never pages a list it did not come from.
 */
export function visibleCrawlerLogs(key: string, first: CrawlerLogPage | null, more: CrawlerLogMore | null): VisibleCrawlerLogs {
  if (first === null || first.key !== key) return { first: null, logs: [], cursor: null };

  const appended = continuation(first, more);
  return {
    first,
    logs: uniqueById([...first.logs, ...(appended?.logs ?? [])]),
    cursor: appended ? appended.nextCursor : first.nextCursor,
  };
}

/** The appended pages after "load more" fetched `page`: what was appended for `first` so far, then `page`. */
export function appendCrawlerLogPage(first: CrawlerLogPage, more: CrawlerLogMore | null, page: AdminCrawlerLogsResponse): CrawlerLogMore {
  const appended = continuation(first, more);
  return {
    key: first.key,
    after: first.nextCursor,
    logs: uniqueById([...(appended?.logs ?? []), ...page.logs]),
    nextCursor: page.nextCursor,
  };
}
