import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditLogRequestFor, formatAuditChanges } from "./UserAuditSection";

describe("user audit section", () => {
  it("builds the audit-log request from the filters", () => {
    expect(auditLogRequestFor({})).toMatchObject({ limit: 10 });
    expect(auditLogRequestFor({ target: "  a@b.c  " }).target).toBe("a@b.c");
  });

  it("describes changes", () => {
    expect(formatAuditChanges({ changes: [] } as never)).toBe("-");
    expect(formatAuditChanges({ changes: [{ field: "role", before: "user", after: "admin" }] } as never)).toBe("role: user -> admin");
  });

  it("loads its own logs", () => {
    const source = readFileSync(new URL("UserAuditSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("listAdminUserAuditLogs(auditLogRequestFor(userAuditFilters))");
    expect(source).toContain("useAdminResource(");
  });

  // Moved from src/app/admin/page.test.ts ("renders user access controls alongside crawler operations").
  it("keeps the audit-log filters it took over from the dashboard page", () => {
    const source = readFileSync(new URL("UserAuditSection.tsx", import.meta.url), "utf8");

    expect(source).toContain("listAdminUserAuditLogs");
    expect(source).toContain('t("admin.userAuditLogs")');
    expect(source).toContain('t("admin.auditFilterTarget")');
    expect(source).toContain('t("admin.auditFilterFeature")');
    expect(source).toContain('t("admin.allAuditActors")');
    expect(source).toContain('t("admin.allAuditActions")');
    expect(source).toContain("userAuditFilters");
  });
});

describe("user audit override expiry", () => {
  it("prints an override's end-of-day expiry as the day an admin picked", () => {
    const source = readFileSync(new URL("UserAuditSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("expires=${formatBidDate(value.expiresAt)}");
    expect(source).not.toContain("expires=${formatDate(value.expiresAt)}");
  });
});
