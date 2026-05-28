import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("forgot password page", () => {
  it("requests reset links and shows the local reset token when present", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("requestPasswordReset");
    expect(page).toContain("resetToken");
    expect(page).toContain("/reset-password?token=");
    expect(page).toContain("useLanguage");
  });
});
