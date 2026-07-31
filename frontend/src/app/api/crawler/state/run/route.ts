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
import { listCrawlableSources, listCrawlableSourcesFromMysql, type CrawlableSource } from "@/server/crawler/source-registry";
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

interface StateCrawlerRunRouteDependencies {
  database: AppDatabase;
  mysql?: MysqlCrawlerLockStore;
  owner: string;
  matcher: Matcher;
  notifier: CrawlerNotifier;
  runCrawlerSourceOnce: Orchestrator;
  listSources: (database: AppDatabase, mysql?: MysqlCrawlerLockStore) => Promise<CrawlableSource[]>;
  now: () => Date;
}

/**
 * Resolves run candidates from `data_sources` the same way the configured (scheduled) runner
 * does, via `listCrawlableSources`/`listCrawlableSourcesFromMysql` — which already applies the
 * NULL-tolerant governance gate (see source-registry.ts). Narrowed to `issuerType === "state"`
 * because this route is specifically the state-crawler trigger; SAM.gov has its own sibling
 * route (`/api/crawler/sam-gov/run`) and its own runner.
 */
async function defaultListSources(database: AppDatabase, mysql?: MysqlCrawlerLockStore): Promise<CrawlableSource[]> {
  const sources = mysql ? await listCrawlableSourcesFromMysql(mysql) : listCrawlableSources(database);
  return sources.filter((source) => source.issuerType === "state");
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

interface ParsedRunOptions {
  sources: CrawlableSource[];
  query?: string;
  limit?: number;
}

async function parseOptions(request: Request, allSources: CrawlableSource[]): Promise<ParsedRunOptions> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { sources: allSources };
  }

  const body = (await request.json().catch(() => ({}))) as {
    sources?: unknown;
    query?: unknown;
    limit?: unknown;
  };

  const byId = new Map(allSources.map((source) => [source.id, source] as const));
  const requestedSources = Array.isArray(body.sources)
    ? body.sources
        .filter((source): source is string => typeof source === "string" && byId.has(source))
        .map((sourceId) => byId.get(sourceId)!)
    : allSources;

  return {
    sources: requestedSources.length > 0 ? requestedSources : allSources,
    ...(typeof body.query === "string" && body.query ? { query: body.query } : {}),
    ...(typeof body.limit === "number" ? { limit: body.limit } : {}),
  };
}

function defaultOwner() {
  return `state-route:${process.pid}`;
}

function batchStatus(results: RunCrawlerSourceOnceResult[]) {
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
    now: () => new Date(),
    ...overrides,
  };

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

    const allSources = await dependencies.listSources(dependencies.database, dependencies.mysql);
    const { sources, query, limit } = await parseOptions(request, allSources);
    const now = dependencies.now();
    const results: RunCrawlerSourceOnceResult[] = [];

    for (const source of sources) {
      const result = await dependencies.runCrawlerSourceOnce(dependencies.database, {
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
            limit,
            query: query ?? null,
          });
          return persistCrawlTaskResult(dependencies.database, dependencies.mysql, source, taskResult);
        },
        matcher: dependencies.matcher,
        notifier: dependencies.notifier,
      });
      results.push(result);
    }

    return NextResponse.json(
      {
        ok: results.every((result) => result.ok),
        status: batchStatus(results),
        results,
      },
      { status: 200 },
    );
  };
}

export const POST = createStateCrawlerRunPost();
