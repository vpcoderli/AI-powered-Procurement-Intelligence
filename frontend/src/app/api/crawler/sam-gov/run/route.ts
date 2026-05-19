import { NextResponse } from "next/server";
import {
  runCrawlerSourceOnce,
  type CrawlerNotifier,
  type CrawlerRunner,
  type RunCrawlerSourceOnceOptions,
  type RunCrawlerSourceOnceResult,
} from "@/server/crawler/orchestrator";
import {
  runSamGovCrawler,
  type SamGovCrawlerRunOptions,
} from "@/server/crawler/sam-gov-runner";
import { AdminAuthError, requireAdmin } from "@/server/admin/auth";
import { db, type AppDatabase } from "@/server/db/client";
import { sendMatchedAlertNotifications } from "@/server/notifications/service";
import { matchEnabledSearchAlerts, type SearchAlertMatchResult } from "@/server/search-alerts/matcher";

type Matcher = () => Promise<SearchAlertMatchResult>;
type Orchestrator = <TOptions>(
  db: AppDatabase,
  options: RunCrawlerSourceOnceOptions<TOptions>,
) => Promise<RunCrawlerSourceOnceResult>;

interface SamGovRunRouteDependencies {
  database: AppDatabase;
  owner: string;
  runner: CrawlerRunner<SamGovCrawlerRunOptions>;
  matcher: Matcher;
  notifier: CrawlerNotifier;
  runCrawlerSourceOnce: Orchestrator;
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
    await requireAdmin(database, request);
    return true;
  } catch (error) {
    if (error instanceof AdminAuthError) return false;
    throw error;
  }
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
  const dependencies: SamGovRunRouteDependencies = {
    database,
    owner: defaultOwner(),
    runner: runSamGovCrawler,
    matcher: () => matchEnabledSearchAlerts(database),
    notifier: ({ alertMatching }) => sendMatchedAlertNotifications(database, alertMatching),
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

    const result = await dependencies.runCrawlerSourceOnce(dependencies.database, {
      source: "SAM.gov",
      owner: dependencies.owner,
      runner: dependencies.runner,
      runnerOptions: await parseOptions(request),
      matcher: dependencies.matcher,
      notifier: dependencies.notifier,
    });

    if (result.status === "locked") {
      return NextResponse.json(result, { status: 409 });
    }
    if (result.status === "disabled") {
      return NextResponse.json(result, { status: 409 });
    }
    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json(result, { status: 200 });
  };
}

export const POST = createSamGovRunPost();
