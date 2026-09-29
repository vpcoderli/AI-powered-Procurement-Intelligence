import { describe, expect, it } from "vitest";
import { crawlerRunIdFor } from "./crawler-run-id";

describe("crawlerRunIdFor", () => {
  it("resolves the id the manual run route accepts", () => {
    expect(crawlerRunIdFor({ id: "california_caleprocure", issuerType: "state", stateCode: "CA", crawlerSourceId: "ca_caleprocure" })).toBe("ca_caleprocure");
    expect(crawlerRunIdFor({ id: "ca_state", issuerType: "state", stateCode: "CA", crawlerSourceId: null })).toBe("ca_caleprocure");
    expect(crawlerRunIdFor({ id: "bidnet_co_denver", issuerType: "county", stateCode: "CO", crawlerSourceId: null })).toBe("bidnet_co_denver");
    expect(crawlerRunIdFor({ id: "sam_gov", issuerType: "federal", stateCode: "US", crawlerSourceId: null })).toBeNull();
  });
});
