import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeDirectory = new URL("./", import.meta.url);

describe("profile page", () => {
  it("renders supplier profile fields and saves through the profile API", () => {
    const page = readFileSync(new URL("page.tsx", routeDirectory), "utf8");

    expect(page).toContain("fetchSupplierProfile");
    expect(page).toContain("updateSupplierProfile");
    expect(page).toContain("companyName");
    expect(page).toContain("businessTypes");
    expect(page).toContain("serviceStates");
    expect(page).toContain("completionScore");
    expect(page).toContain("mountedRef");
    expect(page).toContain("invalidContractValue");
    expect(page).toContain("return null");
    expect(page).toContain("winbids-workspace");
    expect(page).toContain("winbids-hero-panel");
    expect(page).toContain("winbids-panel");
  });

  it("shows an auth-required state before loading supplier profile data", () => {
    const page = readFileSync(new URL("page.tsx", routeDirectory), "utf8");

    expect(page).toContain("AuthRequiredState");
    expect(page).toContain("useAuth");
    expect(page).toContain("ProfileContent");
  });
});
