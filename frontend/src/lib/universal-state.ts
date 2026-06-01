export const UNIVERSAL_STATE_CODES = [
  "loading",
  "empty",
  "error",
  "permission_denied",
  "ai_unavailable",
  "low_confidence",
  "upload_failed",
  "source_unavailable",
  "duplicate_opportunity",
  "expired_deadline",
  "plan_limit",
] as const;

export type UniversalStateCode = (typeof UNIVERSAL_STATE_CODES)[number];

export type UniversalStateSeverity = "neutral" | "info" | "warning" | "error";

export type UniversalStateContent = {
  title: string;
  message: string;
  severity: UniversalStateSeverity;
};

export const defaultUniversalStateContent: Record<
  UniversalStateCode,
  UniversalStateContent
> = {
  loading: {
    title: "Loading",
    message: "We are preparing the latest information.",
    severity: "info",
  },
  empty: {
    title: "Nothing here yet",
    message: "There are no matching records to show right now.",
    severity: "neutral",
  },
  error: {
    title: "Something went wrong",
    message: "The request could not be completed. Try again or share the trace id with support.",
    severity: "error",
  },
  permission_denied: {
    title: "Permission required",
    message: "Your account does not have access to this workspace area.",
    severity: "error",
  },
  ai_unavailable: {
    title: "AI is unavailable",
    message: "AI assistance is temporarily unavailable. Core procurement data is still accessible.",
    severity: "warning",
  },
  low_confidence: {
    title: "Low confidence result",
    message: "This result needs review before it is used for a procurement decision.",
    severity: "warning",
  },
  upload_failed: {
    title: "Upload failed",
    message: "The file could not be uploaded. Check the file and try again.",
    severity: "error",
  },
  source_unavailable: {
    title: "Source unavailable",
    message: "The original source is unavailable or could not be reached.",
    severity: "warning",
  },
  duplicate_opportunity: {
    title: "Possible duplicate",
    message: "This opportunity appears to match an existing record.",
    severity: "info",
  },
  expired_deadline: {
    title: "Deadline expired",
    message: "The response deadline has passed for this opportunity.",
    severity: "warning",
  },
  plan_limit: {
    title: "Plan limit reached",
    message: "Your current plan does not include more usage for this action.",
    severity: "warning",
  },
};

export function getDefaultUniversalStateContent(code: UniversalStateCode) {
  return defaultUniversalStateContent[code];
}
