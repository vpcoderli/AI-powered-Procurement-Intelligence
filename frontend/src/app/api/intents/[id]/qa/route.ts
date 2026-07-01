import { NextResponse } from "next/server";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { FeatureAccessError, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { recordPremiumActionUsageDryRun } from "@/server/billing/credit-ledger";
import { db } from "@/server/db/client";
import { IntentNotFoundError } from "@/server/intents/types";
import { answerQualificationQuestion } from "@/server/qualification/qa";
import type { QualificationQuestionInput } from "@/server/qualification/types";

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

function errorResponse(
  code: string,
  message: string,
  status: number,
  principal: RequestPrincipal,
) {
  return jsonWithPrincipalCookie({ error: { code, message } }, principal, { status });
}

function parseQuestion(body: unknown): QualificationQuestionInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const question = (body as Record<string, unknown>).question;
  if (typeof question !== "string") return null;

  const normalized = question.trim().replace(/\s+/g, " ");
  if (normalized.length < 3 || normalized.length > 500) return null;

  return { question: normalized };
}

export async function POST(request: Request, context: RouteContext) {
  const body = await request.json().catch(() => null);
  const input = parseQuestion(body);
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  if (!input) {
    return errorResponse("INVALID_REQUEST", "A question between 3 and 500 characters is required.", 400, principal);
  }

  try {
    requireFeature(principal, "bid.brief.full.generate");
    const { id } = await context.params;
    const answer = await answerQualificationQuestion(db, principal.userId, id, input);
    const creditUsage = await recordPremiumActionUsageDryRun(db, {
      organizationId: principal.workspace?.organizationId ?? null,
      userId: principal.userId,
      featureKey: "bid.brief.full.generate",
      actionId: `qualification_qa:${id}`,
      aiRunId: answer.aiRun.id,
      metadata: {
        provider: answer.aiRun.provider,
        promptVersion: answer.aiRun.promptVersion,
      },
    });

    return jsonWithPrincipalCookie({ ...answer, creditUsage }, principal);
  } catch (error) {
    if (error instanceof FeatureAccessError) {
      return errorResponse(error.code, error.message, error.status, principal);
    }

    if (error instanceof IntentNotFoundError) {
      return errorResponse("INTENT_NOT_FOUND", "Intent not found", 404, principal);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
  }
}
