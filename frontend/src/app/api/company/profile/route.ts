import { NextResponse } from "next/server";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { getSupplierProfile, upsertSupplierProfile } from "@/server/profile/service";
import type { SupplierProfileInput } from "@/server/profile/types";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function invalidRequest(message = "Profile body is required.") {
  return errorResponse("INVALID_REQUEST", message, 400);
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

function internalError(principal: RequestPrincipal) {
  return jsonWithPrincipalCookie(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    principal,
    { status: 500 },
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isContractValue(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function parseSupplierProfileInput(body: unknown): SupplierProfileInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const input = body as Record<string, unknown>;

  if (
    (input.companyName !== undefined && typeof input.companyName !== "string") ||
    (input.businessTypes !== undefined && !isStringArray(input.businessTypes)) ||
    (input.categories !== undefined && !isStringArray(input.categories)) ||
    (input.keywords !== undefined && !isStringArray(input.keywords)) ||
    (input.certifications !== undefined && !isStringArray(input.certifications)) ||
    (input.serviceStates !== undefined && !isStringArray(input.serviceStates)) ||
    (input.minContractValue !== undefined && !isContractValue(input.minContractValue)) ||
    (input.maxContractValue !== undefined && !isContractValue(input.maxContractValue)) ||
    (input.riskPreferences !== undefined && !isStringArray(input.riskPreferences))
  ) {
    return null;
  }

  return {
    ...(input.companyName !== undefined ? { companyName: input.companyName } : {}),
    ...(input.businessTypes !== undefined ? { businessTypes: input.businessTypes } : {}),
    ...(input.categories !== undefined ? { categories: input.categories } : {}),
    ...(input.keywords !== undefined ? { keywords: input.keywords } : {}),
    ...(input.certifications !== undefined ? { certifications: input.certifications } : {}),
    ...(input.serviceStates !== undefined ? { serviceStates: input.serviceStates } : {}),
    ...(input.minContractValue !== undefined ? { minContractValue: input.minContractValue } : {}),
    ...(input.maxContractValue !== undefined ? { maxContractValue: input.maxContractValue } : {}),
    ...(input.riskPreferences !== undefined ? { riskPreferences: input.riskPreferences } : {}),
  };
}

export async function GET(request: Request) {
  const principal = await resolvePrincipal(db, request);

  try {
    const profile = await getSupplierProfile(db, principal.userId);

    return jsonWithPrincipalCookie({ profile }, principal);
  } catch {
    return internalError(principal);
  }
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const input = parseSupplierProfileInput(body);

  if (!input) {
    return invalidRequest();
  }

  const principal = await resolvePrincipal(db, request);

  try {
    const profile = await upsertSupplierProfile(db, principal.userId, input);

    return jsonWithPrincipalCookie({ profile }, principal);
  } catch {
    return internalError(principal);
  }
}
