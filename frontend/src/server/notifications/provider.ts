import type { NotificationProvider } from "./types";
import { createConsoleNotificationProvider } from "./providers/console";
import { createFileNotificationProvider } from "./providers/file";
import { createHttpNotificationProvider } from "./providers/http";
import { createSendgridNotificationProvider } from "./providers/sendgrid";
import { createSesNotificationProvider } from "./providers/ses";

export type NotificationProviderName = "file" | "console" | "http" | "ses" | "sendgrid";

export interface NotificationProviderConfig {
  provider: NotificationProviderName;
  outputDir?: string;
  httpEndpoint?: string;
  httpToken?: string;
  warnings: string[];
}

const VALID_PROVIDERS = new Set<NotificationProviderName>([
  "file",
  "console",
  "http",
  "ses",
  "sendgrid",
]);

const LIVE_EMAIL_PROVIDERS = new Set<NotificationProviderName>(["http", "ses", "sendgrid"]);

export class NotificationProviderConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "NotificationProviderConfigError";
  }
}

function normalizedProvider(value: string | undefined): NotificationProviderName | undefined {
  const provider = value?.trim();
  if (!provider) return "file";
  if (VALID_PROVIDERS.has(provider as NotificationProviderName)) {
    return provider as NotificationProviderName;
  }

  return undefined;
}

function assertHttpEndpoint(value: string | undefined) {
  if (!value?.trim()) {
    throw new NotificationProviderConfigError(["NOTIFICATION_HTTP_ENDPOINT is required"]);
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
  } catch {
    throw new NotificationProviderConfigError([
      "NOTIFICATION_HTTP_ENDPOINT must be an http(s) URL",
    ]);
  }

  return value;
}

export function resolveNotificationProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): NotificationProviderConfig {
  const provider = normalizedProvider(env.NOTIFICATION_PROVIDER);
  if (!provider) {
    throw new NotificationProviderConfigError([
      "NOTIFICATION_PROVIDER must be one of file, console, http, ses, or sendgrid",
    ]);
  }

  const warnings: string[] = [];
  if (env.NODE_ENV === "production" && !LIVE_EMAIL_PROVIDERS.has(provider)) {
    warnings.push(
      `NODE_ENV=production is using the ${provider} notification provider fallback; set NOTIFICATION_PROVIDER=ses, sendgrid, or http for live email delivery.`,
    );
  }

  if (provider === "http") {
    return {
      provider,
      httpEndpoint: assertHttpEndpoint(env.NOTIFICATION_HTTP_ENDPOINT),
      httpToken: env.NOTIFICATION_HTTP_TOKEN,
      warnings,
    };
  }

  if (provider === "file") {
    return {
      provider,
      outputDir: env.NOTIFICATION_OUTBOX_DIR,
      warnings,
    };
  }

  return { provider, warnings };
}

export function createNotificationProvider(): NotificationProvider {
  const config = resolveNotificationProviderConfig();

  if (config.provider === "http") {
    return createHttpNotificationProvider({
      endpoint: config.httpEndpoint,
      token: config.httpToken,
    });
  }

  if (config.provider === "console") {
    return createConsoleNotificationProvider();
  }

  if (config.provider === "ses") {
    return createSesNotificationProvider();
  }

  if (config.provider === "sendgrid") {
    return createSendgridNotificationProvider();
  }

  return createFileNotificationProvider({
    outputDir: config.outputDir,
  });
}
