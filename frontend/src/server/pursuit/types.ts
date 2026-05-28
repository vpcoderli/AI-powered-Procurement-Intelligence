export const PURSUIT_RECOMMENDATIONS = ["pursue", "no_bid", "review"] as const;
export const PURSUIT_DECISIONS = ["pursue", "no_bid", "defer"] as const;
export const PURSUIT_RECOMMENDATION_CONFIDENCE = ["low", "medium", "high"] as const;

export type PursuitRecommendationValue = (typeof PURSUIT_RECOMMENDATIONS)[number];
export type PursuitDecisionValue = (typeof PURSUIT_DECISIONS)[number];
export type PursuitRecommendationConfidence = (typeof PURSUIT_RECOMMENDATION_CONFIDENCE)[number];

export interface PursuitRecommendation {
  recommendation: PursuitRecommendationValue;
  confidence: PursuitRecommendationConfidence;
  reasons: string[];
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
