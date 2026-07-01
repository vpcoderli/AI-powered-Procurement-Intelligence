import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { recordRequestDemoLead } from "@/server/marketing/funnel";
import { queueRequestDemoLeadOperations } from "@/server/marketing/ops";
import { createAdminMarketingLeadsExportGet } from "./route";

describe("GET /api/admin/marketing/leads/export", () => {
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
    const GET = createAdminMarketingLeadsExportGet(testDb.db);
    const response = await GET(new Request("http://localhost/api/admin/marketing/leads/export"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns a CSV attachment for local admin bypass", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
    const leadInput = {
      email: "admin-export@example.com",
      companyName: "Export Co",
      language: "en" as const,
      occurredAt: "2026-06-30T00:00:00.000Z",
    };
    const lead = recordRequestDemoLead(testDb.db, leadInput);
    queueRequestDemoLeadOperations(testDb.db, {
      lead,
      leadInput,
      occurredAt: "2026-06-30T00:00:01.000Z",
    });

    const GET = createAdminMarketingLeadsExportGet(testDb.db);
    const response = await GET(new Request("http://localhost/api/admin/marketing/leads/export"));
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("winbids-marketing-leads.csv");
    expect(csv).toContain("admin-export@example.com");
    expect(csv).toContain("pending");
    expect(csv).toContain(lead.id);
  });
});
