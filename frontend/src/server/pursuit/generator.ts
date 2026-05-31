import type { IntentDetail } from "@/server/intents/types";
import { bidDetailPath } from "@/lib/bid-routes";
import type {
  PursuitEvidenceRef,
  PursuitReasonCategory,
  PursuitReasonDetail,
  PursuitReasonSeverity,
  PursuitRecommendation,
} from "./types";

function detail(input: {
  category: PursuitReasonCategory;
  severity: PursuitReasonSeverity;
  summary: string;
  explanation: string;
  evidenceLabel: string;
  suggestedAction: string;
  evidenceRefs?: PursuitEvidenceRef[];
}): PursuitReasonDetail {
  return {
    ...input,
    evidenceRefs: input.evidenceRefs ?? [],
  };
}

function matchSnapshotRef(): PursuitEvidenceRef {
  return { kind: "match_snapshot", label: "Match snapshot" };
}

function generatedOutputRef(label: string, citationId = "citation_generated_brief"): PursuitEvidenceRef {
  return { kind: "generated_output", label, citationId };
}

function supplierProfileRef(): PursuitEvidenceRef {
  return { kind: "supplier_profile", label: "Supplier profile", url: "/profile" };
}

function bidDetailRef(intent: IntentDetail): PursuitEvidenceRef {
  return { kind: "bid_detail", label: "Bid detail", url: bidDetailPath(intent.bid.id) };
}

function sourceUrlRef(intent: IntentDetail): PursuitEvidenceRef {
  return { kind: "source_url", label: "Original source", citationId: "citation_source_url", url: intent.bid.sourceUrl };
}

function citationRef(label: string, citationId: string): PursuitEvidenceRef {
  return { kind: "citation", label, citationId };
}

function attachmentRefs(intent: IntentDetail): PursuitEvidenceRef[] {
  return intent.bid.attachments.slice(0, 3).map((attachment, index) => ({
    kind: "attachment",
    label: attachment.name,
    citationId: `citation_attachment_${index + 1}`,
    url: attachment.url,
  }));
}

function hasAddendaRisk(intent: IntentDetail) {
  const text = [
    intent.bid.title,
    intent.bid.description,
    intent.bid.fullDescription,
    ...intent.generated.riskFlags,
    ...intent.bid.attachments.map((attachment) => attachment.name),
  ].join(" ").toLowerCase();

  return /\baddend(?:um|a)\b|\bamend(?:ment|ed)?\b/.test(text);
}

function hasRegistrationRisk(intent: IntentDetail) {
  const text = [intent.bid.description, intent.bid.fullDescription, ...intent.generated.initialChecklist].join(" ").toLowerCase();

  return /\bregister|registration|portal account|account access\b/.test(text);
}

