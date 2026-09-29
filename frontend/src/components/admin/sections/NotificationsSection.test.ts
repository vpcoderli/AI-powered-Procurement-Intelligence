import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("notifications section", () => {
  it("loads its own notifications and reloads after delivery", () => {
    const source = readFileSync(new URL("NotificationsSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("listAdminNotifications({ limit: 10 })");
    expect(source).toContain("deliverAdminNotifications(");
    expect(source).toContain('t("admin.notificationDelivery")');
    expect(source).toContain("reload()");
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
