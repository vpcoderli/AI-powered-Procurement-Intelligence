import { NextResponse } from "next/server";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { getBidByIdFromRepository } from "@/server/bids/repository";
import { db } from "@/server/db/client";
import { calculateBidMatch } from "@/server/match/service";
import { getSupplierProfile } from "@/server/profile/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function jsonWithPrincipalCookie(
  body: unknown,
  principal: RequestPrincipal,
  init?: ResponseInit,
) {
  const response = NextResponse.json(body, init);

  if (principal.kind === "anonymous" && principal.anonymousCookie) {
    response.headers.append("Set-Cookie", principal.anonymousCookie);
  }

  return response;
}

function bidNotFound(principal: RequestPrincipal) {
  return jsonWithPrincipalCookie(
    { error: { code: "BID_NOT_FOUND", message: "Bid not found" } },
    principal,
    { status: 404 },
  );
}

function internalError(principal: RequestPrincipal) {
  return jsonWithPrincipalCookie(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    principal,
    { status: 500 },
  );
}

export async function GET(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  try {
    const { id } = await context.params;
    const bid = await getBidByIdFromRepository(db, id);

    if (!bid) {
      return bidNotFound(principal);
    }

    const profile = await getSupplierProfile(db, principal.userId);
    const match = calculateBidMatch(bid, profile);

    return jsonWithPrincipalCookie({ match }, principal);
  } catch {
    return internalError(principal);
  }
}
