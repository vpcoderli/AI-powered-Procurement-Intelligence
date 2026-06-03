import type {
  IntentApiErrorResponse,
  IntentListResponse,
  IntentResponse,
  IntentStatus,
} from "@/server/intents/types";
import type {
  CreateSubmissionConfirmationInput,
  SubmissionConfirmationResponse,
  SubmissionGuidanceResponse,
  UpdateSubmissionGuidanceInput,
} from "@/server/submission/types";
import type {
  ComplianceManifestResponse,
  UpdateComplianceManifestItemInput,
} from "@/server/compliance/types";
import type {
  CreateResponseWorkspaceCommentInput,
  CreateResponsePackageSnapshotInput,
  CreateResponsePackageExportInput,
  ResponsePackageExportResponse,
  ResponsePackageSnapshotResponse,
  ResponsePackageWorkspaceResponse,
  ResponseWorkspaceCommentResponse,
  ResponseWorkspaceCommentsResponse,
  ResponseWorkspaceResponse,
  UpdateResponseWorkspaceItemInput,
} from "@/server/response-workspace/types";
import type {
  ArtifactPurpose,
  ArtifactType,
  ArtifactVaultResponse,
} from "@/server/artifacts/types";
import type {
  CreateQuoteRequestInput,
  QuoteWorkspaceResponse,
  UpdateQuoteRequestInput,
} from "@/server/quotes/types";
import type {
  DeadlineWorkspaceResponse,
} from "@/server/deadlines/types";
import type {
  CreatePursuitDecisionInput,
  PursuitDecisionBoardResponse,
} from "@/server/pursuit/types";
import type {
  QualificationCitationsResponse,
  QualificationFreshnessResponse,
  QualificationQuestionInput,
  QualificationQuestionResponse,
  QualificationRefreshResponse,
} from "@/server/qualification/types";
import { ApiError } from "./bids";

function isApiErrorResponse(body: unknown): body is IntentApiErrorResponse {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return false;
  }

  const error = (body as { error: unknown }).error;

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code, message } = error as { code?: unknown; message?: unknown };

  return (
    (code === "BID_NOT_FOUND" ||
      code === "FEATURE_NOT_AVAILABLE" ||
      code === "INTENT_NOT_FOUND" ||
      code === "INVALID_REQUEST" ||
      code === "INTERNAL_ERROR" ||
      code === "USAGE_LIMIT_REACHED") &&
    typeof message === "string"
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new ApiError(response.status, "INTERNAL_ERROR", "Request failed");
  }

  if (!response.ok) {
    if (isApiErrorResponse(body)) {
      throw new ApiError(response.status, body.error.code as "INTERNAL_ERROR", body.error.message);
    }

    throw new ApiError(response.status, "INTERNAL_ERROR", "Request failed");
  }

  return body as T;
}

export async function createIntent(bidId: string) {
  const response = await fetch(`/api/bids/${encodeURIComponent(bidId)}/intent`, {
    method: "POST",
  });

  return parseResponse<IntentResponse>(response);
}

export async function fetchIntents() {
  const response = await fetch("/api/intents");

  return parseResponse<IntentListResponse>(response);
}

export async function fetchIntent(id: string) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}`);

  return parseResponse<IntentResponse>(response);
}

export async function updateIntentStatus(id: string, status: IntentStatus) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });

  return parseResponse<IntentResponse>(response);
}

export async function fetchSubmissionGuidance(id: string) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/submission`);

  return parseResponse<SubmissionGuidanceResponse>(response);
}

export async function updateSubmissionGuidance(
  id: string,
  input: UpdateSubmissionGuidanceInput,
) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/submission`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<SubmissionGuidanceResponse>(response);
}

export async function confirmSubmission(
  id: string,
  input: CreateSubmissionConfirmationInput,
) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/submission/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<SubmissionConfirmationResponse>(response);
}

export async function fetchComplianceManifest(id: string) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/compliance`);

  return parseResponse<ComplianceManifestResponse>(response);
}

export async function updateComplianceManifestItem(
  id: string,
  input: UpdateComplianceManifestItemInput,
) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/compliance`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<ComplianceManifestResponse>(response);
}

export async function fetchResponseWorkspace(id: string) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/response-workspace`);

  return parseResponse<ResponseWorkspaceResponse>(response);
}

