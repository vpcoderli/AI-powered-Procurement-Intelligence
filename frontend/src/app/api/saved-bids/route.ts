import { NextResponse } from "next/server";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import * as bidService from "@/server/bids/service";
import { BidNotFoundError } from "@/server/bids/types";
import { db } from "@/server/db/client";

function invalidRequest() {
  return NextResponse.json(
    { error: { code: "INVALID_REQUEST", message: "Request body must include bidId" } },
    { status: 400 },
  );
}

function jsonWithPrincipalCookie(
  body: unknown,
  principal: RequestPrincipal,
  init?: ResponseInit,
) {
  const response = NextResponse.json(body, init);

  if (principal.kind === "anonymous" && principal.anonymousCookie) {
    response.headers.set("Set-Cookie", principal.anonymousCookie);
  }

  return response;
}

function internalError(principal: RequestPrincipal) {
  return jsonWithPrincipalCookie(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    },
    principal,
    { status: 500 },
  );
}

export async function GET(request: Request) {
  const principal = await resolvePrincipal(db, request);

  try {
    return jsonWithPrincipalCookie(await bidService.getSavedBids(principal.userId), principal);
  } catch {
    return internalError(principal);
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

  const principal = await resolvePrincipal(db, request);

  try {
    return jsonWithPrincipalCookie(await bidService.saveBid(principal.userId, body.bidId), principal);
  } catch (error) {
    if (error instanceof BidNotFoundError) {
      return jsonWithPrincipalCookie(
        { error: { code: "BID_NOT_FOUND", message: "Bid not found" } },
        principal,
        { status: 404 },
      );
    }

    return internalError(principal);
  }
}
