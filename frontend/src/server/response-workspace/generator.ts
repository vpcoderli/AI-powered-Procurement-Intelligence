import type { IntentDetail } from "@/server/intents/types";
import type { ResponseWorkspaceItemKind, ResponseWorkspaceItemStatus } from "./types";

export interface GeneratedResponseWorkspaceItem {
  kind: ResponseWorkspaceItemKind;
  title: string;
  status: ResponseWorkspaceItemStatus;
  notes: string;
  dueAt: string | null;
  sortOrder: number;
}

function deadlineNote(intent: IntentDetail) {
  return intent.bid.deadlineDate ? `Deadline: ${intent.bid.deadlineDate}` : "Confirm the buyer deadline before scheduling.";
}

export function generateResponseWorkspaceItems(intent: IntentDetail): GeneratedResponseWorkspaceItem[] {
  return [
    {
      kind: "task",
      title: "Review solicitation and all attachments",
      status: "in_progress",
      notes: deadlineNote(intent),
      dueAt: intent.bid.deadlineDate ?? null,
      sortOrder: 10,
    },
    {
      kind: "task",
      title: "Build response calendar and owners",
      status: "todo",
      notes: "Map internal due dates for questions, drafts, pricing, and final package review.",
      dueAt: null,
      sortOrder: 20,
    },
    {
      kind: "task",
      title: "Draft response sections",
      status: "todo",
      notes: "Start with technical approach, management plan, and past performance.",
      dueAt: null,
      sortOrder: 30,
    },
    {
      kind: "task",
      title: "Collect pricing and partner inputs",
      status: "todo",
      notes: "Confirm supplier, subcontractor, and quote dependencies before final pricing.",
      dueAt: null,
      sortOrder: 40,
    },
    {
      kind: "task",
      title: "Run final package review",
      status: "todo",
      notes: "Check forms, signatures, addenda, attachments, and submission instructions.",
      dueAt: null,
      sortOrder: 50,
    },
    {
      kind: "checkpoint",
      title: "Pursue/no-bid decision confirmed",
      status: "todo",
      notes: "Record the internal decision and core rationale.",
      dueAt: null,
      sortOrder: 60,
    },
    {
      kind: "checkpoint",
      title: "Portal registration complete",
      status: "todo",
      notes: "Confirm account access before the final submission window.",
      dueAt: null,
      sortOrder: 70,
    },
    {
      kind: "checkpoint",
      title: "Addenda acknowledged",
      status: "todo",
      notes: "Check amendment/addenda updates before package lock.",
      dueAt: null,
      sortOrder: 80,
    },
    {
      kind: "checkpoint",
      title: "Internal review complete",
      status: "todo",
      notes: "Run internal quality review before submission.",
      dueAt: null,
      sortOrder: 90,
    },
    {
      kind: "artifact",
      title: "Solicitation files",
      status: "todo",
      notes: "Use archived attachments and buyer source links as source material.",
      dueAt: null,
      sortOrder: 100,
    },
    {
      kind: "artifact",
      title: "Compliance evidence",
      status: "todo",
      notes: "Collect certifications, forms, and proof points required by the manifest.",
      dueAt: null,
      sortOrder: 110,
    },
    {
      kind: "artifact",
      title: "Pricing workbook",
      status: "todo",
      notes: "Track pricing assumptions and quote inputs.",
      dueAt: null,
      sortOrder: 120,
    },
    {
      kind: "artifact",
      title: "Submission receipt",
      status: "todo",
      notes: "Attach or record the final confirmation after submission.",
      dueAt: null,
      sortOrder: 130,
    },
    {
      kind: "outline_section",
      title: "Cover letter / executive summary",
      status: "todo",
      notes: "Summarize fit, buyer objective, and response promise.",
      dueAt: null,
      sortOrder: 140,
    },
    {
      kind: "outline_section",
      title: "Technical approach",
      status: "todo",
      notes: "Describe delivery approach, assumptions, and risk controls.",
      dueAt: null,
      sortOrder: 150,
    },
    {
      kind: "outline_section",
      title: "Management plan",
      status: "todo",
      notes: "Capture staffing, governance, schedule, and communication plan.",
      dueAt: null,
      sortOrder: 160,
    },
    {
      kind: "outline_section",
      title: "Past performance",
      status: "todo",
      notes: "Select references aligned to buyer scope and evaluation factors.",
      dueAt: null,
      sortOrder: 170,
    },
    {
      kind: "outline_section",
      title: "Pricing and attachments",
      status: "todo",
      notes: "Keep pricing forms and required attachments in final package order.",
      dueAt: null,
      sortOrder: 180,
    },
  ];
}
