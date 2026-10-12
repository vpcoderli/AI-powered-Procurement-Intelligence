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

describe("deadline-passed close at import", () => {
  /** 02:00 on 13 October in the deadline zone (UTC-10). */
  const NOW = "2026-10-13T12:00:00.000Z";
  const base = { title: "Road repairs", lifecycle_status: "open", is_active: 1 };

  it("closes an open bid whose deadline has passed and records why in its raw payload", () => {
    const merged = mergePersistedBid({ ...base, deadline_date: "10/12/2026", raw_payload: { portal_id: "A-1" } }, undefined, { now: NOW });
    expect(merged).toMatchObject({ lifecycle_status: "closed", is_active: 0, deadline_date: "10/12/2026" });
    expect(merged.raw_payload).toEqual({ portal_id: "A-1", lifecycle: { closed_reason: "deadline_passed", closed_observed_at: NOW, deadline: "10/12/2026" } });
  });

  it("records the reason on the payload that detail merging builds without losing its enrichment", () => {
    const enrichment = { applied_fields: ["description"], fields: { description: "x" } };
    const merged = mergePersistedBid(
      { ...base, deadline_date: "10/12/2026", description: "Repair bridges and drainage.", raw_payload: { enrichment, lifecycle: { note: "kept" } } },
      { title: "Road repairs", deadline_date: "10/12/2026", raw_payload: { enrichment: { applied_fields: ["description"], fields: { description: "x" } } } },
      { now: NOW },
    );
    expect(merged.raw_payload).toMatchObject({
      enrichment: { applied_fields: ["description"] },
      lifecycle: { note: "kept", closed_reason: "deadline_passed", closed_observed_at: NOW, deadline: "10/12/2026" },
    });
  });

  it("starts a payload when the incoming row has none, and reads a payload sent as JSON text", () => {
    expect(mergePersistedBid({ ...base, deadline_date: "10/12/2026" }, undefined, { now: NOW }).raw_payload)
      .toEqual({ lifecycle: { closed_reason: "deadline_passed", closed_observed_at: NOW, deadline: "10/12/2026" } });
    expect(mergePersistedBid({ ...base, deadline_date: "10/12/2026", raw_payload: JSON.stringify({ a: 1 }) }, undefined, { now: NOW }).raw_payload)
      .toEqual({ a: 1, lifecycle: { closed_reason: "deadline_passed", closed_observed_at: NOW, deadline: "10/12/2026" } });
  });

  it("judges by the stored deadline when the refreshed row has none, and says so", () => {
    const merged = mergePersistedBid({ ...base, deadline_date: null }, { deadline_date: "10/12/2026" }, { now: NOW });
    expect(merged).toMatchObject({ lifecycle_status: "closed", is_active: 0, deadline_date: "10/12/2026" });
    expect(merged.raw_payload).toMatchObject({ lifecycle: { closed_reason: "deadline_passed", deadline: "10/12/2026" } });
  });

  it("leaves a bid open, and its payload alone, while the deadline is ahead", () => {
    const merged = mergePersistedBid({ ...base, deadline_date: "10/14/2026", raw_payload: { portal_id: "A-1" } }, undefined, { now: NOW });
    expect(merged).toMatchObject({ lifecycle_status: "open", is_active: 1 });
    expect(merged.raw_payload).toEqual({ portal_id: "A-1" });
  });

  it("changes nothing without a clock", () => {
    const merged = mergePersistedBid({ ...base, deadline_date: "10/12/2026", raw_payload: { portal_id: "A-1" } });
    expect(merged).toMatchObject({ lifecycle_status: "open", is_active: 1 });
    expect(merged.raw_payload).toEqual({ portal_id: "A-1" });
  });

  it("does not stamp a bid the crawler closed or that stays awarded", () => {
    const closed = mergePersistedBid({ ...base, lifecycle_status: "closed", is_active: 0, deadline_date: "10/12/2026", raw_payload: { portal_id: "A-1" } }, undefined, { now: NOW });
    expect(closed.raw_payload).toEqual({ portal_id: "A-1" });
    const awarded = mergePersistedBid({ ...base, deadline_date: "10/12/2026", raw_payload: { portal_id: "A-1" } }, { lifecycle_status: "awarded" }, { now: NOW });
    expect(awarded).toMatchObject({ lifecycle_status: "awarded", is_active: 0 });
    expect(awarded.raw_payload).toEqual({ portal_id: "A-1" });
  });

  it("reopens a closed bid whose refreshed deadline is ahead, with no stale closed_reason", () => {
    const stale = { portal_id: "A-1", lifecycle: { closed_reason: "deadline_passed", closed_observed_at: "2026-10-01T00:00:00.000Z", deadline: "10/01/2026" } };
    const merged = mergePersistedBid(
      { ...base, deadline_date: "10/20/2026", raw_payload: { portal_id: "A-1" } },
      { title: "Road repairs", lifecycle_status: "closed", is_active: 0, deadline_date: "10/01/2026", raw_payload: stale },
      { now: NOW },
    );
    expect(merged).toMatchObject({ lifecycle_status: "open", is_active: 1, deadline_date: "10/20/2026" });
    expect(merged.raw_payload).toEqual({ portal_id: "A-1" });
    expect(JSON.stringify(merged.raw_payload)).not.toContain("closed_reason");
  });

  it("does not carry a stale closed_reason through detail merging either", () => {
    const stale = { enrichment: { applied_fields: ["description"] }, lifecycle: { closed_reason: "deadline_passed", closed_observed_at: "2026-10-01T00:00:00.000Z" } };
    const merged = mergePersistedBid(
      { ...base, deadline_date: "10/20/2026", description: "Repair bridges.", raw_payload: { enrichment: { applied_fields: ["description"] } } },
      { title: "Road repairs", lifecycle_status: "closed", is_active: 0, description: "Repair bridges.", raw_payload: stale },
      { now: NOW },
    );
    expect(merged).toMatchObject({ lifecycle_status: "open", is_active: 1 });
    expect(JSON.stringify(merged.raw_payload)).not.toContain("closed_reason");
  });
});
