type BidDescription = {
  title?: string | null;
  description?: string | null;
  fullDescription?: string | null;
};

// Same edge-punctuation set as crawler/apsi_crawler/content_quality.py `echo_key`, so a legacy
// row holding "Road repair." under the title "Road repair" is still recognized as an echo.
const EDGE_PUNCTUATION = /^[\s.,:;!?\-\u2013\u2014_*/'"()\[\]{}\u3002\uFF0C\u3001\uFF1A\uFF1B\uFF01\uFF1F]+|[\s.,:;!?\-\u2013\u2014_*/'"()\[\]{}\u3002\uFF0C\u3001\uFF1A\uFF1B\uFF01\uFF1F]+$/g;

// Mirrored rule for rule by crawler/apsi_crawler/content_quality.py `body_issue`;
// crawler/tests/fixtures/description_quality_contract.json is the shared contract.
const HTML_BODY = /^(?:<!doctype\b|<html\b|<head\b|<body\b)/i;
const URL_BODY = /^https?:\/\/\S+$/i;
const PLACEHOLDER_BODIES = [
  /^(?:(?:solicitation|short|full|bulletin|bid|project)\s+)?(?:description|desc|summary|scope of work|statement of work)[:\s]*$/i,
  /^(?:solicitation|presolicitation|combined synopsis\s*\/\s*solicitation|sources sought|special notice|award notice|sale of surplus property|ifb|rfp|rfq|itb|rfi)[.:\s]*$/i,
  /^(?:n\/a|none|null|not (?:available|provided)|no description(?: available)?|description (?:not available|pending)|tbd|待补|暂无(?:正文|描述))\.?$/i,
];
// A notice counts only as the whole notice: "log in" / "sign in" / "register" must lead to
// "to view|see|access|download", "required" or the end, and an error phrase must end at
// punctuation or the end. "Signing and striping…", "Login.gov integration…", "Register of
// Deeds…" and "Unauthorized vehicle towing…" are procurement scope.
const RESTRICTED_BODIES = [
  /^(?:please\s+)?(?:log\s*in|sign\s*in)(?:(?:\s+(?:to|with|on|at)\s+(?:the\s+)?[\w.]+(?:\s+[\w.]+){0,3})?\s+(?:or\s+register\s+)?to\s+(?:view|see|access|download)\b|\s+required\b|\s*[.!]?$)/i,
  /^you (?:must|need to) (?:log\s*in|sign\s*in)\b/i,
  /^(?:please\s+)?(?:register|create an account)(?:(?:\s+(?:with|on|at)\s+(?:the\s+)?[\w.]+(?:\s+[\w.]+){0,3})?\s+(?:or\s+(?:log\s*in|sign\s*in)\s+)?to\s+(?:view|see|access|download)\b|\s*[.!]?$)/i,
  /^(?:access denied|forbidden|unauthorized|error (?:403|404|500)|page not found)(?:\s*[.!:\-–—]|$)/i,
  /^(?:checking your browser\b|just a moment(?:\s*(?:\.\.\.|…|[.!])|$)|enable javascript(?:\s+(?:to|and)\b|\s*[.!]?$)|verify (?:you are|that you are) human\b)/i,
];
const METADATA_BODY = /^(?:purchase method|type code|bid type|informal bid flag|allow electronic quote)\s*(?::|：|$)/i;
const NAVIGATION_PART = /^(?:home|about(?: us)?|contact(?: us)?|privacy(?: policy)?|terms(?: of (?:use|service))?|copyright.*|all rights reserved|login|sign in|register)$/i;
// Only a text that is one street address and nothing else.
const ADDRESS_BODY = /^\d+[a-z]?\s+(?:[\w.'-]+\s+){0,5}(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr)\.?(?:\s*,?\s*(?:suite|ste|unit|room|rm|floor|fl)\.?\s*#?[\w-]+)?\s*,\s*[a-z][a-z .'-]*,?\s+[a-z]{2}\s+\d{5}(?:-\d{4})?\.?$/i;

export function isSamDescriptionLink(value: string): boolean {
  return /^https?:\/\/api\.sam\.gov\/(?:prod\/)?opportunities\/v1\/noticedesc(?:\?[^\s]*)?$/i.test(value.trim());
}

function comparable(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() || "";
}

/** Reject known portal placeholders, not short procurement scope. Length is not a quality gate. */
export function getBidDescriptionIssue(value: string | null | undefined, title?: string | null): string | null {
  const text = comparable(value);
  const identity = text.replace(EDGE_PUNCTUATION, "");
  if (!identity) return "missing_body";
  if (identity === comparable(title).replace(EDGE_PUNCTUATION, "")) return "title_echo";
  if (HTML_BODY.test(text)) return "restricted_or_error_body";
  if (URL_BODY.test(text)) return "body_url";
  if (PLACEHOLDER_BODIES.some((pattern) => pattern.test(text))) return "placeholder_body";
  if (RESTRICTED_BODIES.some((pattern) => pattern.test(text))) return "restricted_or_error_body";
  if (METADATA_BODY.test(text)) return "metadata_body";
  const navigation = (value ?? "").trim().split(/\s*[|\n·]\s*/).map(comparable).filter(Boolean);
  if (navigation.every((part) => NAVIGATION_PART.test(part))) return "navigation_body";
  if (ADDRESS_BODY.test(text)) return "address_body";
  return null;
}

export function getBidDescription(bid: BidDescription): string {
  const usefulBody = (value: string | null | undefined) => !getBidDescriptionIssue(value, bid.title)
    ? value?.trim() || "" : "";
  const shortText = usefulBody(bid.description);
  const fullText = usefulBody(bid.fullDescription);

  if (!fullText || comparable(shortText).startsWith(comparable(fullText))) {
    return shortText;
  }
  return fullText;
}
