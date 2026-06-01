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

export interface ResponseWorkspaceItem {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  kind: ResponseWorkspaceItemKind;
  title: string;
  status: ResponseWorkspaceItemStatus;
  notes: string;
  dueAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
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

export interface ResponseWorkspaceResponse {
  workspace: ResponseWorkspace;
}

export interface UpdateResponseWorkspaceItemInput {
  itemId: string;
  title?: string;
  status?: ResponseWorkspaceItemStatus;
  notes?: string;
  dueAt?: string | null;
}

export function isResponseWorkspaceItemKind(value: unknown): value is ResponseWorkspaceItemKind {
  return typeof value === "string" && RESPONSE_WORKSPACE_ITEM_KINDS.includes(value as ResponseWorkspaceItemKind);
}

export function isResponseWorkspaceItemStatus(value: unknown): value is ResponseWorkspaceItemStatus {
  return typeof value === "string" && RESPONSE_WORKSPACE_ITEM_STATUSES.includes(value as ResponseWorkspaceItemStatus);
}
