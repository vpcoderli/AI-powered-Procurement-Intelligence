export type CrawlerFailureKind = "network" | "parse" | "empty" | "unknown";

export interface CrawlerFailureInput {
  errorCode?: string | null;
  errorMessage?: string | null;
  fetchedCount?: number | null;
}

/** Python 侧抛出的异常类名，见 crawler/apsi_crawler/。 */
const NETWORK_ERROR_CODES = new Set([
  "Timeout",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ConnectTimeout",
  "ReadTimeout",
  "ConnectionError",
  "ProxyError",
  "ChunkedEncodingError",
  "ContentDecodingError",
  "RetryError",
  "RemoteDisconnected",
  "SSLError",
  "TooManyRedirects",
]);

const PARSE_ERROR_CODES = new Set([
  "HtmlPageError",
  "StateBidNormalizationError",
  "BidNormalizationError",
  "JSONDecodeError",
  "KeyError",
]);

const EMPTY_ERROR_CODES = new Set(["EmptyCrawlerResultError"]);

/**
 * `HtmlPageError` (crawler/apsi_crawler/html/public_page.py) is one class for very different failures, and only
 * the wording tells them apart:
 *
 *   "HTML request failed: <requests error>"                    a transport failure, no response came back
 *   "HTML request failed with status <code>: <response body>"  the portal answered with something other than 200
 *   "HTML response content type was not HTML: ...", "HTML response was empty",
 *   "HTML table was missing required headers: ..."             the page came back, but not as the parser expects
 *
 * The first two are matched at the START of the message only. A status message goes on to quote the response
 * body, which can say anything (other status codes, even this wording), and the errorMessage handed in here
 * carries the run's stderr after the failure's own message.
 */
const HTML_TRANSPORT_FAILURE = /^\s*HTML request failed:/i;
const HTML_STATUS_FAILURE = /^\s*HTML request failed with status (\d{3})\b/i;
/** Answers that say "try again later" rather than "the page changed": server errors, rate limits and a WAF's 403. */
const TRANSIENT_HTML_STATUS = /^(?:5\d\d|429|403)$/;

/**
 * The portal, or the way to it, was unavailable or pushed back: worth a retry, and no reason to send an approved
 * source to review at the first occurrence (it is degraded only after the default threshold of consecutive
 * failures). Anything else an `HtmlPageError` says (a 404 or any other status, a non-HTML or empty body, missing
 * table headers) means the page or tenant itself changed, and stays a parse failure.
 */
function isTransientHttpFailure(code: string | null | undefined, message: string | null | undefined) {
  const text = message ?? "";
  if (code === "HTTPError") return /\b(5\d{2}|429)\b/.test(text);
  if (code !== "HtmlPageError") return false;
  if (HTML_TRANSPORT_FAILURE.test(text)) return true;
  const status = HTML_STATUS_FAILURE.exec(text)?.[1];
  return status !== undefined && TRANSIENT_HTML_STATUS.test(status);
}

export function classifyCrawlerFailure(input: CrawlerFailureInput): CrawlerFailureKind {
  const code = input.errorCode ?? null;

  if (code && EMPTY_ERROR_CODES.has(code)) return "empty";
  if (code && NETWORK_ERROR_CODES.has(code)) return "network";
  if (isTransientHttpFailure(code, input.errorMessage)) return "network";
  if (code && PARSE_ERROR_CODES.has(code)) return "parse";
  if (!code && (input.fetchedCount ?? null) === 0) return "empty";

  return "unknown";
}

/** 解析失败是平台改版信号,重试无意义;空结果重试同样无意义。 */
export function shouldRetry(kind: CrawlerFailureKind): boolean {
  return kind === "network";
}

export function shouldFlagForReview(kind: CrawlerFailureKind): boolean {
  return kind === "parse";
}

/** 连续空结果比网络抖动更可疑——三轮就该有人看,网络类给到五次。 */
const EMPTY_DEGRADE_THRESHOLD = 3;
const DEFAULT_DEGRADE_THRESHOLD = 5;

export function degradeThresholdFor(kind: CrawlerFailureKind): number {
  return kind === "empty" ? EMPTY_DEGRADE_THRESHOLD : DEFAULT_DEGRADE_THRESHOLD;
}
