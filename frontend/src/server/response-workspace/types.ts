export const RESPONSE_WORKSPACE_ITEM_KINDS = [
  "task",
  "checkpoint",
  "artifact",
  "outline_section",
] as const;

export const RESPONSE_WORKSPACE_ITEM_STATUSES = [
  "todo",
  "in_progress",
  "done",
  "blocked",
] as const;

export const RESPONSE_PACKAGE_EXPORT_FORMATS = ["markdown", "zip", "pdf", "docx"] as const;
export const RESPONSE_PACKAGE_EXPORT_REVIEW_STATUSES = ["pending_review", "approved", "needs_changes"] as const;

export type ResponseWorkspaceItemKind = (typeof RESPONSE_WORKSPACE_ITEM_KINDS)[number];
export type ResponseWorkspaceItemStatus = (typeof RESPONSE_WORKSPACE_ITEM_STATUSES)[number];
export type ResponsePackageExportFormat = (typeof RESPONSE_PACKAGE_EXPORT_FORMATS)[number];
export type ResponsePackageExportReviewStatus = (typeof RESPONSE_PACKAGE_EXPORT_REVIEW_STATUSES)[number];
export type ResponseWorkspaceActivityEventType =
  | "status_changed"
  | "notes_updated"
  | "assignee_changed"
  | "due_date_changed"
  | "title_updated"
  | "linked_artifacts_updated"
  | "comment_created";

export interface ResponseWorkspaceUserSummary {
  userId: string;
  email: string | null;
  displayName: string | null;
}

export interface ResponseWorkspaceItem {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  assignedUserId: string | null;
  assignedUser: ResponseWorkspaceUserSummary | null;
  kind: ResponseWorkspaceItemKind;
  title: string;
  status: ResponseWorkspaceItemStatus;
  notes: string;
  dueAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  linkedArtifacts: ResponseWorkspaceLinkedArtifact[];
  activity: ResponseWorkspaceActivity[];
}

export interface ResponseWorkspaceLinkedArtifact {
  id: string;
  title: string;
  fileName: string;
  artifactType: string;
  purpose: string;
  contentType: string;
  byteSize: number;
  checksumSha256: string;
  reviewStatus: string;
  downloadUrl: string;
  evidenceLinks: ArtifactEvidenceLink[];
}

export interface ArtifactEvidenceLink {
  complianceCategory: "eligibility" | "documents" | "pricing" | "submission" | "risk";
  evidenceRole: string;
  submissionEvidenceKey: string;
  label: string;
}

