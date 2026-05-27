import type { Bid } from "@/server/bids/domain";
import type { BidMatchResult } from "@/server/match/types";
import type { GeneratedIntentContent } from "./types";

const CHECKLIST = [
  "Read the full solicitation and all attachments.",
  "Confirm eligibility, registrations, and required certifications.",
  "Map requirements to internal owners and delivery capabilities.",
  "Build a submission calendar with question and proposal deadlines.",
  "Review pricing assumptions and contract value fit.",
  "Identify required partners, subcontractors, or sourcing needs.",
  "Prepare a pursuit decision summary for leadership review.",
] as const;

function daysBetween(start: string, end: string) {
  const startDate = Date.parse(`${start}T00:00:00.000Z`);
  const endDate = Date.parse(`${end}T00:00:00.000Z`);

  if (!Number.isFinite(startDate) || !Number.isFinite(endDate)) {
    return null;
  }

  return Math.ceil((endDate - startDate) / (24 * 60 * 60 * 1000));
}

function riskFlagsForBid(bid: Bid, match: BidMatchResult) {
  const flags = [...match.riskNotes];
  const responseWindowDays = daysBetween(bid.publishedDate, bid.deadlineDate);

  if (responseWindowDays !== null && responseWindowDays >= 0 && responseWindowDays <= 7) {
    flags.push("Response window is 7 days or less.");
  }

  if (bid.attachments.length === 0) {
    flags.push("No attachments are available.");
  }

  if (bid.amount.trim().length === 0) {
    flags.push("Estimated value is missing.");
  }

  if (bid.contactEmail.trim().length === 0 || bid.contactPhone.trim().length === 0) {
    flags.push("Contact information is incomplete.");
  }

  return [...new Set(flags)];
}

export function generateIntentBrief({
  bid,
  match,
}: {
  bid: Bid;
  match: BidMatchResult;
}): GeneratedIntentContent {
  const attachmentSummary =
    bid.attachments.length > 0
      ? `${bid.attachments.length} attachment${bid.attachments.length === 1 ? "" : "s"} available`
      : "no attachments listed";

  return {
    aiBidBrief: [
      `${bid.issuerName} is seeking ${bid.title}.`,
      `The opportunity is categorized as ${bid.originalCategory || "unspecified"} in ${bid.stateCode}.`,
      `The current match score is ${match.score} (${match.confidence} confidence): ${match.explanation}`,
      `Published ${bid.publishedDate || "date unavailable"} with deadline ${bid.deadlineDate || "date unavailable"}; ${attachmentSummary}.`,
    ].join(" "),
    keyDates: {
      publishedDate: bid.publishedDate,
      deadlineDate: bid.deadlineDate,
    },
    initialChecklist: [...CHECKLIST],
    riskFlags: riskFlagsForBid(bid, match),
  };
}
