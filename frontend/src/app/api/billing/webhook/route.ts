import { NextResponse } from "next/server";
import {
  InvalidSubscriptionInputError,
  applyBillingProviderEvent,
  type BillingProviderEvent,
} from "@/server/billing/subscriptions";
import { db } from "@/server/db/client";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function readBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isBillingProviderEvent(body: unknown): body is BillingProviderEvent {
  if (typeof body !== "object" || body === null) return false;

  const event = body as { id?: unknown; type?: unknown };

  return (
    typeof event.id === "string" &&
    (event.type === "checkout.completed" ||
      event.type === "subscription.updated" ||
      event.type === "subscription.deleted")
  );
}

export async function POST(request: Request) {
  const body = await readBody(request);

  if (!isBillingProviderEvent(body)) {
    return errorResponse("INVALID_REQUEST", "Request body must include a valid provider event", 400);
  }

  try {
    return NextResponse.json(applyBillingProviderEvent(db, body));
  } catch (error) {
    if (error instanceof InvalidSubscriptionInputError) {
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
