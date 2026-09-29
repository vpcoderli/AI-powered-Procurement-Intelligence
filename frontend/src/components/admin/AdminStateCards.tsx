"use client";

import type { LucideIcon } from "lucide-react";
import { UniversalState } from "@/components/universal-state";

export function AdminAccessState({
  code,
  title,
  description,
  action,
}: {
  code: "loading" | "permission_denied";
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-8">
      <UniversalState
        actions={action ? [{ href: action.href, label: action.label }] : undefined}
        className="bg-white p-6"
        code={code}
        message={description}
        title={title}
      />
    </div>
  );
}

export function AdminSectionStateCard({
  action,
  actionLabel,
  code,
  message,
  title,
}: {
  action?: () => void;
  actionLabel: string;
  code: "error" | "loading";
  message: string;
  title: string;
}) {
  return (
    <UniversalState
      actions={action ? [{ label: actionLabel, onClick: action }] : undefined}
      className="bg-white"
      code={code}
      message={message}
      title={title}
    />
  );
}

export function SummaryCard({ label, value, icon: Icon }: { label: string; value: number | string; icon: LucideIcon }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <Icon size={18} className="text-slate-400" />
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-normal text-slate-950">{value}</div>
    </div>
  );
}

/**
 * The card a phase-3 panel sits in on its page. Those panels were written to sit in a card (each root ends in a
 * hairline), so the card drops the hairline on the panel's last edge.
 */
export const ADMIN_PANEL_CARD = "rounded-lg border border-slate-200 bg-white shadow-sm [&>div]:border-b-0";

/** A section's notice: the outcome of the last action on it (tone `error` for a failure). */
export function AdminNotice({ message, tone = "info" }: { message: string | null; tone?: "info" | "error" }) {
  if (!message) return null;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg border px-4 py-3 text-sm font-medium shadow-sm ${
        tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-white text-slate-700"
      }`}
    >
      {message}
    </div>
  );
}
