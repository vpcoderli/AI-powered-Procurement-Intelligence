import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SendgridSignatureVerificationError, verifySendgridSignature } from "./sendgrid-webhook-verification";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

function sign(timestamp: string, rawBody: string) {
  const signer = createSign("SHA256");
  signer.update(timestamp + rawBody, "utf8");
  return signer.sign(privateKey, "base64");
}

describe("verifySendgridSignature", () => {
  it("accepts a correctly signed payload", () => {
    const rawBody = JSON.stringify([{ event: "bounce", apsi_notification_id: "notification_1" }]);
    const timestamp = "1747620000";
    const signature = sign(timestamp, rawBody);

    expect(() =>
      verifySendgridSignature({ rawBody, signature, timestamp, publicKey: publicKeyBase64 }),
    ).not.toThrow();
  });

  it("rejects a tampered body", () => {
    const rawBody = JSON.stringify([{ event: "bounce", apsi_notification_id: "notification_1" }]);
    const timestamp = "1747620000";
    const signature = sign(timestamp, rawBody);
    const tamperedBody = JSON.stringify([{ event: "delivered", apsi_notification_id: "notification_1" }]);

    expect(() =>
      verifySendgridSignature({ rawBody: tamperedBody, signature, timestamp, publicKey: publicKeyBase64 }),
    ).toThrow(SendgridSignatureVerificationError);
  });

  it("rejects when the signature header is missing", () => {
    expect(() =>
      verifySendgridSignature({ rawBody: "[]", signature: null, timestamp: "123", publicKey: publicKeyBase64 }),
    ).toThrow(SendgridSignatureVerificationError);
  });

  it("rejects when the timestamp header is missing", () => {
    expect(() =>
      verifySendgridSignature({ rawBody: "[]", signature: "abc", timestamp: null, publicKey: publicKeyBase64 }),
    ).toThrow(SendgridSignatureVerificationError);
  });
});
