export type CrawlerFailureKind = "network" | "parse" | "empty" | "unknown";

export interface CrawlerFailureInput {
  errorCode?: string | null;
  errorMessage?: string | null;
  fetchedCount?: number | null;
}

/** Python 侧抛出的异常类名，见 crawler/apsi_crawler/。 */
const NETWORK_ERROR_CODES = new Set([
  "Timeout",
  "ConnectTimeout",
  "ReadTimeout",
  "ConnectionError",
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

function isServerSideHttpError(code: string | null | undefined, message: string | null | undefined) {
  if (code !== "HTTPError") return false;
  return /\b(5\d{2}|429)\b/.test(message ?? "");
}

export function classifyCrawlerFailure(input: CrawlerFailureInput): CrawlerFailureKind {
  const code = input.errorCode ?? null;

  if (code && EMPTY_ERROR_CODES.has(code)) return "empty";
  if (code && NETWORK_ERROR_CODES.has(code)) return "network";
  if (isServerSideHttpError(code, input.errorMessage)) return "network";
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
