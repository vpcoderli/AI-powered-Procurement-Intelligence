import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MODES,
  DEFAULT_ATTACHMENT_POLICY,
  parseAttachmentPolicy,
  serializeAttachmentPolicy,
  validateAttachmentPolicyInput,
} from "./policy";

describe("parseAttachmentPolicy", () => {
  it("returns the defaults for an empty fetch config", () => {
    expect(parseAttachmentPolicy({})).toEqual(DEFAULT_ATTACHMENT_POLICY);
    expect(parseAttachmentPolicy({ attachments: null })).toEqual(DEFAULT_ATTACHMENT_POLICY);
    expect(parseAttachmentPolicy({ attachments: [] })).toEqual(DEFAULT_ATTACHMENT_POLICY);
  });

  it("reads the snake_case block", () => {
    expect(
      parseAttachmentPolicy({
        attachments: {
          archive: false,
          mode: "browser",
          max_per_run: 10,
          min_interval_seconds: 0,
          timeout_seconds: 90,
          max_bytes: 1_048_576,
          browser_link_selector: "a.download",
        },
      }),
    ).toEqual({
      archive: false,
      mode: "browser",
      maxPerRun: 10,
      minIntervalSeconds: 0,
      timeoutSeconds: 90,
      maxBytes: 1_048_576,
      browserLinkSelector: "a.download",
    });
  });

  it("clamps out-of-range numbers and drops unusable values", () => {
    const policy = parseAttachmentPolicy({
      attachments: {
        mode: "headless",
        max_per_run: 5000,
        min_interval_seconds: -12,
        timeout_seconds: 1,
        max_bytes: 999_999_999,
        browser_link_selector: "   ",
      },
    });

    expect(policy.mode).toBe("direct");
    expect(policy.maxPerRun).toBe(200);
    expect(policy.minIntervalSeconds).toBe(0);
    expect(policy.timeoutSeconds).toBe(5);
    expect(policy.maxBytes).toBe(209_715_200);
    expect(policy.browserLinkSelector).toBeNull();
  });

  it("treats any non-true archive value as disabled but an absent one as enabled", () => {
    expect(parseAttachmentPolicy({ attachments: { archive: false } }).archive).toBe(false);
    expect(parseAttachmentPolicy({ attachments: { archive: "yes" } }).archive).toBe(false);
    expect(parseAttachmentPolicy({ attachments: { mode: "direct" } }).archive).toBe(true);
  });
});

describe("serializeAttachmentPolicy", () => {
  it("round-trips through parseAttachmentPolicy", () => {
    const policy = {
      archive: true,
      mode: "browser" as const,
      maxPerRun: 25,
      minIntervalSeconds: 5,
      timeoutSeconds: 45,
      maxBytes: 10_485_760,
      browserLinkSelector: "#download",
    };

    const serialized = serializeAttachmentPolicy(policy);

    expect(serialized).toEqual({
      attachments: {
        archive: true,
        mode: "browser",
        max_per_run: 25,
        min_interval_seconds: 5,
        timeout_seconds: 45,
        max_bytes: 10_485_760,
        browser_link_selector: "#download",
      },
    });
    expect(parseAttachmentPolicy(serialized)).toEqual(policy);
  });
});

describe("validateAttachmentPolicyInput", () => {
  it("accepts a valid block and an empty one", () => {
    expect(validateAttachmentPolicyInput({})).toBeNull();
    expect(
      validateAttachmentPolicyInput({ archive: true, mode: "direct", max_per_run: 50, browser_link_selector: null }),
    ).toBeNull();
  });

  it("rejects out-of-range numbers with the range in the message", () => {
    expect(validateAttachmentPolicyInput({ max_per_run: 201 })).toBe(
      "attachments.max_per_run must be between 1 and 200.",
    );
    expect(validateAttachmentPolicyInput({ min_interval_seconds: 61 })).toBe(
      "attachments.min_interval_seconds must be between 0 and 60.",
    );
    expect(validateAttachmentPolicyInput({ timeout_seconds: 4 })).toBe(
      "attachments.timeout_seconds must be between 5 and 120.",
    );
    expect(validateAttachmentPolicyInput({ max_bytes: 1024 })).toBe(
      "attachments.max_bytes must be between 1048576 and 209715200.",
    );
    expect(validateAttachmentPolicyInput({ max_per_run: "50" })).toBe(
      "attachments.max_per_run must be between 1 and 200.",
    );
  });

  it("rejects bad shapes", () => {
    expect(validateAttachmentPolicyInput("nope")).toBe("attachments must be a JSON object.");
    expect(validateAttachmentPolicyInput([])).toBe("attachments must be a JSON object.");
    expect(validateAttachmentPolicyInput({ archive: "true" })).toBe("attachments.archive must be a boolean.");
    expect(validateAttachmentPolicyInput({ mode: "playwright" })).toBe(
      `attachments.mode must be one of ${ATTACHMENT_MODES.join(", ")}.`,
    );
    expect(validateAttachmentPolicyInput({ browser_link_selector: "  " })).toBe(
      "attachments.browser_link_selector must be a non-empty string or null.",
    );
  });
});
