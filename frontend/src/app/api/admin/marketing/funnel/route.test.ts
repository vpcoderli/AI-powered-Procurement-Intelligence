import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { recordMarketingFunnelEvent, recordRequestDemoLead } from "@/server/marketing/funnel";
import { createAdminMarketingFunnelGet } from "./route";

describe("GET /api/admin/marketing/funnel", () => {
  let testDb: TestDatabase;
  const originalBypass = process.env.ADMIN_UI_LOCAL_BYPASS;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    delete process.env.ADMIN_UI_LOCAL_BYPASS;
  });

  afterEach(async () => {
    await testDb.cleanup();
    if (originalBypass === undefined) {
      delete process.env.ADMIN_UI_LOCAL_BYPASS;
    } else {
      process.env.ADMIN_UI_LOCAL_BYPASS = originalBypass;
    }
  });

  it("requires admin access", async () => {
    const GET = createAdminMarketingFunnelGet(testDb.db);
    const response = await GET(new Request("http://localhost/api/admin/marketing/funnel"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns funnel metrics for local admin bypass", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
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

    const GET = createAdminMarketingFunnelGet(testDb.db);
    const response = await GET(new Request("http://localhost/api/admin/marketing/funnel"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary.counts).toMatchObject({
      requestDemoSubmitted: 1,
      completeSignup: 1,
    });
    expect(body.summary.latestRequestDemoLeads[0]).toMatchObject({
      eventId: lead.id,
      email: "buyer@example.com",
    });
  });
});
