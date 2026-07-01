import type { AppDatabase } from "@/server/db/client";
import { listUserIntents } from "@/server/intents/service";
import type { IntentSummary } from "@/server/intents/types";
import type {
  ProcurementIntelligenceSignal,
  ProcurementIntelligenceSignalSeverity,
  ProcurementIntelligenceSignalType,
  ProcurementIntelligenceSummary,
} from "./types";

const MODEL_VERSION = "product-6-intelligence-lite@2026-06-30";
const LIMITATIONS = [
  "Local deterministic read model only; no live LLM, embeddings, vector database, or external enrichment.",
  "Billing is represented as dry-run-only metadata and no credits are charged.",
];

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function daysUntil(deadlineDate: string, now: Date) {
  if (!deadlineDate) return Number.POSITIVE_INFINITY;
  const deadline = new Date(`${deadlineDate}T23:59:59.999Z`);
  return Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000);
}

function needsAction(intent: IntentSummary) {
  return intent.status === "needs_review" ||
    intent.status === "questions_needed" ||
    intent.status === "sourcing_needed" ||
    intent.status === "pursuit_decision_needed";
}

function signalPriority(signal: ProcurementIntelligenceSignal) {
  const typeScore: Record<ProcurementIntelligenceSignalType, number> = {
    action_required: 400,
    deadline_risk: 300,
    strong_match: 200,
    watch_item: 100,
  };
  const severityScore: Record<ProcurementIntelligenceSignalSeverity, number> = {
    high: 30,
    medium: 20,
    low: 10,
  };

  return typeScore[signal.signalType] + severityScore[signal.severity] + signal.matchScore;
}

function createSignal(intent: IntentSummary, now: Date): ProcurementIntelligenceSignal {
  const days = daysUntil(intent.bid.deadlineDate, now);
  let signalType: ProcurementIntelligenceSignalType = "watch_item";
  let severity: ProcurementIntelligenceSignalSeverity = "low";
  let reason = `${intent.status} is tracked locally with ${intent.match.score}% match confidence.`;

  if (needsAction(intent)) {
    signalType = "action_required";
    severity = intent.status === "questions_needed" || intent.status === "sourcing_needed" ? "high" : "medium";
    reason = `${intent.status} needs owner action before ${intent.bid.deadlineDate || "the posted deadline"}.`;
  } else if (days <= 7) {
    signalType = "deadline_risk";
    severity = days < 0 ? "high" : "medium";
    reason = days < 0
      ? `Deadline passed on ${intent.bid.deadlineDate}; review whether the pursuit should be closed.`
      : `${days} days remain before the posted deadline.`;
  } else if (intent.match.score >= 75) {
    signalType = "strong_match";
    severity = "medium";
    reason = `Strong local match score of ${intent.match.score}% based on profile and bid fields.`;
  }

  return {
    intentId: intent.id,
    bidId: intent.bid.id,
    title: intent.bid.title,
    signalType,
    severity,
    reason,
    matchScore: intent.match.score,
    deadlineDate: intent.bid.deadlineDate,
  };
}

function createSummaryBullets(input: {
  activePursuits: number;
  needsActionCount: number;
  decisionQueueCount: number;
  averageMatchScore: number;
}) {
  return [
    `${input.activePursuits} active local pursuits reviewed.`,
    `${input.needsActionCount} pursuits need review, sourcing, questions, or a pursue/no-bid decision.`,
    `${input.decisionQueueCount} pursuits are waiting on a pursuit decision.`,
    `Average deterministic match score is ${input.averageMatchScore}%.`,
  ];
}

export async function createProcurementIntelligenceSummary(
  database: AppDatabase,
  userId: string,
  now = new Date(),
): Promise<ProcurementIntelligenceSummary> {
  const intents = await listUserIntents(database, userId);
  const activePursuits = intents.length;
  const needsActionCount = intents.filter(needsAction).length;
  const decisionQueueCount = intents.filter((intent) => intent.status === "pursuit_decision_needed").length;
  const atRiskCount = intents.filter((intent) => daysUntil(intent.bid.deadlineDate, now) <= 7).length;
  const averageMatchScore = average(intents.map((intent) => intent.match.score));
  const topSignals = intents
    .map((intent) => createSignal(intent, now))
    .sort((left, right) => signalPriority(right) - signalPriority(left) || left.title.localeCompare(right.title))
    .slice(0, 5);

  return {
    generatedAt: now.toISOString(),
    mode: "deterministic_local",
    modelVersion: MODEL_VERSION,
    sourcePolicy: {
      llm: "not_used",
      embeddings: "not_used",
      vectorDb: "not_used",
      billing: "dry_run_only",
    },
    scope: {
      userId,
      intentCount: intents.length,
    },
    cockpit: {
      activePursuits,
      needsAction: needsActionCount,
      decisionQueue: decisionQueueCount,
      staleOrAtRisk: atRiskCount,
      averageMatchScore,
    },
    topSignals,
    summaryBullets: createSummaryBullets({
      activePursuits,
      needsActionCount,
      decisionQueueCount,
      averageMatchScore,
    }),
    limitations: LIMITATIONS,
  };
}
