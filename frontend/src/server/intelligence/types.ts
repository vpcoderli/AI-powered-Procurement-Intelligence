export type ProcurementIntelligenceMode = "deterministic_local";
export type ProcurementIntelligenceSourceUse = "not_used" | "dry_run_only";
export type ProcurementIntelligenceSignalType =
  | "action_required"
  | "deadline_risk"
  | "strong_match"
  | "watch_item";
export type ProcurementIntelligenceSignalSeverity = "low" | "medium" | "high";

export interface ProcurementIntelligenceSourcePolicy {
  llm: ProcurementIntelligenceSourceUse;
  embeddings: ProcurementIntelligenceSourceUse;
  vectorDb: ProcurementIntelligenceSourceUse;
  billing: ProcurementIntelligenceSourceUse;
}

export interface ProcurementIntelligenceScope {
  userId: string;
  intentCount: number;
}

export interface ProcurementIntelligenceCockpit {
  activePursuits: number;
  needsAction: number;
  decisionQueue: number;
  staleOrAtRisk: number;
  averageMatchScore: number;
}

export interface ProcurementIntelligenceSignal {
  intentId: string;
  bidId: string;
  title: string;
  signalType: ProcurementIntelligenceSignalType;
  severity: ProcurementIntelligenceSignalSeverity;
  reason: string;
  matchScore: number;
  deadlineDate: string;
}

export interface ProcurementIntelligenceSummary {
  generatedAt: string;
  mode: ProcurementIntelligenceMode;
  modelVersion: string;
  sourcePolicy: ProcurementIntelligenceSourcePolicy;
  scope: ProcurementIntelligenceScope;
  cockpit: ProcurementIntelligenceCockpit;
  topSignals: ProcurementIntelligenceSignal[];
  summaryBullets: string[];
  limitations: string[];
}

export interface ProcurementIntelligenceResponse {
  intelligence: ProcurementIntelligenceSummary;
}
