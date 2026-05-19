import { NextResponse } from "next/server";
import {
  runSamGovCrawler,
  type SamGovCrawlerRunOptions,
  type SamGovCrawlerRunResult,
} from "@/server/crawler/sam-gov-runner";
import { db } from "@/server/db/client";
import { matchEnabledSearchAlerts, type SearchAlertMatchResult } from "@/server/search-alerts/matcher";

type Runner = (options?: SamGovCrawlerRunOptions) => Promise<SamGovCrawlerRunResult>;
type Matcher = () => Promise<SearchAlertMatchResult>;

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

export function createSamGovRunPost(
  runner: Runner = runSamGovCrawler,
  matcher: Matcher = () => matchEnabledSearchAlerts(db),
) {
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

    const result = await runner(await parseOptions(request));
    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    const alertMatching = await matcher();

    return NextResponse.json({ ...result, alertMatching }, { status: 200 });
  };
}

export const POST = createSamGovRunPost();
