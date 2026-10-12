import { describe, expect, it } from "vitest";
import { crawlerRunIdFor } from "./crawler-run-id";

describe("crawlerRunIdFor", () => {
  it("resolves the id the manual run route accepts", () => {
    expect(crawlerRunIdFor({ id: "california_caleprocure", issuerType: "state", stateCode: "CA", crawlerSourceId: "ca_caleprocure" })).toBe("ca_caleprocure");
    expect(crawlerRunIdFor({ id: "ca_state", issuerType: "state", stateCode: "CA", crawlerSourceId: null })).toBe("ca_caleprocure");
    expect(crawlerRunIdFor({ id: "bidnet_co_denver", issuerType: "county", stateCode: "CO", crawlerSourceId: null })).toBe("bidnet_co_denver");
    expect(crawlerRunIdFor({ id: "sam_gov", issuerType: "federal", stateCode: "US", crawlerSourceId: null })).toBeNull();
  });

  it.each(["county", "city", "township", "special_district"])("runs a registered %s by its own id despite a raw state issuer and alias", (jurisdictionLevel) => {
    expect(crawlerRunIdFor({ id: "city_portal", issuerType: "state", jurisdictionLevel, stateCode: "IL", crawlerSourceId: "il_bidbuy" })).toBe("city_portal");
  });

  it("never sends a registered federal source to the state route", () => {
    expect(crawlerRunIdFor({ id: "federal_portal", issuerType: "state", jurisdictionLevel: "federal", stateCode: "IL", crawlerSourceId: "il_bidbuy" })).toBeNull();
  });

  it("retains the state alias fallback when a legacy jurisdiction level is empty", () => {
    expect(crawlerRunIdFor({ id: "ca_state", issuerType: "state", jurisdictionLevel: "", stateCode: "CA", crawlerSourceId: null })).toBe("ca_caleprocure");
  });

  it("falls back to the legacy issuer when the registered jurisdiction is unrecognized", () => {
    expect(crawlerRunIdFor({ id: "ca_state", issuerType: "state", jurisdictionLevel: "legacy_unknown", stateCode: "CA", crawlerSourceId: null })).toBe("ca_caleprocure");
    expect(crawlerRunIdFor({ id: "sam_gov", issuerType: "federal", jurisdictionLevel: "legacy_unknown", stateCode: "IL", crawlerSourceId: "il_bidbuy" })).toBeNull();
  });
});
