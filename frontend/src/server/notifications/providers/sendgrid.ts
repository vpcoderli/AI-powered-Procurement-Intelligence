/**
 * SendGrid email notification provider built on the official `@sendgrid/mail`
 * client.
 *
 * Same pattern as `./ses.ts` and `@/server/storage/s3-object-storage.ts`:
 * written against the SDK even though `@sendgrid/mail` is not installed yet
 * (see package.json `dependencies`; run `npm install` after this change
 * lands). Constructing/using the client will throw at call time until the
 * dependency is installed.
 *
 * Selection is controlled by `NOTIFICATION_PROVIDER=sendgrid`. The API key
 * (`NOTIFICATION_SENDGRID_API_KEY`) is left as an env var placeholder --
 * this module never hardcodes or logs it.
 *
 * SendGrid bounce/complaint/delivery events arrive asynchronously via its
 * Event Webhook at `POST /api/notifications/webhooks/sendgrid`, not via the
 * synchronous `send()` response, which only reports whether SendGrid
 * accepted the request for delivery.
 */
import sgMail from "@sendgrid/mail";
import type { NotificationProvider, NotificationSendPayload } from "../types";

export class SendgridNotificationProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendgridNotificationProviderConfigError";
  }
}

type SendgridNotificationEnv = Record<string, string | undefined>;

interface SendgridMailClient {
  setApiKey(key: string): void;
  send(data: Record<string, unknown>): Promise<[{ headers?: Record<string, string> }, unknown]>;
}

export interface SendgridNotificationProviderOptions {
  env?: SendgridNotificationEnv;
  /** Injectable for tests; defaults to the `@sendgrid/mail` singleton client. */
  client?: SendgridMailClient;
}

function value(env: SendgridNotificationEnv, key: string) {
  return env[key]?.trim() ?? "";
}

function customArgs(payload: NotificationSendPayload) {
  // custom_args round-trip through the SendGrid Event Webhook payload, so
  // the webhook route can correlate an async bounce/complaint/delivery event
  // back to the originating `notification_outbox` row.
  return { apsi_notification_id: payload.id };
}

export function createSendgridNotificationProvider(
  options: SendgridNotificationProviderOptions = {},
): NotificationProvider {
  const env = options.env ?? process.env;
  const apiKey = value(env, "NOTIFICATION_SENDGRID_API_KEY");
  const fromAddress = value(env, "NOTIFICATION_SENDGRID_FROM_ADDRESS");

  if (!apiKey) {
    throw new SendgridNotificationProviderConfigError(
      "NOTIFICATION_SENDGRID_API_KEY is required for the SendGrid notification provider",
    );
  }

  if (!fromAddress) {
    throw new SendgridNotificationProviderConfigError(
      "NOTIFICATION_SENDGRID_FROM_ADDRESS is required for the SendGrid notification provider",
    );
  }

  let cachedClient: SendgridMailClient | undefined = options.client;

  function client(): SendgridMailClient {
    if (cachedClient) return cachedClient;
    sgMail.setApiKey(apiKey);
    cachedClient = sgMail as unknown as SendgridMailClient;
    return cachedClient;
  }

  return {
    async send(payload: NotificationSendPayload) {
      try {
        const [response] = await client().send({
          to: payload.recipient,
          from: fromAddress,
          subject: payload.subject,
          text: payload.bodyText,
          customArgs: customArgs(payload),
        });

        return {
          ok: true as const,
          providerMessageId: response?.headers?.["x-message-id"],
        };
      } catch (error) {
        return {
          ok: false as const,
          error: `SendGrid send failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
