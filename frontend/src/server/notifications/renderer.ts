import type { NotificationBidSummary, NotificationFrequency } from "./types";

export interface AlertDigestRenderInput {
  alertName: string;
  frequency: NotificationFrequency;
  bids: NotificationBidSummary[];
}

export interface AlertDigestRenderOutput {
  subject: string;
  bodyText: string;
}

export function renderAlertDigestNotification(input: AlertDigestRenderInput): AlertDigestRenderOutput {
  const matchLabel = input.bids.length === 1 ? "match" : "matches";
  const subject = `APSi ${input.frequency} alert: ${input.alertName} (${input.bids.length} ${matchLabel})`;
  const bidLines = input.bids
    .map((bid, index) =>
      [
        `${index + 1}. ${bid.title}`,
        `   Issuer: ${bid.issuerName}`,
        `   Deadline: ${bid.deadlineDate || "Not provided"}`,
        `   Link: ${bid.sourceUrl}`,
      ].join("\n"),
    )
    .join("\n\n");

  return {
    subject,
    bodyText: [
      `Alert: ${input.alertName}`,
      `Frequency: ${input.frequency}`,
      `Matches: ${input.bids.length}`,
      "",
      bidLines,
    ].join("\n"),
  };
}
