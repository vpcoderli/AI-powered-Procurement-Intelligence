import { NextResponse } from "next/server";
import * as bidService from "@/server/bids/service";
import { BidNotFoundError } from "@/server/bids/types";
import {
  createAnonymousUserCookie,
  resolveAnonymousUser,
} from "@/server/bids/user";

function invalidRequest() {
  return NextResponse.json(
    { error: { code: "INVALID_REQUEST", message: "Request body must include bidId" } },
    { status: 400 },
  );
}

function jsonWithUserCookie(
  body: unknown,
  user: ReturnType<typeof resolveAnonymousUser>,
  init?: ResponseInit,
) {
  const response = NextResponse.json(body, init);

  if (user.isNewUser) {
    response.headers.set("Set-Cookie", createAnonymousUserCookie(user.userId));
  }

  return response;
}

function internalError(error: unknown, user: ReturnType<typeof resolveAnonymousUser>) {
  return jsonWithUserCookie(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Internal server error",
      },
    },
    user,
    { status: 500 },
  );
}

export async function GET(request: Request) {
  const user = resolveAnonymousUser(request);

  try {
    return jsonWithUserCookie(await bidService.getSavedBids(user.userId), user);
  } catch (error) {
    return internalError(error, user);
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

  const user = resolveAnonymousUser(request);

  try {
    return jsonWithUserCookie(await bidService.saveBid(user.userId, body.bidId), user);
  } catch (error) {
    if (error instanceof BidNotFoundError) {
      return jsonWithUserCookie(
        { error: { code: "BID_NOT_FOUND", message: "Bid not found" } },
        user,
        { status: 404 },
      );
    }

    return internalError(error, user);
  }
}
