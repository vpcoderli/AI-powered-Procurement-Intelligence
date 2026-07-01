/**
 * Amazon SES (v2) email notification provider built on the official AWS SDK
 * (`@aws-sdk/client-sesv2`).
 *
 * This mirrors the pattern already used by
 * `@/server/storage/s3-object-storage.ts`: the provider is written against
 * the AWS SDK client even though `@aws-sdk/client-sesv2` is not installed
 * yet (see package.json `dependencies`; run `npm install` after this change
 * lands). Constructing/using the client will throw at call time until the
 * dependency is installed.
 *
 * Selection is controlled by `NOTIFICATION_PROVIDER=ses`. Runtime credentials
 * are read the same way as the S3 provider: prefer explicit
 * `NOTIFICATION_SES_*` values so the notification and object-storage IAM
 * principals can be rotated independently, falling back to the SDK default
 * credential provider chain (instance role, ECS task role, etc.) when no
 * explicit keys are configured.
 *
 * Bounce and complaint events are not observed synchronously by `send()` --
 * SES delivers them asynchronously via SNS to the webhook route at
 * `POST /api/notifications/webhooks/ses`. `send()` only reports the
 * synchronous accept/reject outcome of the SendEmail call.
 */
import {
  SESv2Client,
  SendEmailCommand,
  type SESv2ClientConfig,
} from "@aws-sdk/client-sesv2";
import type { NotificationProvider, NotificationSendPayload } from "../types";

export class SesNotificationProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SesNotificationProviderConfigError";
  }
}

type SesNotificationEnv = Record<string, string | undefined>;

export interface SesNotificationProviderOptions {
  env?: SesNotificationEnv;
  /** Injectable for tests; defaults to constructing a real `SESv2Client`. */
  client?: SESv2Client;
}

function value(env: SesNotificationEnv, key: string) {
  return env[key]?.trim() ?? "";
}

function buildClientConfig(env: SesNotificationEnv): SESv2ClientConfig {
  const region = value(env, "NOTIFICATION_SES_REGION") || value(env, "AWS_REGION");
  const accessKeyId = value(env, "NOTIFICATION_SES_ACCESS_KEY_ID");
  const secretAccessKey = value(env, "NOTIFICATION_SES_SECRET_ACCESS_KEY");
  const sessionToken = value(env, "NOTIFICATION_SES_SESSION_TOKEN");

  if (!region) {
    throw new SesNotificationProviderConfigError(
      "NOTIFICATION_SES_REGION (or AWS_REGION) is required for the SES notification provider",
    );
  }

  return {
    region,
    // When explicit keys are not provided, omit the `credentials` field so
    // the SDK falls back to its default credential provider chain (IAM
    // instance role, ECS task role, etc.) instead of failing closed. This is
    // intentionally different from the S3 provider, which fails closed on
    // missing explicit keys, because SES sending in this codebase is
    // expected to run from the same execution role as the rest of the app
    // in most deployments.
    credentials:
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined }
        : undefined,
  };
}

function textOrHtmlBody(payload: NotificationSendPayload) {
  return {
    Text: {
      Data: payload.bodyText,
      Charset: "UTF-8",
    },
  };
}

function messageTags(payload: NotificationSendPayload) {
  // SES message tags round-trip through SNS bounce/complaint/delivery
  // notifications, so the webhook route can correlate an async event back
  // to the originating `notification_outbox` row without needing to parse
  // recipient addresses (which may not be unique per send).
  return [{ Name: "apsi_notification_id", Value: payload.id }];
}

export function createSesNotificationProvider(
  options: SesNotificationProviderOptions = {},
): NotificationProvider {
  const env = options.env ?? process.env;
  const fromAddress = value(env, "NOTIFICATION_SES_FROM_ADDRESS");
  const configurationSetName = value(env, "NOTIFICATION_SES_CONFIGURATION_SET") || undefined;

  if (!fromAddress) {
    throw new SesNotificationProviderConfigError(
      "NOTIFICATION_SES_FROM_ADDRESS is required for the SES notification provider",
    );
  }

  let cachedClient: SESv2Client | undefined = options.client;

  function client(): SESv2Client {
    if (cachedClient) return cachedClient;
    cachedClient = new SESv2Client(buildClientConfig(env));
    return cachedClient;
  }

  return {
    async send(payload: NotificationSendPayload) {
      try {
        const response = await client().send(
          new SendEmailCommand({
            FromEmailAddress: fromAddress,
            Destination: { ToAddresses: [payload.recipient] },
            Content: {
              Simple: {
                Subject: { Data: payload.subject, Charset: "UTF-8" },
                Body: textOrHtmlBody(payload),
              },
            },
            ConfigurationSetName: configurationSetName,
            EmailTags: messageTags(payload),
          }),
        );

        return { ok: true as const, providerMessageId: response.MessageId };
      } catch (error) {
        return {
          ok: false as const,
          error: `SES SendEmail failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
