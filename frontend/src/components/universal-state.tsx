"use client";

import * as React from "react";

import {
  defaultUniversalStateContent,
  type UniversalStateCode,
  type UniversalStateSeverity,
} from "@/lib/universal-state";
import { cn } from "@/lib/utils";

type UniversalStateMetadataValue = string | number | boolean | null | undefined;

export type UniversalStateAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary";
  ariaLabel?: string;
};

export type UniversalStateProps = {
  code: UniversalStateCode;
  title?: React.ReactNode;
  message?: React.ReactNode;
  severity?: UniversalStateSeverity;
  traceId?: string;
  metadata?: Record<string, UniversalStateMetadataValue>;
  actions?: UniversalStateAction[];
  className?: string;
};

const severityClassName: Record<UniversalStateSeverity, string> = {
  neutral: "border-border bg-muted/20 text-foreground",
  info: "border-primary/20 bg-primary/5 text-foreground",
  warning: "border-amber-500/30 bg-amber-50 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100",
  error: "border-destructive/30 bg-destructive/5 text-foreground",
};

const indicatorClassName: Record<UniversalStateSeverity, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-primary",
  warning: "bg-amber-500",
  error: "bg-destructive",
};

function isAssertiveState(code: UniversalStateCode, severity: UniversalStateSeverity) {
  return severity === "error" || code === "permission_denied" || code === "upload_failed";
}

function formatMetadataValue(value: UniversalStateMetadataValue) {
  if (value === null || value === undefined) {
    return "Not available";
  }

  return String(value);
}

function UniversalState({
  actions = [],
  className,
  code,
  message,
  metadata,
  severity,
  title,
  traceId,
}: UniversalStateProps) {
  const headingId = React.useId();
  const descriptionId = React.useId();
  const defaults = defaultUniversalStateContent[code];
  const resolvedSeverity = severity ?? defaults.severity;
  const resolvedTitle = title ?? defaults.title;
  const resolvedMessage = message ?? defaults.message;
  const metadataEntries = Object.entries(metadata ?? {}).filter(
    ([, value]) => value !== undefined
  );
  const role = code === "loading" ? "status" : isAssertiveState(code, resolvedSeverity) ? "alert" : "region";
  const describedBy = traceId || resolvedMessage ? descriptionId : undefined;

  return (
    <section
      aria-describedby={describedBy}
      aria-labelledby={headingId}
      aria-live={role === "alert" ? "assertive" : "polite"}
      className={cn(
        "rounded-lg border p-4 shadow-sm",
        severityClassName[resolvedSeverity],
        className
      )}
      data-severity={resolvedSeverity}
      data-state-code={code}
      role={role}
    >
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-1 size-2.5 shrink-0 rounded-full",
            code === "loading" && "animate-pulse",
            indicatorClassName[resolvedSeverity]
          )}
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold leading-5" id={headingId}>
              {resolvedTitle}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground" id={descriptionId}>
              {resolvedMessage}
            </p>
          </div>

          {(traceId || metadataEntries.length > 0) && (
            <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              {traceId && (
                <div>
                  <dt className="font-medium text-foreground">Trace ID</dt>
                  <dd className="break-all font-mono">{traceId}</dd>
                </div>
              )}
              {metadataEntries.map(([key, value]) => (
                <div key={key}>
                  <dt className="font-medium text-foreground">{key}</dt>
                  <dd className="break-words">{formatMetadataValue(value)}</dd>
                </div>
              ))}
            </dl>
          )}

          {actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {actions.map((action) =>
                action.href ? (
                  <a
                    aria-label={action.ariaLabel}
                    className={cn(
                      "inline-flex h-8 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      action.variant === "secondary"
                        ? "border border-border bg-background hover:bg-muted"
                        : "bg-primary text-primary-foreground hover:bg-primary/90"
                    )}
                    href={action.href}
                    key={`${action.label}-${action.href}`}
                  >
                    {action.label}
                  </a>
                ) : (
                  <button
                    aria-label={action.ariaLabel}
                    className={cn(
                      "inline-flex h-8 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      action.variant === "secondary"
                        ? "border border-border bg-background hover:bg-muted"
                        : "bg-primary text-primary-foreground hover:bg-primary/90"
                    )}
                    key={action.label}
                    onClick={action.onClick}
                    type="button"
                  >
                    {action.label}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export { UniversalState };
