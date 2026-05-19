import { describe, expect, it } from "vitest";
import { renderAlertDigestNotification } from "./renderer";

describe("notification renderer", () => {
  it("renders an alert digest subject and bid links", () => {
    const output = renderAlertDigestNotification({
      alertName: "Cloud alerts",
      frequency: "daily",
      bids: [
        {
          id: "bid_1",
          title: "Cloud modernization",
          issuerName: "General Services Administration",
          sourceUrl: "https://sam.gov/opp/bid_1",
          deadlineDate: "2026-06-01",
        },
      ],
    });

    expect(output.subject).toBe("APSi daily alert: Cloud alerts (1 match)");
    expect(output.bodyText).toContain("Cloud alerts");
    expect(output.bodyText).toContain("Cloud modernization");
    expect(output.bodyText).toContain("https://sam.gov/opp/bid_1");
  });
});
