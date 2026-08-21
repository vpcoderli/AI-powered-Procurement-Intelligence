import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import { persistCrawlTaskResult } from "@/server/crawler/crawl-task-persistence";
import {
  runCrawlerSourceOnce,
  type CrawlerNotifier,
  type RunCrawlerSourceOnceOptions,
  type RunCrawlerSourceOnceResult,
} from "@/server/crawler/orchestrator";
import type { MysqlCrawlerLockStore } from "@/server/crawler/lock-repository";
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

function tokenFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }

  return request.headers.get("x-crawler-token");
}

async function isAuthorized(database: AppDatabase, request: Request) {
  const requiredToken = process.env.CRAWLER_RUN_TOKEN;
  if (!requiredToken) return true;
  if (tokenFromRequest(request) === requiredToken) return true;

  try {
    await requireAdminAccess(database, request, { roles: ["admin", "operator"] });
    return true;
  } catch (error) {
    if (error instanceof AdminAuthError) return false;
    throw error;
  }
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
    return dependencies.runCrawlerSourceOnce(dependencies.database, {
      mysql: dependencies.mysql,
      source: source.id,
      owner: dependencies.owner,
      // Mirrors configured-runner.ts's runStateSourceAndImport: run the JSON task contract,
      // then persist whatever it returned (stamp jurisdiction + dialect-appropriate import,
      // contained so an import failure can't abort the batch or flip a fetch success into a
      // reported failure) via the shared persistCrawlTaskResult helper — see
      // crawl-task-persistence.ts.
      runner: async () => {
        const taskResult = await runCrawlTask(source, {
          taskId: `tsk_${source.id}_${now.getTime()}`,
          limit: body.limit,
          query: body.query ?? null,
          postedFrom: body.postedFrom ?? null,
          postedTo: body.postedTo ?? null,
        });
        return persistCrawlTaskResult(dependencies.database, dependencies.mysql, source, taskResult);
      },
      matcher: dependencies.matcher,
      notifier: dependencies.notifier,
    });
  }

  return async function POST(request: Request) {
    if (!(await isAuthorized(dependencies.database, request))) {
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

    if (requestedIds === null) {
      // No specific ids requested: run every crawlable (governance-approved) source, same as
      // before.
      const allSources = await dependencies.listSources(dependencies.database, dependencies.mysql);
      for (const source of allSources) {
        results.push(await dispatch(source, parsedBody, now));
      }
    } else {
      // Specific ids requested: resolve against EVERY known non-federal source, not just the
      // governance-filtered list, so a blocked/needs_review id is still found and dispatched
      // (and reported "blocked" by the orchestrator) instead of being dropped and triggering a
      // run-all fallback.
      const allKnownSources = await dependencies.listAllSources(dependencies.database, dependencies.mysql);
      const byId = new Map(allKnownSources.map((source) => [source.id, source] as const));

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
        results.push(await dispatch(source, parsedBody, now));
      }
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
