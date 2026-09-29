import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("notifications section", () => {
  it("loads its own notifications and reloads after delivery", () => {
    const source = readFileSync(new URL("NotificationsSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("listAdminNotifications({ limit: 10 })");
    expect(source).toContain("deliverAdminNotifications(");
    expect(source).toContain('t("admin.notificationDelivery")');
  });

  // A bare `reload()` also matches the error card's retry, so pin the call inside the delivery handler.
  it("awaits a reload of the outbox once a delivery run succeeds", () => {
    const source = readFileSync(new URL("NotificationsSection.tsx", import.meta.url), "utf8");
    const start = source.indexOf("const deliverNotifications = () => {");
    const end = source.indexOf("const notifications = outbox.data", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    expect(source.slice(start, end)).toContain("await outbox.reload();");
  });

  // Moved from src/app/admin/page.test.ts ("renders user access controls alongside crawler operations").
  it("keeps the notification delivery controls it took over from the dashboard page", () => {
    const source = readFileSync(new URL("NotificationsSection.tsx", import.meta.url), "utf8");

    expect(source).toContain("listAdminNotifications");
    expect(source).toContain("deliverAdminNotifications");
    expect(source).toContain('t("admin.deliverNotifications")');
  });

  it("follows the resource render rule and keeps delivery behind the operations role", () => {
    const source = readFileSync(new URL("NotificationsSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("useAdminResource(loadNotifications)");
    expect(source).toContain('code="error"');
    expect(source).toContain('code="loading"');
    expect(source).toContain('t("admin.sectionRefreshFailed")');
    expect(source).toContain("{canRunOperations && (");
  });
});
