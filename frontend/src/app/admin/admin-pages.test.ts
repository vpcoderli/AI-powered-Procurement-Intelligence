import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGES: Array<[file: string, section: string]> = [
  ["users/page.tsx", "<UsersSection />"],
  ["users/audit/page.tsx", "<UserAuditSection />"],
  ["notifications/page.tsx", "<NotificationsSection />"],
  ["growth/page.tsx", "<GrowthFunnelSection />"],
  ["config/page.tsx", "<ConfigRegistrySection />"],
];

describe("admin pages", () => {
  it.each(PAGES)("%s is a thin client page rendering %s", (file, section) => {
    const page = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(page.startsWith('"use client"')).toBe(true);
    expect(page).toContain(section);
  });
});
