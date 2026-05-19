import { describe, expect, it } from "vitest";
import { stateCrawlerSourceIdForAdminSource } from "./state-crawler-sources";

describe("state crawler source mapping", () => {
  it("maps seeded admin state sources to crawler source ids", () => {
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: "CA" })).toBe("ca_caleprocure");
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: "TX" })).toBe("tx_esbd");
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: "NY" })).toBe("ny_contract_reporter");
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: "FL" })).toBe("fl_mfmp");
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: "IL" })).toBe("il_bidbuy");
  });

  it("does not map federal or unsupported state sources", () => {
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "federal", stateCode: "US" })).toBeNull();
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: "WA" })).toBeNull();
  });
});
