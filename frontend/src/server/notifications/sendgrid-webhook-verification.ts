/**
 * SendGrid Event Webhook signature verification for the
 * `POST /api/notifications/webhooks/sendgrid` route.
 *
 * SendGrid signs each webhook delivery with an ECDSA (secp256r1) key pair;
 * the verification key is generated once in the SendGrid dashboard (Settings
 * > Mail Settings > Event Webhook > Signed Event Webhook Requests) and
 * configured here via `NOTIFICATION_SENDGRID_WEBHOOK_PUBLIC_KEY` (base64,
 * as displayed by SendGrid). See
 * https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features
 * for the verification algorithm this implements.
 */
import { createVerify } from "node:crypto";

export class SendgridSignatureVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendgridSignatureVerificationError";
  }
}

function publicKeyToPem(base64Key: string) {
  return `-----BEGIN PUBLIC KEY-----\n${base64Key.trim()}\n-----END PUBLIC KEY-----`;
}

export interface VerifySendgridSignatureInput {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  publicKey: string;
}

export function verifySendgridSignature(input: VerifySendgridSignatureInput): void {
  if (!input.signature || !input.timestamp) {
    throw new SendgridSignatureVerificationError(
      "Missing X-Twilio-Email-Event-Webhook-Signature or X-Twilio-Email-Event-Webhook-Timestamp header",
    );
  }

  const verifier = createVerify("SHA256");
  verifier.update(input.timestamp + input.rawBody, "utf8");

  let isValid: boolean;
  try {
    isValid = verifier.verify(publicKeyToPem(input.publicKey), input.signature, "base64");
  } catch (error) {
    throw new SendgridSignatureVerificationError(
      `SendGrid signature verification error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isValid) {
    throw new SendgridSignatureVerificationError("SendGrid webhook signature verification failed");
  }
}
