export type QualificationCitationSection = "brief" | "key_dates" | "submission" | "compliance" | "decision";
export type QualificationCitationSourceType = "bid_field" | "detail_archive" | "attachment" | "generated_output";

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
