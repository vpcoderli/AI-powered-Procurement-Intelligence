import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/server/auth/principal";
import { isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { getBidById } from "@/server/bids/service";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { calculateBidMatch } from "@/server/match/service";
import { recordMarketingFunnelEvent, recordMarketingFunnelEventFromMysql } from "@/server/marketing/funnel";
import { getSupplierProfile } from "@/server/profile/service";
import type { SupplierProfile } from "@/server/profile/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function emptyPublicProfile(userId: string): SupplierProfile {
  return {
    userId,
    companyName: "",
    businessTypes: [],
    categories: [],
    keywords: [],
    certifications: [],
    serviceStates: [],
    minContractValue: null,
    maxContractValue: null,
    riskPreferences: [],
    completionScore: 0,
    createdAt: null,
    updatedAt: null,
  };
}

function bidNotFound() {
  return NextResponse.json(
    { error: { code: "BID_NOT_FOUND", message: "Bid not found" } },
    { status: 404 },
  );
}

function internalError() {
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    { status: 500 },
  );
}

export async function GET(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  try {
    const { id } = await context.params;
    const bid = await getBidById(id);

    if (!bid) {
      return bidNotFound();
    }

    const profile = isAuthenticatedPrincipal(principal)
      ? await getSupplierProfile(db, principal.userId)
      : emptyPublicProfile(principal.userId);
    const match = calculateBidMatch(bid, profile);

    if (isAuthenticatedPrincipal(principal)) {
      const eventInput = {
        eventName: "marketing.first_matched_bid_viewed" as const,
        actorId: principal.userId,
        targetType: "bid",
        targetId: id,
        source: "marketing.bid-match",
        idempotencyKey: `marketing:first_matched_bid_viewed:${principal.userId}:${id}`,
        metadata: {
          bidId: id,
          score: match.score,
          confidence: match.confidence,
        },
      };

      if (isMysqlDatabaseUrlConfigured()) {
        await recordMarketingFunnelEventFromMysql(resolveMysqlPool(), eventInput);
      } else {
        recordMarketingFunnelEvent(db, eventInput);
      }
    }

    return NextResponse.json({ match });
  } catch {
    return internalError();
  }
}
