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

export type ResponseWorkspaceItemKind = (typeof RESPONSE_WORKSPACE_ITEM_KINDS)[number];
export type ResponseWorkspaceItemStatus = (typeof RESPONSE_WORKSPACE_ITEM_STATUSES)[number];
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
  downloadUrl: string;
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
  fileName: string;
  contentType: string;
  byteSize: number;
  checksumSha256: string;
  readiness: ResponsePackageReadinessSummary;
  downloadUrl: string;
  createdAt: string;
  updatedAt: string;
  downloadedAt: string | null;
}

export interface ResponsePackageWorkspace {
  workspace: ResponseWorkspace;
  outline: ResponsePackageOutlineSection[];
  readiness: ResponsePackageReadinessSummary;
  snapshots: ResponsePackageSnapshot[];
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
