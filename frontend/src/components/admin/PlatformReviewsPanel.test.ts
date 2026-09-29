import { describe, expect, it } from "vitest";
import { PLATFORM_ACCESS_BOUNDARY } from "@/server/admin/platform-reviews-repository";
import {
  ACCESS_BOUNDARY_TEXT,
  buildPlatformReviewInput,
  defaultPlatformReviewForm,
  platformReviewDateLabel,
  platformReviewStatusTone,
  renewPlatformReviewForm,
} from "./PlatformReviewsPanel";

const NOW = new Date("2026-09-29T08:00:00.000Z");

describe("PlatformReviewsPanel helpers", () => {
  it("defaults dates to today, now and today + 12 months", () => {
    const form = defaultPlatformReviewForm(NOW, "bidnet");
    expect(form).toMatchObject({ providerFamily: "bidnet", tosReviewedAt: "2026-09-29", robotsCheckedAt: NOW.toISOString(), nextReviewAt: "2027-09-29", legalOpinionReference: "", notes: "" });
  });

  it("builds the request with trimmed values and nulls for empty optionals", () => {
    const input = buildPlatformReviewInput({ ...defaultPlatformReviewForm(NOW, " BidNet "), tosUrl: " https://www.bidnetdirect.com/tsandcs ", robotsUrl: "https://www.bidnetdirect.com/robots.txt", robotsSummary: " ok " }, "apsi.lily@gmail.com");
    expect(input).toMatchObject({ providerFamily: "bidnet", tosUrl: "https://www.bidnetdirect.com/tsandcs", robotsSummary: "ok", reviewer: "apsi.lily@gmail.com", legalOpinionReference: null, notes: null });
  });

  it("tones statuses", () => {
    expect(platformReviewStatusTone("valid")).toContain("emerald");
    expect(platformReviewStatusTone("expired")).toContain("rose");
    expect(platformReviewStatusTone("missing")).toContain("amber");
  });
});

describe("PlatformReviewsPanel renewal and display helpers", () => {
  it("renews with fresh dates, carries over only the two addresses and makes the checks be restated", () => {
    const form = renewPlatformReviewForm(
      { providerFamily: "bidnet", tosUrl: "https://www.bidnetdirect.com/tsandcs", robotsUrl: "https://www.bidnetdirect.com/robots.txt" },
      NOW,
    );
    expect(form).toEqual({
      providerFamily: "bidnet",
      tosUrl: "https://www.bidnetdirect.com/tsandcs",
      tosReviewedAt: "2026-09-29",
      robotsUrl: "https://www.bidnetdirect.com/robots.txt",
      robotsCheckedAt: NOW.toISOString(),
      robotsSummary: "",
      legalOpinionReference: "",
      nextReviewAt: "2027-09-29",
      notes: "",
    });
  });

  it("shows a stored timestamp as its date and leaves any other value as stored", () => {
    expect(platformReviewDateLabel("2026-09-29T08:00:00.000Z")).toBe("2026-09-29");
    expect(platformReviewDateLabel("2027-09-29")).toBe("2027-09-29");
    expect(platformReviewDateLabel("next spring")).toBe("next spring");
  });

  it("states the same access boundary the server writes by default", () => {
    // The panel cannot import the server constant at runtime; this keeps the two copies from drifting.
    expect(ACCESS_BOUNDARY_TEXT).toBe(PLATFORM_ACCESS_BOUNDARY);
  });
});
