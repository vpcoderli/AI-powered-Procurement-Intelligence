import { describe, expect, it } from "vitest";
import { detailAccessFromRawPayload } from "./bid-access";

describe("detailAccessFromRawPayload", () => {
  it("reads the platform and the restricted fields from raw_payload", () => {
    const raw = JSON.stringify({ detail_access: { platform: "BidNet", restricted: ["description", "documents", "contact"] } });
    expect(detailAccessFromRawPayload(raw)).toEqual({ platform: "BidNet", restricted: ["description", "documents", "contact"] });
  });

  it("ignores unknown fields and returns null when nothing usable is restricted", () => {
    expect(detailAccessFromRawPayload({ detail_access: { platform: "BidNet", restricted: ["documents", "price"] } })).toEqual({ platform: "BidNet", restricted: ["documents"] });
    expect(detailAccessFromRawPayload({ detail_access: { platform: "BidNet", restricted: [] } })).toBeNull();
    expect(detailAccessFromRawPayload({ detail_access: { restricted: ["documents"] } })).toBeNull();
    expect(detailAccessFromRawPayload("not json")).toBeNull();
    expect(detailAccessFromRawPayload(null)).toBeNull();
  });
});
