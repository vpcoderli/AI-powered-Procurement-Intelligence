type BidDescription = {
  title?: string | null;
  description?: string | null;
  fullDescription?: string | null;
};

// Same edge-punctuation set as crawler/apsi_crawler/content_quality.py `echo_key`, so a legacy
// row holding "Road repair." under the title "Road repair" is still recognized as an echo.
const EDGE_PUNCTUATION = /^[\s.,:;!?\-\u2013\u2014_*/'"()\[\]{}\u3002\uFF0C\u3001\uFF1A\uFF1B\uFF01\uFF1F]+|[\s.,:;!?\-\u2013\u2014_*/'"()\[\]{}\u3002\uFF0C\u3001\uFF1A\uFF1B\uFF01\uFF1F]+$/g;

export function getBidDescription(bid: BidDescription): string {
  const comparable = (value: string | null | undefined) => value?.trim().replace(/\s+/g, " ").toLowerCase() || "";
  const identity = (value: string | null | undefined) => comparable(value).replace(EDGE_PUNCTUATION, "");
  const title = identity(bid.title);
  const shortText = identity(bid.description) !== title ? bid.description?.trim() || "" : "";
  const fullText = identity(bid.fullDescription) !== title ? bid.fullDescription?.trim() || "" : "";

  if (!fullText || comparable(shortText).startsWith(comparable(fullText))) {
    return shortText;
  }
  return fullText;
}
