import type { AiRunMetadata } from "@/server/ai/run-metadata";
import type { CreditLedgerDryRunResult } from "@/server/billing/credit-ledger";

export type QualificationCitationSection = "brief" | "key_dates" | "submission" | "compliance" | "decision";
export type QualificationCitationSourceType = "bid_field" | "detail_archive" | "attachment" | "generated_output";
export type QualificationFreshnessStatus = "current" | "stale" | "not_refreshed";
export type QualificationAmendmentSignalSource = "title" | "description" | "attachment" | "detail_archive";

export const QUALIFICATION_CITATION_SECTIONS = [
  "brief",
  "key_dates",
  "submission",
  "compliance",
  "decision",
] as const satisfies readonly QualificationCitationSection[];

export const QUALIFICATION_CITATION_SOURCE_TYPES = [
  "bid_field",
  "detail_archive",
  "attachment",
  "generated_output",
] as const satisfies readonly QualificationCitationSourceType[];

export interface QualificationCitation {
  id: string;
  section: QualificationCitationSection;
  sourceType: QualificationCitationSourceType;
  sourceLabel: string;
  excerpt: string;
  url: string;
  confidence: "low" | "medium" | "high";
  generatedAt: string;
}

export interface QualificationCitationsResponse {
  intentId: string;
  bidId: string;
  citations: QualificationCitation[];
}

export interface QualificationAmendmentSignal {
  sourceType: QualificationAmendmentSignalSource;
  label: string;
  excerpt: string;
  detectedAt: string | null;
  url: string;
}

export interface QualificationFreshnessResponse {
  intentId: string;
  bidId: string;
  status: QualificationFreshnessStatus;
  needsRefresh: boolean;
  lastRefreshedAt: string | null;
  latestSignalAt: string | null;
  latestSignal: QualificationAmendmentSignal | null;
  signalCount: number;
  signals: QualificationAmendmentSignal[];
}

export interface QualificationRefreshResponse {
  intent: import("@/server/intents/types").IntentDetail;
  citations: QualificationCitationsResponse;
  freshness: QualificationFreshnessResponse;
}

export interface QualificationQuestionInput {
  question: string;
}

export type QualificationGroundingStatus = "grounded" | "partially_grounded" | "insufficient_evidence";
export type QualificationEvidenceCoverageStatus = "direct" | "partial" | "insufficient";

export interface QualificationEvidenceCoverage {
  status: QualificationEvidenceCoverageStatus;
  matchedCitationCount: number;
  selectedCitationCount: number;
  totalCitationCount: number;
  coveredSections: QualificationCitationSection[];
}

export interface QualificationQuestionResponse {
  intentId: string;
  bidId: string;
  question: string;
  answer: string;
  citations: QualificationCitation[];
  grounded: true;
  groundingStatus: QualificationGroundingStatus;
  evidenceCoverage: QualificationEvidenceCoverage;
  limitations: string[];
  aiRun: AiRunMetadata;
  creditUsage?: CreditLedgerDryRunResult;
  generatedAt: string;
}
