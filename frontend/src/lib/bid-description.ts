type BidDescription = {
  title?: string | null;
  description?: string | null;
  fullDescription?: string | null;
};

// Same edge-punctuation set as crawler/apsi_crawler/content_quality.py `echo_key`, so a legacy
// row holding "Road repair." under the title "Road repair" is still recognized as an echo.
const EDGE_PUNCTUATION = /^[\s.,:;!?\-\u2013\u2014_*/'"()\[\]{}\u3002\uFF0C\u3001\uFF1A\uFF1B\uFF01\uFF1F]+|[\s.,:;!?\-\u2013\u2014_*/'"()\[\]{}\u3002\uFF0C\u3001\uFF1A\uFF1B\uFF01\uFF1F]+$/g;

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
  if (/^(?:<!doctype\b|<html\b|<head\b|<body\b)/i.test(text)) return "restricted_or_error_body";
  if (/^https?:\/\/\S+$/i.test(text)) return "body_url";
  if (/^(?:(?:solicitation|short|full|bulletin|bid|project)\s+)?(?:description|desc|summary|scope of work|statement of work)[:\s]*$/i.test(text)
    || /^(?:solicitation|presolicitation|combined synopsis\s*\/\s*solicitation|sources sought|special notice|award notice|sale of surplus property|ifb|rfp|rfq|itb|rfi)[.:\s]*$/i.test(text)
    || /^(?:n\/a|none|null|not (?:available|provided)|no description(?: available)?|description (?:not available|pending)|tbd|待补|暂无(?:正文|描述))\.?$/i.test(text)) {
    return "placeholder_body";
  }
  if (/^(?:please\s+)?(?:log\s*in|sign\s*in|you (?:must|need to) (?:log\s*in|sign\s*in)).*$/i.test(text)
    || /^(?:please\s+)?(?:register|create an account)\b.*\b(?:view|access|details|documents|opportunity)\b/i.test(text)
    || /^(?:access denied|forbidden|unauthorized|error (?:403|404|500)|page not found|checking your browser|just a moment|enable javascript|verify (?:you are|that you are) human)\b/i.test(text)) {
    return "restricted_or_error_body";
  }
  if (/^(?:purchase method|type code|bid type|informal bid flag|allow electronic quote)\s*(?::|：|$)/i.test(text)) {
    return "metadata_body";
  }
  const navigation = (value ?? "").trim().split(/\s*[|\n·]\s*/).map(comparable).filter(Boolean);
  if (navigation.every((part) => /^(?:home|about(?: us)?|contact(?: us)?|privacy(?: policy)?|terms(?: of (?:use|service))?|copyright.*|all rights reserved|login|sign in|register)$/i.test(part))) {
    return "navigation_body";
  }
  if (/^\d+[a-z]?\s+[\w\s.]+\s(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr)\.?\s*,[^\n]+\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\s*$/i.test(text)) {
    return "address_body";
  }
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
