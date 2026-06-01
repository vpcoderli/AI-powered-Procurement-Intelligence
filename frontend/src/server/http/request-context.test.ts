import { describe, expect, it } from "vitest";
import { createRequestContext } from "./request-context";

describe("request context", () => {
  it("uses request and correlation headers when present", () => {
    const context = createRequestContext(new Request("http://localhost/api/test", {
      headers: {
        "x-request-id": "req-test",
        "x-correlation-id": "corr-test",
      },
    }));

    expect(context).toEqual({ requestId: "req-test", correlationId: "corr-test" });
  });

  it("generates stable prefixed ids when headers are absent", () => {
    const context = createRequestContext();

    expect(context.requestId).toMatch(/^req_/);
    expect(context.correlationId).toMatch(/^corr_/);
  });
});
