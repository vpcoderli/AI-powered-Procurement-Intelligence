import { NextResponse } from "next/server";
import * as bidService from "@/server/bids/service";

const LEGACY_SAVED_BIDS_USER_ID = "demo-user";

interface RouteContext {
  params: Promise<{ id: string }>;
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

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    return NextResponse.json(await bidService.removeSavedBid(LEGACY_SAVED_BIDS_USER_ID, id));
  } catch (error) {
    return internalError(error);
  }
}
