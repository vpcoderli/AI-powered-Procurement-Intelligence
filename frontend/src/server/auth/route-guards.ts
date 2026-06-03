import { NextResponse } from "next/server";
import type { RequestPrincipal } from "./principal";

export type AuthenticatedRequestPrincipal = Extract<RequestPrincipal, { kind: "authenticated" }>;

export function isAuthenticatedPrincipal(
  principal: RequestPrincipal,
): principal is AuthenticatedRequestPrincipal {
  return principal.kind === "authenticated";
}

export function authRequiredResponse() {
  return NextResponse.json(
    { error: { code: "AUTH_REQUIRED", message: "Authentication is required" } },
    { status: 401 },
  );
}
