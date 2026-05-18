import { NextResponse } from "next/server";
import * as bidService from "@/server/bids/service";
import { BidNotFoundError } from "@/server/bids/types";

function invalidRequest() {
  return NextResponse.json(
    { error: { code: "INVALID_REQUEST", message: "Request body must include bidId" } },
    { status: 400 },
  );
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

export async function GET() {
  try {
    return NextResponse.json(bidService.getSavedBids());
  } catch (error) {
    return internalError(error);
  }
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return invalidRequest();
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("bidId" in body) ||
    typeof body.bidId !== "string" ||
    body.bidId.trim().length === 0
  ) {
    return invalidRequest();
  }

  try {
    return NextResponse.json(bidService.saveBid(body.bidId));
  } catch (error) {
    if (error instanceof BidNotFoundError) {
      return NextResponse.json(
        { error: { code: "BID_NOT_FOUND", message: "Bid not found" } },
        { status: 404 },
      );
    }

    return internalError(error);
  }
}
