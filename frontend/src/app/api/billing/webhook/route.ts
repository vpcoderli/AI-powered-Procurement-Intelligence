import { createHmac, timingSafeEqual } from "node:crypto";
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

async function readBodyText(request: Request) {
  try {
    return await request.text();
  } catch {
    return "";
  }
}

function isBillingProviderEvent(body: unknown): body is BillingProviderEvent {
  if (typeof body !== "object" || body === null) return false;

  const event = body as { id?: unknown; type?: unknown };

  return (
    typeof event.id === "string" &&
    (event.type === "checkout.completed" ||
      event.type === "subscription.updated" ||
      event.type === "subscription.deleted" ||
      event.type === "invoice.paid" ||
      event.type === "invoice.payment_failed")
  );
}

function verifyWebhookSignature(rawBody: string, signature: string | null) {
  const secret = process.env.BILLING_WEBHOOK_SECRET;

  if (!secret) return true;
  if (!signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  const rawBody = await readBodyText(request);

  if (!verifyWebhookSignature(rawBody, request.headers.get("x-billing-signature"))) {
    return errorResponse("INVALID_SIGNATURE", "Invalid billing webhook signature", 401);
  }

  let body: unknown;

  try {
    body = JSON.parse(rawBody);
  } catch {
    body = null;
  }

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
