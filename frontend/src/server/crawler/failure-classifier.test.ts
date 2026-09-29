import { describe, expect, it } from "vitest";
import {
  classifyCrawlerFailure,
  degradeThresholdFor,
  shouldFlagForReview,
  shouldRetry,
} from "./failure-classifier";

describe("classifyCrawlerFailure", () => {
  it("classifies timeouts and connection errors as network failures", () => {
    expect(classifyCrawlerFailure({ errorCode: "Timeout" })).toBe("network");
    expect(classifyCrawlerFailure({ errorCode: "ConnectionError" })).toBe("network");
    // Remaining transient exception names `requests` raises mid-transfer or via a proxy.
    for (const code of ["ChunkedEncodingError", "ProxyError", "RetryError", "ContentDecodingError", "RemoteDisconnected"]) {
      expect(classifyCrawlerFailure({ errorCode: code })).toBe("network");
    }
    // Persistence and lease outcomes are never network failures, so the worker must not retry them.
    expect(classifyCrawlerFailure({ errorCode: "CrawlerPersistenceError" })).toBe("unknown");
    expect(classifyCrawlerFailure({ errorCode: "CrawlerLeaseLostError" })).toBe("unknown");
    expect(classifyCrawlerFailure({ errorCode: "HTTPError", errorMessage: "503 Service Unavailable" })).toBe(
      "network",
    );
  });

  it("classifies the crawler's empty-result error as empty", () => {
    expect(classifyCrawlerFailure({ errorCode: "EmptyCrawlerResultError" })).toBe("empty");
  });

  it("classifies a successful run that returned zero records as empty", () => {
    expect(classifyCrawlerFailure({ fetchedCount: 0 })).toBe("empty");
  });

  it("classifies HTML extraction errors as parse failures", () => {
    expect(classifyCrawlerFailure({ errorCode: "HtmlPageError" })).toBe("parse");
    expect(classifyCrawlerFailure({ errorCode: "StateBidNormalizationError" })).toBe("parse");
  });

  it("falls back to unknown", () => {
    expect(classifyCrawlerFailure({ errorCode: "SomethingElse" })).toBe("unknown");
    expect(classifyCrawlerFailure({})).toBe("unknown");
  });

  describe("HtmlPageError", () => {
    // crawler/apsi_crawler/html/public_page.py raises one class for very different failures, and only the
    // wording tells them apart. A portal that could not be reached, or pushed back, is worth a retry and no
    // reason to send an approved source to review at once; a page that came back wrong is that reason.
    const classify = (errorMessage: string | null) => classifyCrawlerFailure({ errorCode: "HtmlPageError", errorMessage });

    it.each([
      { what: "a transport failure (no response came back)", message: "HTML request failed: HTTPSConnectionPool(host='www.bidnetdirect.com', port=443): Max retries exceeded with url: /colorado/x (Caused by NewConnectionError('Failed to establish a new connection'))", kind: "network" },
      { what: "a read timeout", message: "HTML request failed: HTTPSConnectionPool(host='www.bidnetdirect.com', port=443): Read timed out. (read timeout=30)", kind: "network" },
      { what: "a 500 answer", message: "HTML request failed with status 500: Internal Server Error", kind: "network" },
      { what: "a 503 answer", message: "HTML request failed with status 503: Service Unavailable", kind: "network" },
      { what: "a 429 answer", message: "HTML request failed with status 429: slow down", kind: "network" },
      { what: "a 403 answer", message: "HTML request failed with status 403: Forbidden", kind: "network" },
      // A bare 202 is an AWS WAF challenge on a portal that is not BidNet (BidNet's own becomes BidNetChallengeError).
      { what: "a 202 answer", message: "HTML request failed with status 202: ", kind: "network" },
      { what: "a 404 answer", message: "HTML request failed with status 404: Not Found", kind: "parse" },
      { what: "a 401 answer", message: "HTML request failed with status 401: Unauthorized", kind: "parse" },
      { what: "a 410 answer", message: "HTML request failed with status 410: Gone", kind: "parse" },
      { what: "a non-HTML content type", message: "HTML response content type was not HTML: application/json", kind: "parse" },
      { what: "an empty body", message: "HTML response was empty", kind: "parse" },
      { what: "missing table headers", message: "HTML table was missing required headers: title, due date", kind: "parse" },
      { what: "missing table headers of a dedicated portal", message: "HTML table was missing required Tennessee event headers: Event ID", kind: "parse" },
    ])("reads $what as $kind", ({ message, kind }) => {
      expect(classify(message)).toBe(kind);
    });

    it("stays a parse failure when it carries no message", () => {
      expect(classify(null)).toBe("parse");
      expect(classify("")).toBe("parse");
    });

    it("reads only the failure's own wording, never a response body or a log line that follows it", () => {
      // A status message goes on to quote the portal's response body, which can say anything, and the errorMessage
      // handed to the classifier carries the run's stderr after the failure's own message.
      expect(classify("HTML request failed with status 404: <h1>503 Service Unavailable</h1>")).toBe("parse");
      expect(classify("HTML request failed with status 404: HTML request failed: upstream timed out")).toBe("parse");
      expect(classify("HTML table was missing required headers: title\nHTML request failed: detail page timed out")).toBe("parse");
      expect(classify("HTML table was missing required headers: title\nHTML request failed with status 503: detail page")).toBe("parse");
      expect(classify("HTML request failed with status 503: 404 page not found upstream")).toBe("network");
    });
  });

  it("keeps the requests-style HTTPError rule: 5xx and 429 are network failures, nothing else is", () => {
    expect(classifyCrawlerFailure({ errorCode: "HTTPError", errorMessage: "503 Service Unavailable" })).toBe("network");
    expect(classifyCrawlerFailure({ errorCode: "HTTPError", errorMessage: "429 Too Many Requests" })).toBe("network");
    // 403 is only a transient answer of the HTML fetcher (HtmlPageError above); an HTTPError keeps its old reading.
    expect(classifyCrawlerFailure({ errorCode: "HTTPError", errorMessage: "403 Forbidden" })).toBe("unknown");
    expect(classifyCrawlerFailure({ errorCode: "HTTPError", errorMessage: "404 Not Found" })).toBe("unknown");
  });

  it("leaves a BidNet WAF challenge unclassified: the platform pause handles it, not source health", () => {
    expect(
      classifyCrawlerFailure({
        errorCode: "BidNetChallengeError",
        errorMessage: "BidNet is serving an AWS WAF bot challenge (HTTP 202): the platform is temporarily rate-limiting automated access.",
      }),
    ).toBe("unknown");
  });
});

describe("retry and review policy", () => {
  it("retries only network failures", () => {
    expect(shouldRetry("network")).toBe(true);
    expect(shouldRetry("parse")).toBe(false);
    expect(shouldRetry("empty")).toBe(false);
    expect(shouldRetry("unknown")).toBe(false);
  });

  it("flags parse failures for review immediately", () => {
    expect(shouldFlagForReview("parse")).toBe(true);
    expect(shouldFlagForReview("network")).toBe(false);
  });

  it("degrades silent-empty sources after three rounds and others after five", () => {
    expect(degradeThresholdFor("empty")).toBe(3);
    expect(degradeThresholdFor("network")).toBe(5);
    expect(degradeThresholdFor("unknown")).toBe(5);
  });
});
