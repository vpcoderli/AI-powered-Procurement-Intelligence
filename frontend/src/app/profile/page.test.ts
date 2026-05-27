import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeDirectory = new URL("./", import.meta.url);

describe("profile page", () => {
  it("renders supplier profile fields and saves through the profile API", () => {
    const page = readFileSync(new URL("page.tsx", routeDirectory), "utf8");

    expect(page).toContain("fetchSupplierProfile");
    expect(page).toContain("updateSupplierProfile");
    expect(page).toContain("companyName");
    expect(page).toContain("serviceStates");
    expect(page).toContain("completionScore");
  });
});
