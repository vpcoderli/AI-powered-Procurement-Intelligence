import { describe, expect, it } from "vitest";
import { bidDataQualityFromRawPayload, getBidCoreIssues, getBidUsability } from "./bid-usability";

const bid = { id: "sqlite_bid_1", title: "Water pump supply", issuerName: "Boston Public Works", issuerType: "city", stateCode: "MA", sourceUrl: "https://agency.example.gov/projects/1/" };

describe("bid core contract", () => {
  it("treats incomplete quality metadata as unknown rather than trusting or rendering it", () => {
    expect(bidDataQualityFromRawPayload(JSON.stringify({ data_quality: {
      coreValid: true, capabilities: { discovery: true, analysis: true }, body: { valid: true },
    } }))).toBeNull();
  });
  it.each(["unknown", "null", "undefined", "source:unknown", "source:null"])("rejects placeholder identity %s", (id) => {
    expect(getBidCoreIssues({ ...bid, id })).toContain("missing_identity");
  });
  it("rejects a supplied placeholder source identity even with an opaque internal primary id", () => {
    expect(getBidCoreIssues({ ...bid, sourceBidId: "unknown" })).toContain("missing_identity");
  });
  it("rejects source locators containing an API credential", () => {
    expect(getBidCoreIssues({ ...bid, sourceUrl: "https://agency.example.gov/projects/1?api_key=secret" })).toContain("invalid_source_url");
  });
  it.each([
    { jurisdictionLevel: "city", fipsCode: "2507000" },
    { issuerType: "county", jurisdictionLevel: "county", fipsCode: "25025" },
    { issuerType: "state", jurisdictionLevel: "state", fipsCode: "25" },
    { issuerType: "township", jurisdictionLevel: "township", fipsCode: "2502507000" },
  ])("accepts supplied valid FIPS %j", (geo) => {
    expect(getBidCoreIssues({ ...bid, ...geo })).toEqual([]);
  });
  it.each(["3607000", "2507", "not-a-fips"])("rejects invalid/mismatched supplied city FIPS %s", (fipsCode) => {
    expect(getBidCoreIssues({ ...bid, fipsCode })).toContain("invalid_fips_code");
  });
  it("allows opaque legacy ids and source identity on a public root URL", () => {
    expect(getBidCoreIssues(bid)).toEqual([]);
    expect(getBidCoreIssues({ ...bid, sourceUrl: "https://agency.example.gov/", sourceBidId: "WATER-1" })).toEqual([]);
    expect(getBidCoreIssues({ ...bid, sourceUrl: "https://agency.example.gov/" })).toContain("missing_source_locator");
  });
  it("does not infer freshness from row update time or impose a body-length cutoff", () => {
    expect(getBidUsability({ ...bid, description: "Supply 12 pumps." })).toMatchObject({
      discovery: true, analysis: true, bodyStatus: "ready", bodyVerifiedAt: null,
    });
  });
});
