import { NextResponse } from "next/server";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import * as bidService from "@/server/bids/service";
import { db } from "@/server/db/client";

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
    response.headers.set("Set-Cookie", principal.anonymousCookie);
  }

  return response;
}

function internalError(error: unknown, principal: RequestPrincipal) {
  return jsonWithPrincipalCookie(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Internal server error",
      },
    },
    principal,
    { status: 500 },
  );
}

export async function DELETE(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  try {
    const { id } = await context.params;

    return jsonWithPrincipalCookie(await bidService.removeSavedBid(principal.userId, id), principal);
  } catch (error) {
    return internalError(error, principal);
  }
}
