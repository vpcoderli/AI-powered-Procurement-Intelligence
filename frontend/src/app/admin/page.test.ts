import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin page", () => {
  it("renders user access controls alongside crawler operations", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("listAdminUsers");
    expect(page).toContain("createAdminUser");
    expect(page).toContain("listAdminUserAuditLogs");
    expect(page).toContain("listAdminNotifications");
    expect(page).toContain("deliverAdminNotifications");
    expect(page).toContain("updateAdminUserAccess");
    expect(page).toContain("useAuth");
    expect(page).toContain("isAdmin");
    expect(page).toContain('t("admin.authLoading")');
    expect(page).toContain('t("admin.loginRequiredTitle")');
    expect(page).toContain('t("admin.forbiddenTitle")');
    expect(page).toContain('if (!isAdmin) return');
    expect(page).toContain('t("admin.users")');
    expect(page).toContain('t("admin.inviteUser")');
    expect(page).toContain('t("admin.temporaryPassword")');
    expect(page).toContain("invitationDraft");
    expect(page).toContain("handleCreateAdminUser");
    expect(page).toContain('t("admin.userAuditLogs")');
    expect(page).toContain("userFilters");
    expect(page).toContain("USER_ROLES");
    expect(page).toContain("ACCOUNT_TIERS");
    expect(page).toContain('t("admin.notificationDelivery")');
    expect(page).toContain('t("admin.deliverNotifications")');
  });
});
