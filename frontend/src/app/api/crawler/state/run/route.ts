import { NextResponse } from "next/server";
import { isCrawlerRunAuthorized } from "@/server/crawler/run-authorization";
import { recordSourceHealthOutcome } from "@/server/crawler/source-health-outcome";
import { persistCrawlTaskResult } from "@/server/crawler/crawl-task-persistence";
import {
  crawlerExceptionResult,
  runCrawlerSourceOnce,
  type CrawlerNotifier,
  type RunCrawlerSourceOnceOptions,
  type RunCrawlerSourceOnceResult,
} from "@/server/crawler/orchestrator";
import type { MysqlCrawlerLockStore } from "@/server/crawler/lock-repository";
import {
  PlatformDeferralTracker,
  platformDeferredResult,
  type PlatformDeferralOptions,
} from "@/server/crawler/platform-deferral";
import {
  listAllSources,
  listAllSourcesFromMysql,
  listCrawlableSources,
  listCrawlableSourcesFromMysql,
  type CrawlableSource,
} from "@/server/crawler/source-registry";
import { runCrawlTask } from "@/server/crawler/state-runner";
import { db, type AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { sendMatchedAlertNotifications, sendMatchedAlertNotificationsFromMysql } from "@/server/notifications/service";
import {
  matchEnabledSearchAlerts,
  matchEnabledSearchAlertsFromMysql,
  type SearchAlertMatchResult,
} from "@/server/search-alerts/matcher";

type Matcher = () => Promise<SearchAlertMatchResult>;
type Orchestrator = <TOptions>(
  db: AppDatabase,
  options: RunCrawlerSourceOnceOptions<TOptions>,
) => Promise<RunCrawlerSourceOnceResult>;

/** Per-id error entry for a requested source id that isn't in `data_sources` at all — distinct
 * from the orchestrator's "blocked"/"disabled" results, which mean the id was found but its
 * governance state prevents a run. */
export interface UnknownSourceError {
  source: string;
  code: "UNKNOWN_SOURCE";
  message: string;
}

interface StateCrawlerRunRouteDependencies {
  database: AppDatabase;
  mysql?: MysqlCrawlerLockStore;
  owner: string;
  matcher: Matcher;
  notifier: CrawlerNotifier;
  runCrawlerSourceOnce: Orchestrator;
  listSources: (database: AppDatabase, mysql?: MysqlCrawlerLockStore) => Promise<CrawlableSource[]>;
  listAllSources: (database: AppDatabase, mysql?: MysqlCrawlerLockStore) => Promise<CrawlableSource[]>;
  now: () => Date;
  /** Contract C7 knobs (injectable sleeper/interval); defaults come from the environment. */
  platformDeferral?: PlatformDeferralOptions;
}

/**
 * Resolves run candidates from `data_sources` the same way the configured (scheduled) runner
 * does, via `listCrawlableSources`/`listCrawlableSourcesFromMysql` — which already applies the
 * NULL-tolerant governance gate (see source-registry.ts). Every fetch-task-runnable issuer
 * type is included (state, county, city, special_district); only `federal` is excluded,
 * because SAM.gov has its own sibling route (`/api/crawler/sam-gov/run`) and its own runner.
 * Used only for the "no ids requested" (run everything) path below.
 */
async function defaultListSources(database: AppDatabase, mysql?: MysqlCrawlerLockStore): Promise<CrawlableSource[]> {
  const sources = mysql ? await listCrawlableSourcesFromMysql(mysql) : listCrawlableSources(database);
  return sources.filter((source) => source.issuerType !== "federal");
}

/**
 * Same shape as defaultListSources but WITHOUT the governance gate — every non-federal
 * `data_sources` row, approved or not. Used only to resolve explicitly-requested source ids: a
 * blocked or needs_review source must still be *found* here so it gets dispatched through
 * runCrawlerSourceOnce and comes back with its real governance "blocked" result, instead of
 * being treated as "not requested" — which used to silently fall back to running every other
 * approved source instead (the bug this route was rewritten to fix).
 */
async function defaultListAllSources(
  database: AppDatabase,
  mysql?: MysqlCrawlerLockStore,
): Promise<CrawlableSource[]> {
  const sources = mysql ? await listAllSourcesFromMysql(mysql) : listAllSources(database);
  return sources.filter((source) => source.issuerType !== "federal");
}

interface ParsedRequestBody {
  /** null means "no specific ids requested" — run every crawlable source. A non-null array is
   * always non-empty (see parseRequestBody): each entry is resolved individually below, so an
   * all-unrecognized request reports errors instead of silently falling back to run-all. */
  requestedIds: string[] | null;
  query?: string;
  limit?: number;
  postedFrom?: string;
  postedTo?: string;
}

export class InvalidDateRangeError extends Error {}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDateField(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new InvalidDateRangeError(`${field} must be an ISO date (yyyy-mm-dd).`);
  }
  return value;
}

async function parseRequestBody(request: Request): Promise<ParsedRequestBody> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { requestedIds: null };
  }

  const body = (await request.json().catch(() => ({}))) as {
    sources?: unknown;
    query?: unknown;
    limit?: unknown;
    postedFrom?: unknown;
    postedTo?: unknown;
  };

  const requestedIds = Array.isArray(body.sources)
    ? body.sources.filter((source): source is string => typeof source === "string")
    : null;

  const postedFrom = parseIsoDateField(body.postedFrom, "postedFrom");
  const postedTo = parseIsoDateField(body.postedTo, "postedTo");
  if (postedFrom && postedTo && postedFrom > postedTo) {
    throw new InvalidDateRangeError("postedFrom must not be after postedTo.");
  }

  return {
    requestedIds: requestedIds && requestedIds.length > 0 ? requestedIds : null,
    ...(typeof body.query === "string" && body.query ? { query: body.query } : {}),
    ...(typeof body.limit === "number" ? { limit: body.limit } : {}),
    ...(postedFrom ? { postedFrom } : {}),
    ...(postedTo ? { postedTo } : {}),
  };
}

