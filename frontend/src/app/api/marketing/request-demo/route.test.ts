import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createMarketingRequestDemoPost } from "./route";

describe("POST /api/marketing/request-demo", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("rejects invalid lead payloads without writing an event", async () => {
    const POST = createMarketingRequestDemoPost(testDb.db);
    const response = await POST(
      new Request("http://localhost/api/marketing/request-demo", {
        method: "POST",
        body: JSON.stringify({ email: "not-an-email", companyName: "" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(testDb.db.$client.prepare("SELECT COUNT(*) AS count FROM event_log").get()).toEqual({ count: 0 });
  });

  it("records the lead and returns the local demo registration URL", async () => {
    const POST = createMarketingRequestDemoPost(testDb.db);
    const response = await POST(
      new Request("http://localhost/api/marketing/request-demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "buyer@example.com",
          fullName: "Buyer One",
          companyName: "Acme Supply",
          role: "founder",
          serviceStates: ["CA", "TX"],
          language: "en",
        }),
      }),
    );
    const body = await response.json();
    const row = testDb.db.$client
      .prepare("SELECT event_name, metadata_json FROM event_log WHERE id = ?")
      .get(body.lead.id) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body.lead.nextUrl).toBe(`/register?intent=demo&lead=${encodeURIComponent(body.lead.id)}`);
    expect(row.event_name).toBe("marketing.request_demo_submitted");
    expect(JSON.parse(String(row.metadata_json))).toMatchObject({
      email: "buyer@example.com",
      companyName: "Acme Supply",
      serviceStates: ["CA", "TX"],
    });
  });

  it("queues a local operator notification and CRM handoff for valid leads", async () => {
    const POST = createMarketingRequestDemoPost(testDb.db);
    const response = await POST(
      new Request("http://localhost/api/marketing/request-demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "operator-lead@example.com",
          fullName: "Operator Lead",
          companyName: "Procurement Growth LLC",
          role: "proposal lead",
          serviceStates: ["NY", "FL"],
          notes: "Interested in response workspace.",
          language: "en",
        }),
      }),
    );
    const body = await response.json();
    const notification = testDb.db.$client
      .prepare("SELECT alert_id, user_id, recipient, dedupe_key, subject, body_text, matched_bid_ids, status FROM notification_outbox")
      .get() as Record<string, unknown>;
    const crmOutbox = testDb.db.$client
      .prepare(`
        SELECT event_log.event_name, event_log.target_id, event_outbox.destination, event_outbox.status
        FROM event_outbox
        JOIN event_log ON event_log.id = event_outbox.event_log_id
        WHERE event_log.target_id = ?
      `)
      .get(body.lead.id) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(notification).toMatchObject({
      alert_id: "marketing_request_demo",
      user_id: "marketing_ops",
      recipient: "marketing-ops@winbids.local",
      dedupe_key: `marketing:request_demo:${body.lead.id}:notification`,
      status: "pending",
    });
    expect(notification.subject).toBe("New WinBids demo request: Procurement Growth LLC");
    expect(String(notification.body_text)).toContain("operator-lead@example.com");
    expect(String(notification.body_text)).toContain("Interested in response workspace.");
    expect(JSON.parse(String(notification.matched_bid_ids))).toEqual([]);
    expect(crmOutbox).toMatchObject({
      event_name: "marketing.crm_handoff_queued",
      target_id: body.lead.id,
      destination: "crm.marketing_leads",
      status: "pending",
    });
  });

  it("rejects honeypot bot submissions without writing lead, notification, or CRM events", async () => {
    const POST = createMarketingRequestDemoPost(testDb.db);
    const response = await POST(
      new Request("http://localhost/api/marketing/request-demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "spam@example.com",
          companyName: "Bot Corp",
          websiteUrl: "https://spam.example",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("SPAM_REJECTED");
    expect(testDb.db.$client.prepare("SELECT COUNT(*) AS count FROM event_log").get()).toEqual({ count: 0 });
    expect(testDb.db.$client.prepare("SELECT COUNT(*) AS count FROM notification_outbox").get()).toEqual({ count: 0 });
    expect(testDb.db.$client.prepare("SELECT COUNT(*) AS count FROM event_outbox").get()).toEqual({ count: 0 });
  });
});
