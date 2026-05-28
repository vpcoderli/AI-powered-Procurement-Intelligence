import type { IntentDetail } from "@/server/intents/types";
import type { PursuitRecommendation } from "./types";

export function generatePursuitRecommendation(intent: IntentDetail): PursuitRecommendation {
  const reasons: string[] = [];
  const riskCount = intent.generated.riskFlags.length + intent.match.riskNotes.length;
  const missingProfileCount = intent.match.missingProfileHints.length;

  if (intent.match.score >= 70) {
    reasons.push("Strong supplier fit based on the current match score.");
  } else if (intent.match.score <= 40) {
    reasons.push("Low supplier fit based on the current match score.");
  } else {
    reasons.push("Moderate fit; review pricing, capacity, and requirements before committing.");
  }

  if (riskCount > 0) {
    reasons.push("Open risk flags should be resolved before final proposal investment.");
  }

  if (missingProfileCount > 0) {
    reasons.push("Supplier profile gaps reduce recommendation confidence.");
  }

  if (intent.bid.deadlineDate) {
    reasons.push("The opportunity has a trackable deadline for pursuit planning.");
  }

  if (intent.match.score >= 70 && riskCount <= 1) {
    return {
      recommendation: "pursue",
      confidence: missingProfileCount > 0 ? "medium" : "high",
      reasons,
    };
  }

  if (intent.match.score <= 35 || riskCount >= 3) {
    return {
      recommendation: "no_bid",
      confidence: missingProfileCount > 2 ? "medium" : "high",
      reasons,
    };
  }

  return {
    recommendation: "review",
    confidence: missingProfileCount > 2 ? "low" : "medium",
    reasons,
  };
}
