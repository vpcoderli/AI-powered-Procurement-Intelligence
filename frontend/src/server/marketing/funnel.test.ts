import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  getMarketingFunnelSummary,
  getMarketingFunnelSummaryFromMysql,
  recordMarketingFunnelEvent,
  recordRequestDemoLead,
} from "./funnel";

describe("marketing funnel events", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("stores request-demo submissions as durable sanitized marketing events", () => {
    const lead = recordRequestDemoLead(testDb.db, {
      email: " Buyer@Example.COM ",
      fullName: " Buyer One ",
      companyName: " Acme Supply ",
      role: "owner",
      serviceStates: ["ca", " TX ", ""],
      notes: " Need a walkthrough ",
      language: "zh",
      sourcePath: "/request-demo",
      occurredAt: "2026-06-30T00:00:00.000Z",
    });

    const row = testDb.db.$client
      .prepare("SELECT event_name, source, outcome, retention_class, metadata_json FROM event_log WHERE id = ?")
      .get(lead.id) as Record<string, unknown>;
    const metadata = JSON.parse(String(row.metadata_json));

    expect(lead.nextUrl).toBe(`/register?intent=demo&lead=${encodeURIComponent(lead.id)}`);
    expect(row).toMatchObject({
      event_name: "marketing.request_demo_submitted",
      source: "marketing.request-demo",
      outcome: "success",
      retention_class: "marketing",
    });
    expect(metadata).toMatchObject({
      email: "buyer@example.com",
      fullName: "Buyer One",
      companyName: "Acme Supply",
      role: "owner",
      serviceStates: ["CA", "TX"],
      language: "zh",
      sourcePath: "/request-demo",
    });
    expect(JSON.stringify(metadata)).not.toMatch(/password|secret|token/i);
  });

  it("summarizes local request, signup, and supplier-profile conversion events for admin", () => {
    const lead = recordRequestDemoLead(testDb.db, {
      email: "buyer@example.com",
      companyName: "Acme Supply",
      occurredAt: "2026-06-30T00:00:00.000Z",
    });
    recordMarketingFunnelEvent(testDb.db, {
      eventName: "marketing.complete_signup",
      actorId: "user_1",
      targetId: lead.id,
      metadata: { marketingIntent: "demo", leadEventId: lead.id },
      occurredAt: "2026-06-30T00:01:00.000Z",
    });
    recordMarketingFunnelEvent(testDb.db, {
      eventName: "marketing.start_supplier_profile",
      actorId: "user_1",
      targetId: "user_1",
      metadata: { completionScore: 25 },
      occurredAt: "2026-06-30T00:02:00.000Z",
    });
    recordMarketingFunnelEvent(testDb.db, {
      eventName: "marketing.complete_supplier_profile",
      actorId: "user_1",
      targetId: "user_1",
      metadata: { completionScore: 75 },
      occurredAt: "2026-06-30T00:03:00.000Z",
    });

    const summary = getMarketingFunnelSummary(testDb.db);

    expect(summary.counts).toEqual({
      requestDemoSubmitted: 1,
      startSignup: 0,
      completeSignup: 1,
      startSupplierProfile: 1,
      completeSupplierProfile: 1,
      firstMatchedBidViewed: 0,
    });
    expect(summary.latestRequestDemoLeads).toEqual([
      expect.objectContaining({
        eventId: lead.id,
        email: "buyer@example.com",
        companyName: "Acme Supply",
      }),
    ]);
  });

  it("deduplicates first matched bid events through idempotency keys", () => {
    const first = recordMarketingFunnelEvent(testDb.db, {
      eventName: "marketing.first_matched_bid_viewed",
      actorId: "user_1",
      targetType: "bid",
      targetId: "bid_1",
      idempotencyKey: "marketing:first_matched_bid_viewed:user_1:bid_1",
      metadata: { score: 81 },
      occurredAt: "2026-06-30T00:04:00.000Z",
    });
    const second = recordMarketingFunnelEvent(testDb.db, {
      eventName: "marketing.first_matched_bid_viewed",
      actorId: "user_1",
      targetType: "bid",
      targetId: "bid_1",
      idempotencyKey: "marketing:first_matched_bid_viewed:user_1:bid_1",
      metadata: { score: 95 },
      occurredAt: "2026-06-30T00:05:00.000Z",
    });

    expect(second.id).toBe(first.id);
    expect(getMarketingFunnelSummary(testDb.db).counts.firstMatchedBidViewed).toBe(1);
  });

  it("summarizes marketing events from a MySQL-compatible query store", async () => {
    const mysql = {
      query: async () => [[
        {
          id: "event_1",
          event_name: "marketing.request_demo_submitted",
          occurred_at: "2026-06-30T00:00:00.000Z",
          metadata_json: JSON.stringify({ email: "buyer@example.com", companyName: "Acme Supply" }),
        },
        {
          id: "event_2",
          event_name: "marketing.complete_signup",
          occurred_at: "2026-06-30T00:01:00.000Z",
          metadata_json: JSON.stringify({ marketingIntent: "demo", leadEventId: "event_1" }),
        },
      ], undefined],
    };

    await expect(getMarketingFunnelSummaryFromMysql(mysql)).resolves.toMatchObject({
      counts: {
        requestDemoSubmitted: 1,
        completeSignup: 1,
      },
      latestRequestDemoLeads: [
        {
          eventId: "event_1",
          occurredAt: "2026-06-30T00:00:00.000Z",
          email: "buyer@example.com",
          companyName: "Acme Supply",
        },
      ],
    });
  });
});
