import type { AwardOutcomeStatus } from "@/server/awards/types";
import type { ArtifactEvidenceLink } from "@/server/response-workspace/types";
import type {
  ResponsePackageExportFormat,
  ResponsePackageExportReviewStatus,
} from "@/server/response-workspace/types";

export const SUBMISSION_METHODS = [
  "external_portal",
  "email",
  "physical_delivery",
  "mixed",
  "unknown",
] as const;

export type SubmissionMethod = (typeof SUBMISSION_METHODS)[number];

export const SUBMISSION_STATUSES = [
  "draft",
  "ready",
  "submitted",
  "needs_recovery",
] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export interface GeneratedSubmissionGuidance {
  method: SubmissionMethod;
  portalUrl: string;
  contactEmail: string;
  requiresRegistration: boolean;
  requiresPhysicalDelivery: boolean;
  requiresAddendaAcknowledgement: boolean;
  complexityScore: number;
  guidanceText: string;
  readinessChecklist: string[];
  riskFlags: string[];
}

export interface SubmissionGuidance extends GeneratedSubmissionGuidance {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  status: SubmissionStatus;
  createdAt: string;
  updatedAt: string;
}

export type UpdateSubmissionGuidanceInput = Partial<
  Pick<
    GeneratedSubmissionGuidance,
    | "method"
    | "portalUrl"
    | "contactEmail"
    | "requiresRegistration"
    | "requiresPhysicalDelivery"
    | "requiresAddendaAcknowledgement"
  >
> & {
  status?: SubmissionStatus;
};

export interface CreateSubmissionConfirmationInput {
  submittedAt: string;
  method: SubmissionMethod;
  confirmationReference?: string;
  confirmationNotes?: string;
}

export interface SubmissionConfirmation {
  id: string;
  intentId: string;
  userId: string;
  submittedAt: string;
  method: SubmissionMethod;
  confirmationReference: string;
  confirmationNotes: string;
  evidenceSnapshot: SubmissionEvidenceSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionResponsePackageExportEvidence {
  id: string;
  format: ResponsePackageExportFormat;
  downloadUrl: string;
  snapshotId: string;
  snapshotTitle: string;
  snapshotVersionNumber: number;
  exportedAt: string;
  reviewStatus: ResponsePackageExportReviewStatus;
}

export interface SubmissionLinkedSupplierArtifactEvidence {
  id: string;
  name: string;
  artifactType: string;
  purpose: string;
  evidenceLinks: ArtifactEvidenceLink[];
}

export interface SubmissionAwardOutcomeEvidence {
  status: AwardOutcomeStatus;
  awardNoticeUrl: string;
}

export interface SubmissionEvidenceLinks {
  responsePackageExports: SubmissionResponsePackageExportEvidence[];
  linkedSupplierArtifacts: SubmissionLinkedSupplierArtifactEvidence[];
  awardOutcome: SubmissionAwardOutcomeEvidence | null;
}

export type SubmissionReadinessBlockerCode =
  | "approved_response_package_export_required"
  | "confirmation_reference_required"
  | "required_artifact_missing";

export interface SubmissionReadinessBlocker {
  code: SubmissionReadinessBlockerCode;
  message: string;
}

export interface SubmissionReadinessGate {
  canSubmit: boolean;
  blockers: SubmissionReadinessBlocker[];
  approvedResponsePackageExportCount: number;
  linkedSupplierArtifactCount: number;
  confirmationReferencePresent: boolean;
}

export interface SubmissionEvidenceSnapshot extends SubmissionEvidenceLinks {
  capturedAt: string;
}

export interface SubmissionGuidanceResponse {
  submission: SubmissionGuidance;
  confirmations: SubmissionConfirmation[];
  evidenceLinks: SubmissionEvidenceLinks;
}

export interface SubmissionConfirmationResponse {
  confirmation: SubmissionConfirmation;
  submission: SubmissionGuidance;
  confirmations: SubmissionConfirmation[];
  evidenceLinks: SubmissionEvidenceLinks;
  readinessGate: SubmissionReadinessGate;
}

export function isSubmissionMethod(value: unknown): value is SubmissionMethod {
  return typeof value === "string" && SUBMISSION_METHODS.includes(value as SubmissionMethod);
}

export function isSubmissionStatus(value: unknown): value is SubmissionStatus {
  return typeof value === "string" && SUBMISSION_STATUSES.includes(value as SubmissionStatus);
}
