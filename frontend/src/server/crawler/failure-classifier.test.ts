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
