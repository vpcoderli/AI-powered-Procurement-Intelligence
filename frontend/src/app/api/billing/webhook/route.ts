import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  InvalidSubscriptionInputError,
  applyBillingProviderEvent,
  type BillingProviderEvent,
} from "@/server/billing/subscriptions";
import { applyMysqlBillingProviderEvent } from "@/server/billing/mysql-subscriptions";
import { constructStripeWebhookEvent, normalizeStripeWebhookEvent } from "@/server/billing/providers";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { logger } from "@/lib/observability/logger";

const routeLogger = logger.child({ service: "api:billing:webhook" });

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
  const secret = process.env.BILLING_WEBHOOK_SECRET?.trim();

  if (!secret) return process.env.NODE_ENV !== "production";
  if (!signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function isStripeBillingProvider() {
  return process.env.BILLING_PROVIDER?.trim().toLowerCase() === "stripe";
}

function hasStripeWebhookConfig(request: Request) {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()) && Boolean(request.headers.get("stripe-signature"));
}

function shouldUseStripeWebhook(request: Request) {
  return isStripeBillingProvider() && hasStripeWebhookConfig(request);
}

function shouldRequireStripeWebhook(request: Request) {
  return process.env.NODE_ENV === "production" && isStripeBillingProvider() && !hasStripeWebhookConfig(request);
}

function constructStripeEvent(rawBody: string, signature: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret || !signature) {
    throw new InvalidSubscriptionInputError("Stripe webhook configuration is incomplete");
  }

  return constructStripeWebhookEvent(rawBody, signature, secret);
}

export async function POST(request: Request) {
  const rawBody = await readBodyText(request);
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;

  if (shouldRequireStripeWebhook(request)) {
    routeLogger.warn("webhook_rejected", { reason: "missing_stripe_signature_config" });
    return errorResponse("INVALID_SIGNATURE", "Valid Stripe billing webhook signature is required", 401);
  }

  if (shouldUseStripeWebhook(request)) {
    try {
      const event = normalizeStripeWebhookEvent(
        constructStripeEvent(rawBody, request.headers.get("stripe-signature")),
      );
      const result = mysql
        ? await applyMysqlBillingProviderEvent(mysql, event)
        : applyBillingProviderEvent(db, event);
      routeLogger.info("webhook_processed", { provider: "stripe", eventId: event.id, eventType: event.type });
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof InvalidSubscriptionInputError) {
        routeLogger.warn("webhook_invalid_request", { provider: "stripe", detail: error.message });
        return errorResponse("INVALID_REQUEST", error.message, 400);
      }

      routeLogger.warn("webhook_invalid_signature", { provider: "stripe" });
      return errorResponse("INVALID_SIGNATURE", "Invalid Stripe billing webhook signature", 401);
    }
  }

  if (!verifyWebhookSignature(rawBody, request.headers.get("x-billing-signature"))) {
    routeLogger.warn("webhook_invalid_signature", { provider: "generic" });
    return errorResponse("INVALID_SIGNATURE", "Invalid billing webhook signature", 401);
  }

  let body: unknown;

  try {
    body = JSON.parse(rawBody);
  } catch {
    body = null;
  }

  if (!isBillingProviderEvent(body)) {
    routeLogger.warn("webhook_invalid_request", { provider: "generic", detail: "missing_or_invalid_event_body" });
    return errorResponse("INVALID_REQUEST", "Request body must include a valid provider event", 400);
  }

  try {
    const result = mysql
      ? await applyMysqlBillingProviderEvent(mysql, body)
      : applyBillingProviderEvent(db, body);
    routeLogger.info("webhook_processed", { provider: "generic", eventId: body.id, eventType: body.type });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InvalidSubscriptionInputError) {
      routeLogger.warn("webhook_invalid_request", { provider: "generic", detail: error.message });
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }

    routeLogger.error("webhook_unexpected_error", { error, provider: "generic" });
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
