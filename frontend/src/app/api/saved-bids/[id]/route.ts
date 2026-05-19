import { NextResponse } from "next/server";
import * as bidService from "@/server/bids/service";
import {
  createAnonymousUserCookie,
  resolveAnonymousUser,
} from "@/server/bids/user";

interface RouteContext {
  params: Promise<{ id: string }>;
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

export async function DELETE(request: Request, context: RouteContext) {
  const user = resolveAnonymousUser(request);

  try {
    const { id } = await context.params;

    return jsonWithUserCookie(await bidService.removeSavedBid(user.userId, id), user);
  } catch (error) {
    return internalError(error, user);
  }
}