export interface ResponseWorkspaceActivity {
  id: string;
  intentId: string;
  itemId: string;
  actorUserId: string;
  actor: ResponseWorkspaceUserSummary | null;
  eventType: ResponseWorkspaceActivityEventType;
  fromValue: string | null;
  toValue: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ResponseWorkspaceSummary {
  total: number;
  done: number;
  blocked: number;
  tasks: number;
  checkpoints: number;
  artifacts: number;
  outlineSections: number;
}

export interface ResponseWorkspace {
  intentId: string;
  bidId: string;
  userId: string;
  summary: ResponseWorkspaceSummary;
  items: ResponseWorkspaceItem[];
}

export interface ResponsePackageReadinessSummary {
  ready: boolean;
  totalOutlineSections: number;
  completedOutlineSections: number;
  blockedItems: number;
  artifactPlaceholders: number;
  artifactPlaceholdersWithLinks: number;
  missingArtifactLinks: number;
  openItems: number;
}

export interface ResponsePackageOutlineSection {
  id: string;
  title: string;
  status: ResponseWorkspaceItemStatus;
  notes: string;
  sortOrder: number;
  linkedArtifacts: ResponseWorkspaceLinkedArtifact[];
}

export type ResponsePackageSnapshotVersionChangeKind =
  | "created"
  | "readiness_changed"
  | "outline_status_changed"
  | "linked_artifacts_changed";

export interface ResponsePackageSnapshotVersionChange {
  kind: ResponsePackageSnapshotVersionChangeKind;
  label: string;
  fromValue: string | null;
  toValue: string | null;
}

export interface ResponsePackageSnapshotVersionSummary {
  versionNumber: number;
  previousSnapshotId: string | null;
  changeCount: number;
  changes: ResponsePackageSnapshotVersionChange[];
}

export interface ResponsePackageVersionHistoryEntry {
  snapshotId: string;
  title: string;
  createdAt: string;
  versionNumber: number;
  previousSnapshotId: string | null;
  changeCount: number;
  changes: ResponsePackageSnapshotVersionChange[];
}

export interface ResponsePackageVersionHistory {
  totalVersions: number;
  latestVersionNumber: number;
  totalChanges: number;
  entries: ResponsePackageVersionHistoryEntry[];
}

export type ResponsePackageComparisonItemKind =
  | "readiness"
  | "outline_status"
  | "outline_notes"
  | "linked_artifacts";

export interface ResponsePackageComparisonItem {
  kind: ResponsePackageComparisonItemKind;
  label: string;
  fromValue: string | null;
  toValue: string | null;
}

export interface ResponsePackageSnapshotComparison {
  comparisonKey: string;
  fromSnapshotId: string;
  toSnapshotId: string;
  fromTitle: string;
  toTitle: string;
  fromCreatedAt: string;
  toCreatedAt: string;
  fromVersionNumber: number;
  toVersionNumber: number;
  changeCount: number;
  items: ResponsePackageComparisonItem[];
}

export interface ResponsePackageSnapshot {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  createdByUserId: string;
  title: string;
  outline: ResponsePackageOutlineSection[];
  readiness: ResponsePackageReadinessSummary;
  exports: ResponsePackageExport[];
  version: ResponsePackageSnapshotVersionSummary;
  createdAt: string;
}

export interface ResponsePackageExport {
  id: string;
  snapshotId: string;
  intentId: string;
  bidId: string;
  userId: string;
  requestedByUserId: string;
  status: "ready";
  format: ResponsePackageExportFormat;
  fileName: string;
  contentType: string;
  byteSize: number;
  checksumSha256: string;
  readiness: ResponsePackageReadinessSummary;
  downloadUrl: string;
  createdAt: string;
  updatedAt: string;
  downloadedAt: string | null;
  reviewStatus: ResponsePackageExportReviewStatus;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewNotes: string;
  reviewHistory: ResponsePackageExportReviewEvent[];
}

export interface ResponsePackageExportReviewEvent {
  id: string;
  exportId: string;
  snapshotId: string;
  intentId: string;
  bidId: string;
  userId: string;
  actorUserId: string;
  fromReviewStatus: ResponsePackageExportReviewStatus;
  toReviewStatus: ResponsePackageExportReviewStatus;
  reviewNotes: string;
  createdAt: string;
}

export interface ResponsePackageReviewerSummaryEntry {
  userId: string;
  reviewCount: number;
  approvedCount: number;
  needsChangesCount: number;
  latestReviewedAt: string;
}

export interface ResponsePackageReviewerSummary {
  reviewerCount: number;
  reviewers: ResponsePackageReviewerSummaryEntry[];
}

export interface ResponsePackageApprovalThreshold {
  requiredApprovedExports: number;
  approvedExports: number;
  met: boolean;
}

export interface ResponsePackageGovernanceSummary {
  pendingReviewCount: number;
  approvedCount: number;
  needsChangesCount: number;
  longestPendingAgeHours: number | null;
  latestReviewerUserId: string | null;
  canSubmitWithReviewedExport: boolean;
  reviewerSummary: ResponsePackageReviewerSummary;
  reviewTimeline: ResponsePackageExportReviewEvent[];
  approvalThreshold: ResponsePackageApprovalThreshold;
  readinessReason: string;
}

export interface ResponsePackageWorkspace {
  workspace: ResponseWorkspace;
  outline: ResponsePackageOutlineSection[];
  readiness: ResponsePackageReadinessSummary;
  snapshots: ResponsePackageSnapshot[];
  governanceSummary: ResponsePackageGovernanceSummary;
  versionHistory: ResponsePackageVersionHistory;
  versionComparisons: ResponsePackageSnapshotComparison[];
  defaultVersionComparison: ResponsePackageSnapshotComparison | null;
}

export interface ResponseWorkspaceResponse {
  workspace: ResponseWorkspace;
}

export interface ResponsePackageWorkspaceResponse {
  packageWorkspace: ResponsePackageWorkspace;
}

export interface CreateResponsePackageSnapshotInput {
  title?: string;
}

export interface ResponsePackageSnapshotResponse {
  snapshot: ResponsePackageSnapshot;
  packageWorkspace: ResponsePackageWorkspace;
}

export interface CreateResponsePackageExportInput {
  snapshotId: string;
  format?: ResponsePackageExportFormat;
}

export interface UpdateResponsePackageExportReviewInput {
  reviewStatus: ResponsePackageExportReviewStatus;
  reviewNotes?: string | null;
}

export interface ResponsePackageExportResponse {
  exportRecord: ResponsePackageExport;
}

export interface UpdateResponseWorkspaceItemInput {
  itemId: string;
  title?: string;
  status?: ResponseWorkspaceItemStatus;
  notes?: string;
  dueAt?: string | null;
  assignedUserId?: string | null;
  linkedArtifactIds?: string[];
}

export interface ResponseWorkspaceComment {
  id: string;
  intentId: string;
  itemId: string;
  authorUserId: string;
  author: ResponseWorkspaceUserSummary | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResponseWorkspaceCommentInput {
  itemId: string;
  body: string;
}

export interface ResponseWorkspaceCommentsResponse {
  comments: ResponseWorkspaceComment[];
}

export interface ResponseWorkspaceCommentResponse {
  comment: ResponseWorkspaceComment;
}

export function isResponseWorkspaceItemKind(value: unknown): value is ResponseWorkspaceItemKind {
  return typeof value === "string" && RESPONSE_WORKSPACE_ITEM_KINDS.includes(value as ResponseWorkspaceItemKind);
}

export function isResponseWorkspaceItemStatus(value: unknown): value is ResponseWorkspaceItemStatus {
  return typeof value === "string" && RESPONSE_WORKSPACE_ITEM_STATUSES.includes(value as ResponseWorkspaceItemStatus);
}

export function isResponsePackageExportFormat(value: unknown): value is ResponsePackageExportFormat {
  return typeof value === "string" && RESPONSE_PACKAGE_EXPORT_FORMATS.includes(value as ResponsePackageExportFormat);
}

export function isResponsePackageExportReviewStatus(value: unknown): value is ResponsePackageExportReviewStatus {
  return typeof value === "string" &&
    RESPONSE_PACKAGE_EXPORT_REVIEW_STATUSES.includes(value as ResponsePackageExportReviewStatus);
}
