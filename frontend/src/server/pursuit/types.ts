export const PURSUIT_RECOMMENDATIONS = ["pursue", "no_bid", "review"] as const;
export const PURSUIT_DECISIONS = ["pursue", "no_bid", "defer"] as const;
export const PURSUIT_RECOMMENDATION_CONFIDENCE = ["low", "medium", "high"] as const;
export const PURSUIT_REASON_CATEGORIES = [
  "fit",
  "risk",
  "deadline",
  "profile",
  "geography",
  "pricing",
  "documentation",
  "registration",
] as const;
export const PURSUIT_REASON_SEVERITIES = ["positive", "watch", "blocker"] as const;

export type PursuitRecommendationValue = (typeof PURSUIT_RECOMMENDATIONS)[number];
export type PursuitDecisionValue = (typeof PURSUIT_DECISIONS)[number];
export type PursuitRecommendationConfidence = (typeof PURSUIT_RECOMMENDATION_CONFIDENCE)[number];
export type PursuitReasonCategory = (typeof PURSUIT_REASON_CATEGORIES)[number];
export type PursuitReasonSeverity = (typeof PURSUIT_REASON_SEVERITIES)[number];

export interface PursuitReasonDetail {
  category: PursuitReasonCategory;
  severity: PursuitReasonSeverity;
  summary: string;
  explanation: string;
  evidenceLabel: string;
  suggestedAction: string;
}

export interface PursuitRecommendation {
  recommendation: PursuitRecommendationValue;
  confidence: PursuitRecommendationConfidence;
  reasons: string[];
  reasonDetails: PursuitReasonDetail[];
}

export interface PursuitDecisionRecord {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  decision: PursuitDecisionValue;
  reasons: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface PursuitDecisionBoard {
  intentId: string;
  bidId: string;
  userId: string;
  recommendation: PursuitRecommendation;
  currentDecision: PursuitDecisionRecord | null;
  history: PursuitDecisionRecord[];
}

export interface CreatePursuitDecisionInput {
  decision: PursuitDecisionValue;
  reasons?: string[];
  notes?: string;
}

export interface PursuitDecisionBoardResponse {
  decisionBoard: PursuitDecisionBoard;
}

export function isPursuitDecision(value: unknown): value is PursuitDecisionValue {
  return typeof value === "string" && PURSUIT_DECISIONS.includes(value as PursuitDecisionValue);
}
