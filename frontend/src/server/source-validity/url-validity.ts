export type SourceValidityFindingCode =
  | "empty_url"
  | "invalid_url"
  | "placeholder_url"
  | "unsafe_external_attachment";

export interface SourceValidityFinding {
  code: SourceValidityFindingCode;
  message: string;
}

const PLACEHOLDER_HOST_PATTERNS = [/^localhost$/i, /^127\.0\.0\.1$/, /^0\.0\.0\.0$/, /(^|\.)example\.(com|org|net)$/i];
const PLACEHOLDER_PATH_PATTERNS = [/\/opp\/12345/i, /\/placeholder(\/|$)/i, /\/example(\/|$)/i];

function parseHttpUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function placeholderFinding(value: string, parsed: URL): SourceValidityFinding | null {
  const hasPlaceholderHost = PLACEHOLDER_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname));
  const hasPlaceholderPath = PLACEHOLDER_PATH_PATTERNS.some((pattern) => pattern.test(parsed.pathname));

  if (!hasPlaceholderHost && !hasPlaceholderPath) return null;

  return {
    code: "placeholder_url",
    message: `${value} looks like demo, placeholder, or local-only data.`,
  };
}

export function validateBidSourceUrl(value: string): SourceValidityFinding[] {
  if (!value.trim()) {
    return [{ code: "empty_url", message: "Source URL is empty." }];
  }

  const parsed = parseHttpUrl(value);
  if (!parsed) {
    return [{ code: "invalid_url", message: `${value} is not a valid HTTP(S) URL.` }];
  }

  const placeholder = placeholderFinding(value, parsed);
  return placeholder ? [placeholder] : [];
}

export function validateStateAttachmentUrl(value: string): SourceValidityFinding[] {
  if (!value.trim()) {
    return [{ code: "empty_url", message: "Attachment URL is empty." }];
  }

  if (value.startsWith("/api/bids/") && value.includes("/attachments/")) {
    return [];
  }

  const parsed = parseHttpUrl(value);
  if (!parsed) {
    return [{ code: "invalid_url", message: `${value} is not a valid attachment URL.` }];
  }

  const placeholder = placeholderFinding(value, parsed);
  return [
    ...(placeholder ? [placeholder] : []),
    {
      code: "unsafe_external_attachment",
      message: `${value} is a raw external attachment URL; use the safe local download route.`,
    },
  ];
}
