import { describe, expect, it } from "vitest";
import { mergePersistedBid } from "./persistence-merge";

describe("persisted portal contact quality", () => {
  it.each(["Purchase Method: Open Market", "Type Code: IFB", "Bid Type: OPEN", "Informal Bid Flag: No", "Allow Electronic Quote: Yes"])("clears historical metadata contact %s on refresh", (value) => {
    const merged = mergePersistedBid({ title: "Road repair", contact_name: null }, {
      title: "Road repair", contact_name: value, contact_email: "buyer@example.gov", contact_phone: "555-0100",
      raw_payload: { enrichment: { applied_fields: ["contact_name", "contact_email", "contact_phone"] } },
    });
    expect(merged.contact_name).toBeNull();
    expect(merged.contact_email).toBe("buyer@example.gov");
    expect(merged.contact_phone).toBe("555-0100");
    expect(merged.raw_payload).toMatchObject({ enrichment: { persisted_fields: ["contact_email", "contact_phone"] } });
  });

  it("replaces the old metadata value with a valid list contact", () => {
    expect(mergePersistedBid({ title: "Road repair", contact_name: "Jane Buyer" }, {
      title: "Road repair", contact_name: " Purchase   Method : Contract", detail_fetched_at: "2026-09-16T00:00:00Z",
    }).contact_name).toBe("Jane Buyer");
  });

  it("rejects incoming metadata without erasing a protected contact", () => {
    expect(mergePersistedBid({ title: "Road repair", contact_name: "Purchase Method: Contract", raw_payload: { enrichment: { applied_fields: ["contact_name"] } } }, {
      title: "Road repair", contact_name: "Jane Buyer", raw_payload: { enrichment: { applied_fields: ["contact_name"] } },
    }).contact_name).toBe("Jane Buyer");
  });

  it("keeps organization names that merely contain a metadata phrase", () => {
    expect(mergePersistedBid({ title: "Road repair", contact_name: "Office of Purchase Methods" }).contact_name).toBe("Office of Purchase Methods");
  });
});

describe("persisted SAM description quality", () => {
  it("clears historical noticedesc URLs after a failed description fetch", () => {
    const url = "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=abc-123";
    const merged = mergePersistedBid({ title: "Cloud services", description: "", full_description: "", raw_payload: { enrichment: { applied_fields: [] } } }, {
      title: "Cloud services", description: url, full_description: url, detail_fetched_at: "2026-09-16T00:00:00Z",
    });
    expect(merged.description).toBe("");
    expect(merged.full_description).toBeNull();
  });

  it("keeps a real SAM description after a later API failure", () => {
    const merged = mergePersistedBid({ title: "Cloud services", description: "", full_description: "", raw_payload: { enrichment: { applied_fields: [] } } }, {
      title: "Cloud services", description: "Procure cloud services and provide staff training.",
      raw_payload: { enrichment: { applied_fields: ["description"] } },
    });
    expect(merged.description).toBe("Procure cloud services and provide staff training.");
  });
});


describe("persisted semantic description quality", () => {
  it.each(["Please sign in to view this opportunity", "Home\nPrivacy policy\nContact us", "Solicitation", "Bulletin Desc:"])("does not replace a useful body with %s", (body) => {
    const prior = { title: "Road repair", description: "Repair bridges.", raw_payload: { enrichment: { applied_fields: ["description"] } } };
    const merged = mergePersistedBid({ title: prior.title, description: body, raw_payload: { enrichment: { applied_fields: ["description"] } } }, prior);
    expect(merged.description).toBe(prior.description);
  });
});


it("preserves known optional source identity when a refresh omits it", () => {
  expect(mergePersistedBid({ title: "Road repairs", source_bid_id: null, jurisdiction_level: null, fips_code: null }, {
    title: "Road repairs", source_bid_id: "1", jurisdiction_level: "city", fips_code: "1714000",
  })).toMatchObject({ source_bid_id: "1", jurisdiction_level: "city", fips_code: "1714000" });
});
