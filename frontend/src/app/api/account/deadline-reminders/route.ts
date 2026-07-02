import { NextResponse } from "next/server";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { FeatureAccessError, featureErrorResponse, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import {
  acknowledgeAccountDeadlineReminder,
  DeadlineReminderValidationError,
  getAccountDeadlineReminderCenter,
  snoozeAccountDeadlineReminder,
} from "@/server/deadlines/service";
import type { UpdateDeadlineReminderInput } from "@/server/deadlines/types";
import { csrfRejectedResponse, verifyCsrfSafe } from "@/server/security/csrf";

function jsonWithPrincipalCookie(body: unknown, principal: RequestPrincipal, init?: ResponseInit) {
  const response = NextResponse.json(body, init);

  if (principal.kind === "anonymous" && principal.anonymousCookie) {
    response.headers.append("Set-Cookie", principal.anonymousCookie);
  }

  return response;
}

function errorResponse(code: string, message: string, status: number, principal: RequestPrincipal) {
  return jsonWithPrincipalCookie({ error: { code, message } }, principal, { status });
}

function routeError(error: unknown, principal: RequestPrincipal) {
  if (error instanceof FeatureAccessError) {
    return jsonWithPrincipalCookie(featureErrorResponse(error), principal, { status: error.status });
  }

  if (error instanceof DeadlineReminderValidationError) {
    return errorResponse("INVALID_REQUEST", error.message, 400, principal);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
}

function parseUpdate(body: unknown): (UpdateDeadlineReminderInput & { action: "acknowledge" | "snooze" }) | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const source = body as Record<string, unknown>;
  if (typeof source.reminderId !== "string") return null;
  if (source.action !== "acknowledge" && source.action !== "snooze") return null;
  if (source.action === "snooze" && typeof source.snoozedUntil !== "string") return null;

  return {
    reminderId: source.reminderId,
    action: source.action,
    snoozedUntil: typeof source.snoozedUntil === "string" ? source.snoozedUntil : undefined,
  };
}

export async function GET(request: Request) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  try {
    requireFeature(principal, "deadline_notifications");
    const center = await getAccountDeadlineReminderCenter(db, principal.userId);

    return jsonWithPrincipalCookie({ center }, principal);
  } catch (error) {
    return routeError(error, principal);
  }
}

export async function PATCH(request: Request) {
  if (!verifyCsrfSafe(request)) {
    return csrfRejectedResponse();
  }

  const body = await request.json().catch(() => null);
  const input = parseUpdate(body);
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  if (!input) {
    return errorResponse("INVALID_REQUEST", "Deadline reminder update fields are invalid.", 400, principal);
  }

  try {
    requireFeature(principal, "deadline_notifications");
    const center = input.action === "acknowledge"
      ? await acknowledgeAccountDeadlineReminder(db, principal.userId, { reminderId: input.reminderId })
      : await snoozeAccountDeadlineReminder(db, principal.userId, {
          reminderId: input.reminderId,
          snoozedUntil: input.snoozedUntil,
        });

    return jsonWithPrincipalCookie({ center }, principal);
  } catch (error) {
    return routeError(error, principal);
  }
}
