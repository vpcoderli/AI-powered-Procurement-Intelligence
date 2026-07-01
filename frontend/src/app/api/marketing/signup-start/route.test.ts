import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createMarketingSignupStartPost } from "./route";

describe("POST /api/marketing/signup-start", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("records a start-signup funnel event without requiring credentials", async () => {
    const POST = createMarketingSignupStartPost(testDb.db);
    const response = await POST(
      new Request("http://localhost/api/marketing/signup-start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketingIntent: "demo",
          leadEventId: "event_lead",
          language: "zh",
          sourcePath: "/register",
        }),
      }),
    );
    const body = await response.json();
    const row = testDb.db.$client
      .prepare("SELECT event_name, source, target_id, metadata_json FROM event_log WHERE id = ?")
      .get(body.event.id) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(row).toMatchObject({
      event_name: "marketing.start_signup",
      source: "marketing.signup-start",
      target_id: "event_lead",
    });
    expect(JSON.parse(String(row.metadata_json))).toMatchObject({
      marketingIntent: "demo",
      leadEventId: "event_lead",
      language: "zh",
      sourcePath: "/register",
    });
  });

  it("rejects invalid marketing intent values", async () => {
    const POST = createMarketingSignupStartPost(testDb.db);
    const response = await POST(
      new Request("http://localhost/api/marketing/signup-start", {
        method: "POST",
        body: JSON.stringify({ marketingIntent: "password-reset" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(testDb.db.$client.prepare("SELECT COUNT(*) AS count FROM event_log").get()).toEqual({ count: 0 });
  });
});
