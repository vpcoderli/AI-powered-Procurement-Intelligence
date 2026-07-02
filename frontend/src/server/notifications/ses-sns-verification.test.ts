import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SnsSignatureVerificationError, verifySnsSignature } from "./ses-sns-verification";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const certificatePem = publicKey.export({ type: "spki", format: "pem" }).toString();

function signEnvelope(envelope: Record<string, unknown>, fields: string[]) {
  const lines: string[] = [];
  for (const field of fields) {
    const fieldValue = envelope[field];
    if (fieldValue === undefined) continue;
    lines.push(field, String(fieldValue));
  }
  const stringToSign = `${lines.join("\n")}\n`;

  const signer = createSign("RSA-SHA1");
  signer.update(stringToSign, "utf8");
  return signer.sign(privateKey, "base64");
}

const trustedCertUrl = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc123.pem";

async function fetchCertStub() {
  return certificatePem;
}

describe("verifySnsSignature", () => {
  it("accepts a correctly signed Notification envelope", async () => {
    const base = {
      Type: "Notification",
      MessageId: "msg-1",
      TopicArn: "arn:aws:sns:us-east-1:123456789012:apsi-ses-events",
      Message: JSON.stringify({ notificationType: "Bounce" }),
      Timestamp: "2026-05-19T02:00:00.000Z",
      SigningCertURL: trustedCertUrl,
    };
    const signature = signEnvelope(base, ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]);

    await expect(
      verifySnsSignature({ ...base, Signature: signature }, { fetchCert: fetchCertStub }),
    ).resolves.toBeUndefined();
  });

  it("accepts a correctly signed SubscriptionConfirmation envelope", async () => {
    const base = {
      Type: "SubscriptionConfirmation",
      MessageId: "msg-2",
      Token: "token-value",
      TopicArn: "arn:aws:sns:us-east-1:123456789012:apsi-ses-events",
      Message: "You have chosen to subscribe to the topic.",
      SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription",
      Timestamp: "2026-05-19T02:00:00.000Z",
      SigningCertURL: trustedCertUrl,
    };
    const signature = signEnvelope(base, [
      "Message",
      "MessageId",
      "SubscribeURL",
      "Timestamp",
      "Token",
      "TopicArn",
      "Type",
    ]);

    await expect(
      verifySnsSignature({ ...base, Signature: signature }, { fetchCert: fetchCertStub }),
    ).resolves.toBeUndefined();
  });

  it("rejects a tampered message body", async () => {
    const base = {
      Type: "Notification",
      MessageId: "msg-1",
      TopicArn: "arn:aws:sns:us-east-1:123456789012:apsi-ses-events",
      Message: JSON.stringify({ notificationType: "Bounce" }),
      Timestamp: "2026-05-19T02:00:00.000Z",
      SigningCertURL: trustedCertUrl,
    };
    const signature = signEnvelope(base, ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]);

    await expect(
      verifySnsSignature(
        { ...base, Message: JSON.stringify({ notificationType: "Delivery" }), Signature: signature },
        { fetchCert: fetchCertStub },
      ),
    ).rejects.toThrow(SnsSignatureVerificationError);
  });

  it("rejects a SigningCertURL that does not point at a genuine amazonaws.com SNS host", async () => {
    const base = {
      Type: "Notification",
      MessageId: "msg-1",
      TopicArn: "arn:aws:sns:us-east-1:123456789012:apsi-ses-events",
      Message: JSON.stringify({ notificationType: "Bounce" }),
      Timestamp: "2026-05-19T02:00:00.000Z",
      SigningCertURL: "https://evil.example.com/cert.pem",
      Signature: "irrelevant",
    };

    await expect(verifySnsSignature(base, { fetchCert: fetchCertStub })).rejects.toThrow(
      SnsSignatureVerificationError,
    );
  });

  it("rejects an envelope missing a Signature", async () => {
    await expect(
      verifySnsSignature({ Type: "Notification", SigningCertURL: trustedCertUrl }, { fetchCert: fetchCertStub }),
    ).rejects.toThrow(SnsSignatureVerificationError);
  });

  it("rejects an unsupported SignatureVersion", async () => {
    await expect(
      verifySnsSignature(
        { Type: "Notification", SignatureVersion: "2", SigningCertURL: trustedCertUrl, Signature: "x" },
        { fetchCert: fetchCertStub },
      ),
    ).rejects.toThrow(/SignatureVersion/);
  });
});
