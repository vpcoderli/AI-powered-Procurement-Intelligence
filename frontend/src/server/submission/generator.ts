import type { Bid } from "@/server/bids/domain";
import type { GeneratedSubmissionGuidance, SubmissionMethod } from "./types";

interface GenerateOptions {
  now?: Date;
}

function daysUntil(deadlineDate: string, now: Date) {
  if (!deadlineDate) return null;

  const deadline = new Date(`${deadlineDate}T23:59:59.999Z`);
  const diff = deadline.getTime() - now.getTime();

  if (Number.isNaN(diff)) return null;

  return Math.ceil(diff / 86_400_000);
}

function includesAny(value: string, needles: string[]) {
  const normalized = value.toLowerCase();

  return needles.some((needle) => normalized.includes(needle));
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, score));
}

export function generateSubmissionGuidance(
  bid: Bid,
  options: GenerateOptions = {},
): GeneratedSubmissionGuidance {
  const now = options.now ?? new Date();
  const text = `${bid.title} ${bid.description} ${bid.fullDescription}`;
  const sourceUrl = bid.sourceUrl.trim();
  const source = bid.source.toLowerCase();
  const contactEmail = bid.contactEmail.trim();
  const hasPortal = sourceUrl.length > 0 && (
    source.includes("sam.gov") ||
    source.includes("portal") ||
    includesAny(sourceUrl, ["sam.gov", "bonfire", "ionwave", "bidnet", "planetbids", "procurement"])
  );
  const requiresPhysicalDelivery = includesAny(text, [
    "sealed bid",
    "hard copy",
    "physical delivery",
    "mail ",
    "mailed",
  ]);
  const requiresAddendaAcknowledgement = includesAny(text, [
    "addenda",
    "addendum",
    "acknowledgement",
    "acknowledgment",
  ]);
  const responseWindowDays = daysUntil(bid.deadlineDate, now);
  const riskFlags: string[] = [];
  const readinessChecklist = [
    "Review the solicitation and confirm the official submission instructions.",
    "Verify the due date and timezone before preparing the response.",
  ];

  let method: SubmissionMethod = "unknown";

  if (hasPortal && requiresPhysicalDelivery) {
    method = "mixed";
  } else if (hasPortal) {
    method = "external_portal";
  } else if (requiresPhysicalDelivery) {
    method = "physical_delivery";
  } else if (contactEmail) {
    method = "email";
  }

  if (hasPortal) {
    readinessChecklist.push("Confirm portal account access and registration before the deadline.");
  }

  if (contactEmail) {
    readinessChecklist.push("Use the listed buyer contact as a fallback clarification channel.");
  }

  if (bid.attachments.length > 0) {
    readinessChecklist.push("Review every solicitation attachment before preparing the response.");
  }

  if (requiresAddendaAcknowledgement) {
    readinessChecklist.push("Check whether addenda acknowledgement must be included.");
    riskFlags.push("Addenda acknowledgement may be required.");
  }

  if (requiresPhysicalDelivery) {
    readinessChecklist.push("Confirm shipping, hand delivery, and hard copy requirements.");
    riskFlags.push("Physical delivery or hard copy language detected.");
  }

  if (responseWindowDays !== null && responseWindowDays <= 7) {
    readinessChecklist.push("Escalate review because the response window is short.");
    riskFlags.push("Deadline is within 7 days.");
  }

  if (!sourceUrl) {
    riskFlags.push("Source URL is missing; verify submission instructions manually.");
  }

  const score = clampScore(
    25 +
      (hasPortal ? 20 : 0) +
      (bid.attachments.length > 0 ? 10 : 0) +
      (requiresAddendaAcknowledgement ? 15 : 0) +
      (requiresPhysicalDelivery ? 25 : 0) +
      (responseWindowDays !== null && responseWindowDays <= 7 ? 15 : 0) +
      (!sourceUrl ? 30 : 0),
  );

  return {
    method,
    portalUrl: sourceUrl,
    contactEmail,
    requiresRegistration: hasPortal,
    requiresPhysicalDelivery,
    requiresAddendaAcknowledgement,
    complexityScore: score,
    guidanceText: hasPortal
      ? "Submit through the external procurement portal. WinBids tracks readiness only; final submission happens outside this system."
      : "Use the solicitation instructions as the source of truth. WinBids tracks readiness only; final submission happens outside this system.",
    readinessChecklist,
    riskFlags,
  };
}
