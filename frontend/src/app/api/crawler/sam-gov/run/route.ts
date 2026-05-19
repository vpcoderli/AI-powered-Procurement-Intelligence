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
import { db, type AppDatabase } from "@/server/db/client";
import { matchEnabledSearchAlerts, type SearchAlertMatchResult } from "@/server/search-alerts/matcher";

type Matcher = () => Promise<SearchAlertMatchResult>;
type Orchestrator = (db: AppDatabase, options: RunCrawlerSourceOnceOptions) => Promise<RunCrawlerSourceOnceResult>;

interface SamGovRunRouteDependencies {
  database: AppDatabase;
  owner: string;
  runner: CrawlerRunner;
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

function isAuthorized(request: Request) {
  const requiredToken = process.env.CRAWLER_RUN_TOKEN;
  if (!requiredToken) return true;

  return tokenFromRequest(request) === requiredToken;
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

const noopNotifier: CrawlerNotifier = async () => ({
  queued: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
});

export function createSamGovRunPost(overrides: Partial<SamGovRunRouteDependencies> = {}) {
  const dependencies: SamGovRunRouteDependencies = {
    database: db,
    owner: defaultOwner(),
    runner: runSamGovCrawler,
    matcher: () => matchEnabledSearchAlerts(overrides.database ?? db),
    notifier: noopNotifier,
    runCrawlerSourceOnce,
    ...overrides,
  };

  return async function POST(request: Request) {
    if (!isAuthorized(request)) {
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
    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json(result, { status: 200 });
  };
}

export const POST = createSamGovRunPost();
