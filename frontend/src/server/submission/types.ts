export const SUBMISSION_METHODS = [
  "external_portal",
  "email",
  "physical_delivery",
  "mixed",
  "unknown",
] as const;

export type SubmissionMethod = (typeof SUBMISSION_METHODS)[number];

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
>;

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
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionGuidanceResponse {
  submission: SubmissionGuidance;
}

export interface SubmissionConfirmationResponse {
  confirmation: SubmissionConfirmation;
}

export function isSubmissionMethod(value: unknown): value is SubmissionMethod {
  return typeof value === "string" && SUBMISSION_METHODS.includes(value as SubmissionMethod);
}
