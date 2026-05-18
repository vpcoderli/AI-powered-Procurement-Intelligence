import { NextResponse } from "next/server";
import * as bidService from "@/server/bids/service";

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

    return NextResponse.json(bidService.removeSavedBid(id));
  } catch (error) {
    return internalError(error);
  }
}
