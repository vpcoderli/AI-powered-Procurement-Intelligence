import { NextResponse } from "next/server";
import { requestPasswordReset } from "@/server/auth/password-reset";
import { db } from "@/server/db/client";
import { getClientIp } from "@/server/security/request-ip";
import { loginGuard } from "@/server/security/login-guard";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function rateLimitedResponse(retryAfterSeconds: number) {
  const response = errorResponse(
    "TOO_MANY_REQUESTS",
    "Too many password reset requests. Please try again later.",
    429,
  );
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

async function readBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Response-body allowlist for the password reset request result.
 *
 * `requestPasswordReset()` returns the plaintext, single-use `resetToken`
 * (and its `expiresAt`) because this codebase has no email delivery wired
 * for the password-reset flow specifically (see `frontend/src/app/forgot-password/page.tsx`,
 * which renders the token as a clickable "local reset link" for local/dev use
 * when no email provider fronts this flow). That is acceptable only when the
 * caller cannot be an external, unauthenticated attacker probing arbitrary
 * emails in a real deployment: in `NODE_ENV=production` this response must
 * never include the account-takeover credential, matching how
 * `ADMIN_UI_LOCAL_BYPASS` is gated in `@/server/admin/auth`. Production
 * deployments must wire a real email/notification provider to deliver the
 * reset link out-of-band instead of returning it in this API response.
 */
function toSafeResponseBody(result: Awaited<ReturnType<typeof requestPasswordReset>>) {
  if (process.env.NODE_ENV === "production") {
    return { ok: result.ok } as const;
  }

  return result;
}

export async function POST(request: Request) {
  const body = await readBody(request);

  if (
    typeof body !== "object" ||
    body === null ||
    typeof body.email !== "string" ||
    body.email.trim().length === 0
  ) {
    return errorResponse("INVALID_REQUEST", "Request body must include email", 400);
  }

  const clientIp = getClientIp(request);
  const guardOutcome = loginGuard.checkPasswordResetRequestAllowed(clientIp, body.email);

  if (guardOutcome.blocked) {
    return rateLimitedResponse(guardOutcome.retryAfterSeconds);
  }

  try {
    const result = await requestPasswordReset(db, body.email);

    return NextResponse.json(toSafeResponseBody(result));
  } catch {
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
