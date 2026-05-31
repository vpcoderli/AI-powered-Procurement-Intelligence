export const KNOWLEDGE_ITEM_TYPES = ["workflow_note", "template_snippet", "requirement", "lesson"] as const;
export const KNOWLEDGE_SOURCE_KINDS = ["manual", "intent", "bid", "generated_coach"] as const;
export const WORKFLOW_COACH_CATEGORIES = ["deadline", "readiness", "compliance", "documents", "decision"] as const;
export const WORKFLOW_COACH_SEVERITIES = ["info", "warning", "critical"] as const;

export type KnowledgeItemType = (typeof KNOWLEDGE_ITEM_TYPES)[number];
export type KnowledgeSourceKind = (typeof KNOWLEDGE_SOURCE_KINDS)[number];
export type WorkflowCoachCategory = (typeof WORKFLOW_COACH_CATEGORIES)[number];
export type WorkflowCoachSeverity = (typeof WORKFLOW_COACH_SEVERITIES)[number];

export interface KnowledgeItem {
  id: string;
  organizationId: string;
  createdByUserId: string;
  title: string;
  body: string;
  type: KnowledgeItemType;
  tags: string[];
  sourceKind: KnowledgeSourceKind;
  sourceIntentId: string | null;
  sourceBidId: string | null;
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKnowledgeItemInput {
  organizationId: string;
  userId: string;
  title: string;
  body: string;
  type: string;
  tags?: unknown;
  sourceKind: string;
  sourceIntentId?: string | null;
  sourceBidId?: string | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListKnowledgeItemsInput {
  organizationId: string;
  intentId?: string | null;
  bidId?: string | null;
  q?: string | null;
  type?: string | null;
  limit?: number | null;
}

export interface KnowledgeListResponse {
  items: KnowledgeItem[];
}

export interface WorkflowCoachCard {
  id: string;
  category: WorkflowCoachCategory;
  severity: WorkflowCoachSeverity;
  title: string;
  guidance: string;
  suggestedAction: string;
  sourceLabel?: string;
  href?: string;
}

export interface KnowledgeStationResponse {
  coachCards: WorkflowCoachCard[];
  knowledge: KnowledgeItem[];
}
