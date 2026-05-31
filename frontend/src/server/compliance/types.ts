export const COMPLIANCE_ITEM_STATUSES = [
  "not_started",
  "in_progress",
  "complete",
  "blocked",
] as const;

export const COMPLIANCE_EVIDENCE_STATUSES = [
  "needed",
  "attached",
  "not_required",
] as const;

export const COMPLIANCE_CATEGORIES = [
  "eligibility",
  "documents",
  "pricing",
  "submission",
  "risk",
] as const;

export type ComplianceItemStatus = (typeof COMPLIANCE_ITEM_STATUSES)[number];
export type ComplianceEvidenceStatus = (typeof COMPLIANCE_EVIDENCE_STATUSES)[number];
export type ComplianceCategory = (typeof COMPLIANCE_CATEGORIES)[number];

export interface GeneratedComplianceItem {
  title: string;
  category: ComplianceCategory;
  evidenceStatus: ComplianceEvidenceStatus;
  evidenceRefs: PursuitEvidenceRef[];
}

export interface ComplianceManifestItem extends GeneratedComplianceItem {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  status: ComplianceItemStatus;
  notes: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceManifestSummary {
  total: number;
  completed: number;
  blocked: number;
  evidenceAttached: number;
}

export interface ComplianceManifest {
  intentId: string;
  bidId: string;
  userId: string;
  summary: ComplianceManifestSummary;
  items: ComplianceManifestItem[];
}

export interface UpdateComplianceManifestItemInput {
  itemId: string;
  status?: ComplianceItemStatus;
  evidenceStatus?: ComplianceEvidenceStatus;
  notes?: string;
}

export interface ComplianceManifestResponse {
  manifest: ComplianceManifest;
}

export function isComplianceItemStatus(value: unknown): value is ComplianceItemStatus {
  return typeof value === "string" && COMPLIANCE_ITEM_STATUSES.includes(value as ComplianceItemStatus);
}

export function isComplianceEvidenceStatus(value: unknown): value is ComplianceEvidenceStatus {
  return (
    typeof value === "string" &&
    COMPLIANCE_EVIDENCE_STATUSES.includes(value as ComplianceEvidenceStatus)
  );
}
import type { PursuitEvidenceRef } from "@/server/pursuit/types";