function defaultOwner() {
  return `state-route:${process.pid}`;
}

function batchStatus(results: RunCrawlerSourceOnceResult[], hasErrors: boolean) {
  if (hasErrors) return "completed_with_failures";
  return results.every((result) => result.ok) ? "completed" : "completed_with_failures";
}

export function createStateCrawlerRunPost(overrides: Partial<StateCrawlerRunRouteDependencies> = {}) {
  const database = overrides.database ?? db;
  const mysql = overrides.mysql ?? (!overrides.database && isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : undefined);
  const dependencies: StateCrawlerRunRouteDependencies = {
    database,
    mysql,
    owner: defaultOwner(),
    matcher: () => mysql ? matchEnabledSearchAlertsFromMysql(mysql) : matchEnabledSearchAlerts(database),
    notifier: ({ alertMatching }) =>
      mysql
        ? sendMatchedAlertNotificationsFromMysql(mysql, alertMatching)
        : sendMatchedAlertNotifications(database, alertMatching),
    runCrawlerSourceOnce,
    listSources: defaultListSources,
    listAllSources: defaultListAllSources,
    now: () => new Date(),
    ...overrides,
  };

  async function dispatch(
    source: CrawlableSource,
    body: ParsedRequestBody,
    now: Date,
  ): Promise<RunCrawlerSourceOnceResult> {
    let result: RunCrawlerSourceOnceResult;
    try {
      result = await dependencies.runCrawlerSourceOnce(dependencies.database, {
        mysql: dependencies.mysql,
        source: source.id,
        owner: dependencies.owner,
        runner: async (_options, context) => {
          const taskResult = await runCrawlTask(source, {
            taskId: `tsk_${source.id}_${now.getTime()}`,
            limit: body.limit,
            query: body.query ?? null,
            postedFrom: body.postedFrom ?? null,
            postedTo: body.postedTo ?? null,
          }, context);
          await context?.assertLease();
          return persistCrawlTaskResult(dependencies.database, dependencies.mysql, source, taskResult, context?.lease);
        },
        matcher: dependencies.matcher,
        notifier: dependencies.notifier,
      });
    } catch (error) {
      result = crawlerExceptionResult(source.id, error);
    }
    await recordSourceHealthOutcome(dependencies, source.id, result, dependencies.now().toISOString());
    return result;
  }

  return async function POST(request: Request) {
    if (!(await isCrawlerRunAuthorized(dependencies.database, request))) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Crawler run token is required.",
          },
        },
        { status: 401 },
      );
    }

    let parsedBody: ParsedRequestBody;
    try {
      parsedBody = await parseRequestBody(request);
    } catch (error) {
      if (error instanceof InvalidDateRangeError) {
        return NextResponse.json(
          { error: { code: "INVALID_DATE_RANGE", message: error.message } },
          { status: 400 },
        );
      }
      throw error;
    }

    const { requestedIds } = parsedBody;
    const now = dependencies.now();
    const results: RunCrawlerSourceOnceResult[] = [];
    const errors: UnknownSourceError[] = [];
    // Contract C7: one tracker per request, so a platform throttled in this batch defers only
    // the sources still waiting in this same batch.
    const platform = new PlatformDeferralTracker(dependencies.platformDeferral);

    async function runBatch(sources: CrawlableSource[]) {
      for (const source of sources) {
        const throttledBy = platform.deferredBy(source);
        if (throttledBy) {
          // Never contacted: no health write-back and no retry.
          results.push(platformDeferredResult(source.id, throttledBy));
          continue;
        }
        await platform.waitForPlatformSlot(source);
        const result = await dispatch(source, parsedBody, now);
        platform.observe(source, result);
        results.push(result);
      }
    }

    if (requestedIds === null) {
      // No specific ids requested: run every crawlable (governance-approved) source, same as
      // before.
      const allSources = await dependencies.listSources(dependencies.database, dependencies.mysql);
      await runBatch(allSources);
    } else {
      // Specific ids requested: resolve against EVERY known non-federal source, not just the
      // governance-filtered list, so a blocked/needs_review id is still found and dispatched
      // (and reported "blocked" by the orchestrator) instead of being dropped and triggering a
      // run-all fallback.
      const allKnownSources = await dependencies.listAllSources(dependencies.database, dependencies.mysql);
      const byId = new Map(allKnownSources.map((source) => [source.id, source] as const));

      const requested: CrawlableSource[] = [];
      for (const requestedId of requestedIds) {
        const source = byId.get(requestedId);
        if (!source) {
          errors.push({
            source: requestedId,
            code: "UNKNOWN_SOURCE",
            message: `No data source is registered for id "${requestedId}".`,
          });
          continue;
        }
        requested.push(source);
      }
      await runBatch(requested);
    }

    return NextResponse.json(
      {
        ok: errors.length === 0 && results.every((result) => result.ok),
        status: batchStatus(results, errors.length > 0),
        results,
        ...(errors.length > 0 ? { errors } : {}),
      },
      { status: 200 },
    );
  };
}

export const POST = createStateCrawlerRunPost();
