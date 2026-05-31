import type { IntentDetail } from "@/server/intents/types";
import type { WorkflowCoachCard, WorkflowCoachSeverity } from "@/server/knowledge/types";

function validDate(value: string | null | undefined) {
  const timestamp = value ? Date.parse(`${value}T00:00:00.000Z`) : Number.NaN;

  return Number.isFinite(timestamp) ? timestamp : null;
}

function daysBetween(start: string | null | undefined, end: string | null | undefined) {
  const startDate = validDate(start);
  const endDate = validDate(end);

  if (startDate === null || endDate === null) return null;

  return Math.ceil((endDate - startDate) / (24 * 60 * 60 * 1000));
}

function compactList(values: string[], limit: number) {
  return values.map((value) => value.trim()).filter(Boolean).slice(0, limit);
}

function deadlineSeverity(responseWindowDays: number | null): WorkflowCoachSeverity {
  if (responseWindowDays !== null && responseWindowDays <= 7) return "critical";
  if (responseWindowDays !== null && responseWindowDays <= 14) return "warning";

  return "info";
}

function readinessSeverity(checklistCount: number, riskCount: number): WorkflowCoachSeverity {
  if (riskCount >= 3) return "critical";
  if (riskCount > 0 || checklistCount >= 5) return "warning";

  return "info";
}

function decisionLabel(score: number) {
  if (score >= 75) return "pursue";
  if (score < 45) return "no-bid review";

  return "leadership review";
}

export function generateWorkflowCoachCards(intent: IntentDetail): WorkflowCoachCard[] {
  const keyDates = intent.generated.keyDates;
  const deadlineDate = keyDates.deadlineDate || intent.bid.deadlineDate;
  const publishedDate = keyDates.publishedDate || intent.bid.publishedDate;
  const responseWindowDays = daysBetween(publishedDate, deadlineDate);
  const checklist = compactList(intent.generated.initialChecklist, 3);
  const riskFlags = compactList([...intent.generated.riskFlags, ...intent.match.riskNotes], 4);
  const attachments = intent.bid.attachments;
  const sourceUrl = intent.bid.sourceUrl.trim();
  const recommendation = decisionLabel(intent.match.score);

  const cards: WorkflowCoachCard[] = [
    {
      id: `${intent.id}:deadline`,
      category: "deadline",
      severity: deadlineSeverity(responseWindowDays),
      title: deadlineDate ? `Deadline: ${deadlineDate}` : "Deadline needs confirmation",
      guidance:
        responseWindowDays === null
          ? "Confirm the solicitation timeline before assigning owners."
          : `The response window is ${responseWindowDays} day${responseWindowDays === 1 ? "" : "s"} from publication to deadline.`,
      suggestedAction: "Build the proposal calendar and work backward from the submission cutoff.",
      sourceLabel: intent.bid.issuerName,
      href: sourceUrl || undefined,
    },
    {
      id: `${intent.id}:readiness`,
      category: "readiness",
      severity: readinessSeverity(checklist.length, riskFlags.length),
      title: "Readiness checkpoints",
      guidance:
        checklist.length > 0
          ? checklist.join(" ")
          : "Start with eligibility, ownership, pricing, and submission readiness checks.",
      suggestedAction: "Assign each readiness item to an owner and record blockers as knowledge notes.",
    },
    {
      id: `${intent.id}:compliance`,
      category: "compliance",
      severity: riskFlags.length > 0 ? readinessSeverity(checklist.length, riskFlags.length) : "info",
      title: riskFlags.length > 0 ? "Risk flags to resolve" : "Compliance review",
      guidance:
        riskFlags.length > 0
          ? riskFlags.join(" ")
          : "No generated risk flags are present, but required forms and eligibility still need a manual pass.",
      suggestedAction: "Turn unresolved risks into requirements before pricing is finalized.",
    },
    {
      id: `${intent.id}:documents`,
      category: "documents",
      severity: attachments.length === 0 ? "warning" : "info",
      title: attachments.length > 0 ? `${attachments.length} document source${attachments.length === 1 ? "" : "s"}` : "Document gap",
      guidance:
        attachments.length > 0
          ? `Use the solicitation source and ${attachments.length} attachment${attachments.length === 1 ? "" : "s"} as evidence.`
          : "No attachments are available for this opportunity in the current bid record.",
      suggestedAction: "Archive source documents and cite the exact attachment for each requirement.",
      sourceLabel: intent.bid.source,
      href: sourceUrl || undefined,
    },
    {
      id: `${intent.id}:decision`,
      category: "decision",
      severity: intent.match.score < 45 ? "warning" : "info",
      title: `Recommended path: ${recommendation}`,
      guidance: `Match score is ${intent.match.score} with ${intent.match.confidence} confidence. ${intent.match.explanation}`,
      suggestedAction: "Capture the pursue or no-bid rationale while the qualification evidence is fresh.",
    },
  ];

  return cards;
}
