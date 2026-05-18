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

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const bid = bidService.getBidById(id);

    if (!bid) {
      return NextResponse.json(
        { error: { code: "BID_NOT_FOUND", message: "Bid not found" } },
        { status: 404 },
      );
    }

    return NextResponse.json({ bid });
  } catch (error) {
    return internalError(error);
  }
}
