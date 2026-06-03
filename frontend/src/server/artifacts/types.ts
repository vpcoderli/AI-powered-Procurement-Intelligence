export const ARTIFACT_TYPES = [
  "w9",
  "insurance",
  "business_license",
  "capability_statement",
  "certification",
  "signed_addendum",
  "form",
  "past_performance",
  "quote",
  "response_asset",
  "other",
] as const;

export const ARTIFACT_PURPOSES = [
  "business_profile",
  "compliance_evidence",
  "response_workspace",
  "quote_support",
] as const;

export const ARTIFACT_REVIEW_STATUSES = [
  "pending_review",
  "approved",
  "needs_update",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export type ArtifactPurpose = (typeof ARTIFACT_PURPOSES)[number];
export type ArtifactReviewStatus = (typeof ARTIFACT_REVIEW_STATUSES)[number];
export type ArtifactComputedStatus = "active" | "expired";

export interface SupplierArtifact {
  id: string;
  userId: string;
  intentId: string;
  bidId: string;
  title: string;
  artifactType: ArtifactType;
  purpose: ArtifactPurpose;
  fileName: string;
  contentType: string;
  byteSize: number;
  storagePath: string;
  checksumSha256: string;
  expiresAt: string | null;
  reviewStatus: ArtifactReviewStatus;
  computedStatus: ArtifactComputedStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  downloadUrl: string;
}

export interface ArtifactVault {
  intentId: string;
  bidId: string;
  userId: string;
  summary: {
    total: number;
    active: number;
    expired: number;
    pendingReview: number;
  };
  artifacts: SupplierArtifact[];
}

export interface ArtifactVaultResponse {
  vault: ArtifactVault;
}

export interface CreateSupplierArtifactInput {
  title: string;
  artifactType: ArtifactType;
  purpose: ArtifactPurpose;
  file: File;
  expiresAt?: string | null;
  notes?: string;
}

export function isArtifactType(value: unknown): value is ArtifactType {
  return typeof value === "string" && ARTIFACT_TYPES.includes(value as ArtifactType);
}

export function isArtifactPurpose(value: unknown): value is ArtifactPurpose {
  return typeof value === "string" && ARTIFACT_PURPOSES.includes(value as ArtifactPurpose);
}

export function isArtifactReviewStatus(value: unknown): value is ArtifactReviewStatus {
  return typeof value === "string" && ARTIFACT_REVIEW_STATUSES.includes(value as ArtifactReviewStatus);
}
