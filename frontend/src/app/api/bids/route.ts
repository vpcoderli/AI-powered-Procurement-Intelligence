import { NextResponse } from "next/server";
import * as bidService from "@/server/bids/service";
import type {
  ApiIssuerType,
  BidQuery,
  DeadlinePreset,
  PublishedPreset,
} from "@/server/bids/types";
import type { SortOption } from "@/lib/mock-data";

const issuerTypes: ApiIssuerType[] = ["all", "federal", "state"];
const deadlinePresets: DeadlinePreset[] = ["any", "next7", "next30"];
const publishedPresets: PublishedPreset[] = ["any", "last24", "last7"];
const sortOptions: SortOption[] = ["relevance", "newest", "deadline"];

function firstParam(searchParams: URLSearchParams, key: string) {
  return searchParams.get(key) ?? undefined;
}

function stringListParam(searchParams: URLSearchParams, key: string) {
  const values = searchParams.getAll(key).flatMap((value) => value.split(","));

  return values.map((value) => value.trim()).filter(Boolean);
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]) {
  return value && allowed.includes(value as T) ? (value as T) : undefined;
}

function internalError(error: unknown) {
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Internal server error",
      },
    },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query: BidQuery = {
      q: firstParam(searchParams, "q"),
      states: stringListParam(searchParams, "states"),
      issuerType: oneOf(firstParam(searchParams, "issuerType"), issuerTypes),
      deadline: oneOf(firstParam(searchParams, "deadline"), deadlinePresets),
      published: oneOf(firstParam(searchParams, "published"), publishedPresets),
      sort: oneOf(firstParam(searchParams, "sort"), sortOptions),
    };

    return NextResponse.json(bidService.queryBids(query));
  } catch (error) {
    return internalError(error);
  }
}