function buildReasonDetails(intent: IntentDetail): PursuitReasonDetail[] {
  const details: PursuitReasonDetail[] = [];
  const riskCount = intent.generated.riskFlags.length + intent.match.riskNotes.length;

  if (intent.match.score >= 70) {
    details.push(detail({
      category: "fit",
      severity: "positive",
      summary: "Strong supplier fit based on the current match score.",
      explanation: `The current match score is ${intent.match.score}, with supporting match signals from the supplier profile and opportunity metadata.`,
      evidenceLabel: "Match snapshot",
      suggestedAction: "Keep this opportunity in active pursuit unless downstream compliance or pricing review changes the decision.",
      evidenceRefs: [matchSnapshotRef(), supplierProfileRef()],
    }));
  } else if (intent.match.score <= 40) {
    details.push(detail({
      category: "fit",
      severity: "blocker",
      summary: "Low supplier fit based on the current match score.",
      explanation: `The current match score is ${intent.match.score}, which indicates weak alignment with the supplier profile.`,
      evidenceLabel: "Match snapshot",
      suggestedAction: "Treat as a no-bid candidate unless the supplier profile is incomplete or the team has strategic reasons to pursue.",
      evidenceRefs: [matchSnapshotRef(), supplierProfileRef()],
    }));
  } else {
    details.push(detail({
      category: "fit",
      severity: "watch",
      summary: "Moderate fit; review pricing, capacity, and requirements before committing.",
      explanation: `The current match score is ${intent.match.score}, so the opportunity needs human review before proposal investment.`,
      evidenceLabel: "Match snapshot",
      suggestedAction: "Compare the requirements against capacity, pricing, and required registrations before deciding.",
      evidenceRefs: [matchSnapshotRef(), supplierProfileRef()],
    }));
  }

  if (intent.match.components.geography === 0 && intent.match.riskNotes.some((note) => /location|service states/i.test(note))) {
    details.push(detail({
      category: "geography",
      severity: "blocker",
      summary: "Service geography may not match this opportunity.",
      explanation: "The match engine flagged the bid location as outside the supplier's listed service states.",
      evidenceLabel: "Match risk notes",
      suggestedAction: "Confirm delivery coverage or partner coverage before pursuing.",
      evidenceRefs: [matchSnapshotRef(), supplierProfileRef()],
    }));
  }

  if (intent.match.components.contractValue === 0 && intent.match.riskNotes.some((note) => /contract value|preferred range/i.test(note))) {
    details.push(detail({
      category: "pricing",
      severity: "watch",
      summary: "Contract value may be outside the preferred range.",
      explanation: "The estimated value does not fit the supplier's configured contract value preferences.",
      evidenceLabel: "Match risk notes",
      suggestedAction: "Validate margin and capacity assumptions before committing bid resources.",
      evidenceRefs: [matchSnapshotRef(), supplierProfileRef()],
    }));
  }

  if (riskCount > 0) {
    details.push(detail({
      category: "risk",
      severity: riskCount >= 3 ? "blocker" : "watch",
      summary: "Open risk flags should be resolved before final proposal investment.",
      explanation: `${riskCount} generated or match risk signal${riskCount === 1 ? "" : "s"} are currently attached to this intent.`,
      evidenceLabel: "Generated risk flags",
      suggestedAction: "Resolve the highest-impact risk signals or document why they are acceptable.",
      evidenceRefs: [generatedOutputRef("Generated risk flags"), matchSnapshotRef()],
    }));
  }

  if (!intent.bid.deadlineDate) {
    details.push(detail({
      category: "deadline",
      severity: "blocker",
      summary: "No reliable submission deadline is available.",
      explanation: "The opportunity does not expose a trackable deadline in the current bid record.",
      evidenceLabel: "Bid key dates",
      suggestedAction: "Verify the deadline at the source before any bid/no-bid commitment.",
      evidenceRefs: [citationRef("Deadline", "citation_deadline"), bidDetailRef(intent), sourceUrlRef(intent)],
    }));
  } else {
    details.push(detail({
      category: "deadline",
      severity: "positive",
      summary: "The opportunity has a trackable deadline for pursuit planning.",
      explanation: `The current deadline is ${intent.bid.deadlineDate}.`,
      evidenceLabel: "Bid key dates",
      suggestedAction: "Use this date to schedule internal review, pricing, and submission checkpoints.",
      evidenceRefs: [citationRef("Deadline", "citation_deadline"), bidDetailRef(intent), sourceUrlRef(intent)],
    }));
  }

  if (intent.match.missingProfileHints.length > 0) {
    details.push(detail({
      category: "profile",
      severity: intent.match.missingProfileHints.length > 2 ? "blocker" : "watch",
      summary: "Supplier profile gaps reduce recommendation confidence.",
      explanation: `${intent.match.missingProfileHints.length} supplier profile input${intent.match.missingProfileHints.length === 1 ? "" : "s"} are missing or incomplete.`,
      evidenceLabel: "Supplier profile",
      suggestedAction: "Update the supplier profile, then refresh qualification evidence before relying on the recommendation.",
      evidenceRefs: [supplierProfileRef(), matchSnapshotRef()],
    }));
  }

  if (intent.bid.attachments.length === 0 || intent.match.riskNotes.some((note) => /attachments/i.test(note))) {
    details.push(detail({
      category: "documentation",
      severity: "watch",
      summary: "Opportunity documentation may be incomplete.",
      explanation: "The current bid record has no listed attachments or includes a documentation risk signal.",
      evidenceLabel: "Bid attachments",
      suggestedAction: "Open the source record and confirm all forms, addenda, and attachments are available.",
      evidenceRefs: [...attachmentRefs(intent), bidDetailRef(intent), sourceUrlRef(intent)],
    }));
  }

  if (hasAddendaRisk(intent)) {
    details.push(detail({
      category: "documentation",
      severity: "watch",
      summary: "Addenda or amendment acknowledgement may be required.",
      explanation: "The opportunity text or generated risks mention addenda/amendment handling.",
      evidenceLabel: "Bid evidence",
      suggestedAction: "Confirm the latest amendment/addenda set and acknowledgement requirements before submitting.",
      evidenceRefs: [...attachmentRefs(intent), bidDetailRef(intent), sourceUrlRef(intent)],
    }));
  }

  if (hasRegistrationRisk(intent)) {
    details.push(detail({
      category: "registration",
      severity: "watch",
      summary: "Portal registration or account access may be required.",
      explanation: "The opportunity text or checklist includes registration or portal account language.",
      evidenceLabel: "Submission evidence",
      suggestedAction: "Confirm account access early enough to avoid submission blockers.",
      evidenceRefs: [sourceUrlRef(intent), generatedOutputRef("Generated checklist")],
    }));
  }

  return details;
}

export function generatePursuitRecommendation(intent: IntentDetail): PursuitRecommendation {
  const riskCount = intent.generated.riskFlags.length + intent.match.riskNotes.length;
  const missingProfileCount = intent.match.missingProfileHints.length;
  const reasonDetails = buildReasonDetails(intent);
  const reasons = reasonDetails.map((reason) => reason.summary);

  if (intent.match.score >= 70 && riskCount <= 1) {
    return {
      recommendation: "pursue",
      confidence: missingProfileCount > 0 ? "medium" : "high",
      reasons,
      reasonDetails,
    };
  }

  if (intent.match.score <= 35 || riskCount >= 3) {
    return {
      recommendation: "no_bid",
      confidence: missingProfileCount > 2 ? "medium" : "high",
      reasons,
      reasonDetails,
    };
  }

  return {
    recommendation: "review",
    confidence: missingProfileCount > 2 ? "low" : "medium",
    reasons,
    reasonDetails,
  };
}
