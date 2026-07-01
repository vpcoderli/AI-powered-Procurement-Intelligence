/**
 * Amazon SNS message signature verification for the SES bounce/complaint
 * webhook (`POST /api/notifications/webhooks/ses`).
 *
 * SNS signs each delivered message with an RSA key; the public certificate
 * is published at `SigningCertURL` inside the message envelope itself.
 * Verification:
 *   1. Reject envelopes whose `SigningCertURL` does not point at a genuine
 *      `sns.<region>.amazonaws.com` host (prevents an attacker from pointing
 *      us at a certificate they control).
 *   2. Fetch the certificate and verify `Signature` over the canonical
 *      string-to-sign built from the envelope fields, per the AWS-documented
 *      format for `Notification` and `SubscriptionConfirmation` message
 *      types (https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-from-sns.html).
 *
 * `NOTIFICATION_SES_SNS_SKIP_SIGNATURE_VERIFICATION=1` disables step 2 for
 * local/integration testing against fixture payloads that are not actually
 * signed by SNS; it must never be set in production (enforced by the route,
 * not this module).
 */
import { createVerify } from "node:crypto";
import type { SnsEnvelope } from "./delivery-events";

const SNS_HOSTNAME_PATTERN = /^sns\.[a-z0-9-]+\.amazonaws\.com$/i;

export class SnsSignatureVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnsSignatureVerificationError";
  }
}

function assertTrustedCertUrl(certUrl: string | undefined) {
  if (!certUrl) {
    throw new SnsSignatureVerificationError("SNS envelope is missing SigningCertURL");
  }

  let parsed: URL;
  try {
    parsed = new URL(certUrl);
  } catch {
    throw new SnsSignatureVerificationError("SNS envelope SigningCertURL is not a valid URL");
  }

  if (parsed.protocol !== "https:" || !SNS_HOSTNAME_PATTERN.test(parsed.hostname)) {
    throw new SnsSignatureVerificationError(
      `SNS envelope SigningCertURL host is not a trusted sns.*.amazonaws.com endpoint: ${parsed.hostname}`,
    );
  }

  return certUrl;
}

/**
 * Builds the canonical "string to sign" per AWS's documented field order.
 * `Notification` and `SubscriptionConfirmation`/`UnsubscribeConfirmation`
 * envelopes use slightly different field sets.
 */
function stringToSign(envelope: SnsEnvelope & Record<string, unknown>) {
  const isSubscriptionType =
    envelope.Type === "SubscriptionConfirmation" || envelope.Type === "UnsubscribeConfirmation";

  const fields = isSubscriptionType
    ? ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"]
    : ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"];

  const lines: string[] = [];
  for (const field of fields) {
    const rawValue = envelope[field];
    // Per AWS docs, `Subject` is only included in the signed string when
    // present in the envelope at all (Notification messages without a
    // Subject omit the field entirely rather than signing an empty value).
    if (field === "Subject" && rawValue === undefined) continue;
    if (rawValue === undefined) continue;
    lines.push(field, String(rawValue));
  }

  return `${lines.join("\n")}\n`;
}

export interface VerifySnsSignatureOptions {
  fetchCert?: (url: string) => Promise<string>;
}

async function defaultFetchCert(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new SnsSignatureVerificationError(`Failed to fetch SNS signing certificate: HTTP ${response.status}`);
  }
  return response.text();
}

export async function verifySnsSignature(
  envelope: SnsEnvelope & Record<string, unknown>,
  options: VerifySnsSignatureOptions = {},
): Promise<void> {
  const signatureVersion = envelope.SignatureVersion as string | undefined;
  if (signatureVersion && signatureVersion !== "1") {
    throw new SnsSignatureVerificationError(`Unsupported SNS SignatureVersion: ${signatureVersion}`);
  }

  const signature = envelope.Signature as string | undefined;
  if (!signature) {
    throw new SnsSignatureVerificationError("SNS envelope is missing Signature");
  }

  const certUrl = assertTrustedCertUrl(envelope.SigningCertURL as string | undefined);
  const fetchCert = options.fetchCert ?? defaultFetchCert;
  const certificatePem = await fetchCert(certUrl);

  const verifier = createVerify("RSA-SHA1");
  verifier.update(stringToSign(envelope), "utf8");

  const isValid = verifier.verify(certificatePem, signature, "base64");
  if (!isValid) {
    throw new SnsSignatureVerificationError("SNS message signature verification failed");
  }
}
