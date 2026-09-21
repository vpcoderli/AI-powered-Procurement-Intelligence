import { NextResponse } from "next/server";
import {
  crawlerExceptionResult,
  isCrawlerRunSkipped,
  runCrawlerSourceOnce,
  type CrawlerNotifier,
  type CrawlerRunner,
  type RunCrawlerSourceOnceOptions,
  type RunCrawlerSourceOnceResult,
} from "@/server/crawler/orchestrator";
import type { MysqlCrawlerLockStore } from "@/server/crawler/lock-repository";
import {
  runSamGovCrawler,
  type SamGovCrawlerRunOptions,
} from "@/server/crawler/sam-gov-runner";
import { isCrawlerRunAuthorized } from "@/server/crawler/run-authorization";
import { recordSourceHealthOutcome } from "@/server/crawler/source-health-outcome";
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

interface SamGovRunRouteDependencies {
  database: AppDatabase;
  mysql?: MysqlCrawlerLockStore;
  owner: string;
  runner: CrawlerRunner<SamGovCrawlerRunOptions>;
  matcher: Matcher;
  notifier: CrawlerNotifier;
  runCrawlerSourceOnce: Orchestrator;
}

async function parseOptions(request: Request): Promise<SamGovCrawlerRunOptions> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};

  const body = (await request.json().catch(() => ({}))) as Partial<SamGovCrawlerRunOptions>;

  return {
    ...(typeof body.postedFrom === "string" ? { postedFrom: body.postedFrom } : {}),
    ...(typeof body.postedTo === "string" ? { postedTo: body.postedTo } : {}),
    ...(typeof body.limit === "number" ? { limit: body.limit } : {}),
    ...(typeof body.maxRecords === "number" ? { maxRecords: body.maxRecords } : {}),
  };
}

function defaultOwner() {
  return `sam-gov-route:${process.pid}`;
}

export function createSamGovRunPost(overrides: Partial<SamGovRunRouteDependencies> = {}) {
  const database = overrides.database ?? db;
  const mysql = overrides.mysql ?? (!overrides.database && isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : undefined);
  const dependencies: SamGovRunRouteDependencies = {
    database,
    mysql,
    owner: defaultOwner(),
    runner: runSamGovCrawler,
    matcher: () => mysql ? matchEnabledSearchAlertsFromMysql(mysql) : matchEnabledSearchAlerts(database),
    notifier: ({ alertMatching }) =>
      mysql
        ? sendMatchedAlertNotificationsFromMysql(mysql, alertMatching)
        : sendMatchedAlertNotifications(database, alertMatching),
    runCrawlerSourceOnce,
    ...overrides,
  };

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

    let result: RunCrawlerSourceOnceResult;
    try {
      result = await dependencies.runCrawlerSourceOnce(dependencies.database, {
        mysql: dependencies.mysql,
        source: "sam_gov",
        owner: dependencies.owner,
        runner: dependencies.runner,
        runnerOptions: await parseOptions(request),
        matcher: dependencies.matcher,
        notifier: dependencies.notifier,
      });
    } catch (error) {
      result = crawlerExceptionResult("sam_gov", error);
    }
    await recordSourceHealthOutcome(dependencies, "sam_gov", result, new Date().toISOString());

    // Never contacted (locked / disabled / blocked / deferred): the request was refused, not
    // broken, so it answers 409 rather than a 500 that would read as a server fault.
    if (isCrawlerRunSkipped(result)) {
      return NextResponse.json(result, { status: 409 });
    }
    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json(result, { status: 200 });
  };
}

export const POST = createSamGovRunPost();
