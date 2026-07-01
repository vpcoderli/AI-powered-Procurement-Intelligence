export const AWARD_OUTCOME_STATUSES = [
  "awaiting_award",
  "awarded_to_us",
  "awarded_to_competitor",
  "cancelled",
  "no_award",
  "unknown",
] as const;

export type AwardOutcomeStatus = (typeof AWARD_OUTCOME_STATUSES)[number];

export const LOSS_REASON_CODES = [
  "price_uncompetitive",
  "technical_score",
  "compliance_gap",
  "past_performance",
  "incumbent_or_relationship",
  "schedule_or_capacity",
  "small_business_or_set_aside",
  "scope_fit",
  "buyer_cancelled_or_no_award",
  "unknown",
] as const;

export type LossReasonCode = (typeof LOSS_REASON_CODES)[number];

export const AWARD_NEXT_ACTIONS = [
  "capture_tabulation",
  "request_debrief",
  "update_pricing",
  "fix_compliance_gap",
  "refresh_past_performance",
  "requalify_future_bid",
  "archive",
  "none",
] as const;

export type AwardNextAction = (typeof AWARD_NEXT_ACTIONS)[number];

export type AwardOutcomeClass = "win" | "loss" | "no_decision";

export interface AwardLearningEvidence {
  awardNoticeUrl: string;
  tabulationArtifactId: string | null;
  tabulationArtifactUrl: string;
  decidedAt: string | null;
}

export interface AwardLearningSummary {
  outcomeClass: AwardOutcomeClass;
  headline: string;
  primaryDriver: LossReasonCode | "win" | "unknown";
  lessons: string[];
  recommendedActions: AwardNextAction[];
  evidence: AwardLearningEvidence;
  amountCents: number | null;
  currency: string;
}

export interface AwardOutcome {
  id: string;
  organizationId: string;
  intentId: string;
  bidId: string;
  userId: string;
  status: AwardOutcomeStatus;
  awardNoticeUrl: string;
  tabulationArtifactId: string | null;
  tabulationArtifactUrl: string;
  winnerName: string;
  awardAmountCents: number | null;
  currency: string;
  lossReason: LossReasonCode;
  lossReasonNotes: string;
  nextAction: AwardNextAction;
  nextActionDueAt: string | null;
  notes: string;
  decidedAt: string | null;
  learningSummary: AwardLearningSummary;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateAwardOutcomeInput {
  status?: AwardOutcomeStatus;
  awardNoticeUrl?: string;
  tabulationArtifactId?: string | null;
  tabulationArtifactUrl?: string;
  winnerName?: string;
  awardAmountCents?: number | null;
  currency?: string;
  lossReason?: LossReasonCode;
  lossReasonNotes?: string;
  nextAction?: AwardNextAction;
  nextActionDueAt?: string | null;
  notes?: string;
  decidedAt?: string | null;
}

export interface AwardOutcomeResponse {
  outcome: AwardOutcome;
}

export function isAwardOutcomeStatus(value: unknown): value is AwardOutcomeStatus {
  return typeof value === "string" && AWARD_OUTCOME_STATUSES.includes(value as AwardOutcomeStatus);
}

export function isLossReasonCode(value: unknown): value is LossReasonCode {
  return typeof value === "string" && LOSS_REASON_CODES.includes(value as LossReasonCode);
}

export function isAwardNextAction(value: unknown): value is AwardNextAction {
  return typeof value === "string" && AWARD_NEXT_ACTIONS.includes(value as AwardNextAction);
}