export async function updateResponseWorkspaceItem(
  id: string,
  input: UpdateResponseWorkspaceItemInput,
) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/response-workspace`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<ResponseWorkspaceResponse>(response);
}

export async function updateResponseWorkspaceItemArtifactLinks(
  id: string,
  itemId: string,
  linkedArtifactIds: string[],
) {
  return updateResponseWorkspaceItem(id, { itemId, linkedArtifactIds });
}

export async function fetchResponseWorkspaceComments(id: string, itemId: string) {
  const response = await fetch(
    `/api/intents/${encodeURIComponent(id)}/response-workspace/comments?itemId=${encodeURIComponent(itemId)}`,
  );

  return parseResponse<ResponseWorkspaceCommentsResponse>(response);
}

export async function createResponseWorkspaceComment(
  id: string,
  input: CreateResponseWorkspaceCommentInput,
) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/response-workspace/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<ResponseWorkspaceCommentResponse>(response);
}

export async function fetchResponsePackageWorkspace(id: string) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/response-workspace/package`);

  return parseResponse<ResponsePackageWorkspaceResponse>(response);
}

export async function createResponsePackageSnapshot(
  id: string,
  input: CreateResponsePackageSnapshotInput,
) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/response-workspace/package`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<ResponsePackageSnapshotResponse>(response);
}

export async function createResponsePackageExport(
  id: string,
  input: CreateResponsePackageExportInput,
) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/response-workspace/package/exports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<ResponsePackageExportResponse>(response);
}

export async function fetchArtifactVault(id: string) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/artifacts`);

  return parseResponse<ArtifactVaultResponse>(response);
}

export async function uploadSupplierArtifact(
  id: string,
  input: {
    title: string;
    artifactType: ArtifactType;
    purpose: ArtifactPurpose;
    file: File;
    expiresAt?: string | null;
    notes?: string;
  },
) {
  const form = new FormData();
  form.set("title", input.title);
  form.set("artifactType", input.artifactType);
  form.set("purpose", input.purpose);
  form.set("file", input.file);
  if (input.expiresAt) form.set("expiresAt", input.expiresAt);
  if (input.notes) form.set("notes", input.notes);

  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/artifacts`, {
    method: "POST",
    body: form,
  });

  return parseResponse<ArtifactVaultResponse>(response);
}

export async function fetchQuoteWorkspace(id: string) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/quotes`);

  return parseResponse<QuoteWorkspaceResponse>(response);
}

export async function createQuoteRequestDraft(
  id: string,
  input: CreateQuoteRequestInput,
) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/quotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<QuoteWorkspaceResponse>(response);
}

export async function updateQuoteRequestDraft(
  id: string,
  input: UpdateQuoteRequestInput,
) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/quotes`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<QuoteWorkspaceResponse>(response);
}

export async function fetchDeadlineWorkspace(id: string) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/deadlines`);

  return parseResponse<DeadlineWorkspaceResponse>(response);
}

export async function updateDeadlineReminder(
  id: string,
  input: {
    reminderId: string;
    action: "acknowledge" | "snooze";
    snoozedUntil?: string;
  },
) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/deadlines`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<DeadlineWorkspaceResponse>(response);
}

export async function fetchPursuitDecisionBoard(id: string) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/decision`);

  return parseResponse<PursuitDecisionBoardResponse>(response);
}

export async function fetchQualificationCitations(id: string) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/citations`);

  return parseResponse<QualificationCitationsResponse>(response);
}

export async function fetchQualificationFreshness(id: string) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/qualification/freshness`);

  return parseResponse<QualificationFreshnessResponse>(response);
}

export async function refreshQualificationEvidence(id: string) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/qualification/freshness`, {
    method: "POST",
  });

  return parseResponse<QualificationRefreshResponse>(response);
}

export async function postQualificationQuestion(
  id: string,
  input: QualificationQuestionInput,
) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/qa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<QualificationQuestionResponse>(response);
}

export async function updatePursuitDecision(
  id: string,
  input: CreatePursuitDecisionInput,
) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/decision`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<PursuitDecisionBoardResponse>(response);
}
