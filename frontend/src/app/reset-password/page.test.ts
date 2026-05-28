import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("reset password page", () => {
  it("confirms reset tokens from the query string", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("confirmPasswordReset");
    expect(page).toContain("useSearchParams");
    expect(page).toContain("new-password");
    expect(page).toContain("/login");
  });
});
