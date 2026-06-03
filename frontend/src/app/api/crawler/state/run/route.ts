import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import {
  runCrawlerSourceOnce,
  type CrawlerNotifier,
  type RunCrawlerSourceOnceOptions,
  type RunCrawlerSourceOnceResult,
} from "@/server/crawler/orchestrator";
import type { MysqlCrawlerLockStore } from "@/server/crawler/lock-repository";
import {
  STATE_CRAWLER_SOURCES,
  createStateCrawlerRunner,
  type StateCrawlerOrchestratorOptions,
  type StateCrawlerSourceId,
} from "@/server/crawler/state-runner";
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
}

const DEFAULT_STATE_SOURCE_IDS = STATE_CRAWLER_SOURCES.map((source) => source.id);
const SUPPORTED_SOURCE_IDS = new Set<StateCrawlerSourceId>(DEFAULT_STATE_SOURCE_IDS);

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

async function parseOptions(request: Request): Promise<{
  sources: StateCrawlerSourceId[];
  runnerOptions: StateCrawlerOrchestratorOptions;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {
      sources: DEFAULT_STATE_SOURCE_IDS,
      runnerOptions: { allowFixtureFallback: true },
    };
  }

  const body = (await request.json().catch(() => ({}))) as {
    sources?: unknown;
    query?: unknown;
    limit?: unknown;
  };
  const requestedSources = Array.isArray(body.sources)
    ? body.sources.filter(
        (source): source is StateCrawlerSourceId =>
          typeof source === "string" && SUPPORTED_SOURCE_IDS.has(source as StateCrawlerSourceId),
      )
    : DEFAULT_STATE_SOURCE_IDS;

  return {
    sources: requestedSources.length > 0 ? requestedSources : DEFAULT_STATE_SOURCE_IDS,
    runnerOptions: {
      ...(typeof body.query === "string" && body.query ? { query: body.query } : {}),
      ...(typeof body.limit === "number" ? { limit: body.limit } : {}),
      allowFixtureFallback: true,
    },
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

    const { sources, runnerOptions } = await parseOptions(request);
    const results: RunCrawlerSourceOnceResult[] = [];

    for (const source of sources) {
      const result = await dependencies.runCrawlerSourceOnce(dependencies.database, {
        mysql: dependencies.mysql,
        source,
        owner: dependencies.owner,
        runner: createStateCrawlerRunner(source),
        runnerOptions,
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
