import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, type StructuredLogEntry } from "./logger";

describe("createLogger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits structured JSON entries with service, level, message, and timestamp", () => {
    const entries: StructuredLogEntry[] = [];
    const testLogger = createLogger({ service: "test:service", sink: (entry) => entries.push(entry) });

    testLogger.info("something_happened", { foo: "bar" });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "info",
      message: "something_happened",
      service: "test:service",
      foo: "bar",
    });
    expect(typeof entries[0].timestamp).toBe("string");
    expect(new Date(entries[0].timestamp).toString()).not.toBe("Invalid Date");
  });

  it("merges context from child loggers", () => {
    const entries: StructuredLogEntry[] = [];
    const rootLogger = createLogger({ service: "worker:crawler", sink: (entry) => entries.push(entry) });
    const childLogger = rootLogger.child({ owner: "crawler-worker:123" });

    childLogger.warn("slow_source", { source: "SAM.gov" });

    expect(entries[0]).toMatchObject({
      service: "worker:crawler",
      owner: "crawler-worker:123",
      source: "SAM.gov",
      message: "slow_source",
      level: "warn",
    });
  });

  it("normalizes Error instances passed to error()", () => {
    const entries: StructuredLogEntry[] = [];
    const testLogger = createLogger({ service: "test:service", sink: (entry) => entries.push(entry) });

    testLogger.error("request_failed", new Error("boom"));

    expect(entries[0].errorName).toBe("Error");
    expect(entries[0].errorMessage).toBe("boom");
    expect(typeof entries[0].stack).toBe("string");
  });

  it("normalizes an `error` field within a fields object", () => {
    const entries: StructuredLogEntry[] = [];
    const testLogger = createLogger({ service: "test:service", sink: (entry) => entries.push(entry) });

    testLogger.error("request_failed", { error: new Error("boom"), requestId: "req_1" });

    expect(entries[0].errorMessage).toBe("boom");
    expect(entries[0].requestId).toBe("req_1");
    expect(entries[0].error).toBeUndefined();
  });

  it("filters out entries below minLevel", () => {
    const entries: StructuredLogEntry[] = [];
    const testLogger = createLogger({ service: "test:service", minLevel: "warn", sink: (entry) => entries.push(entry) });

    testLogger.debug("ignored");
    testLogger.info("ignored");
    testLogger.warn("kept");
    testLogger.error("kept-too");

    expect(entries.map((entry) => entry.message)).toEqual(["kept", "kept-too"]);
  });
});
