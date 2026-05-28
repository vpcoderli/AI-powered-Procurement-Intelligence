import type { NotificationProvider, NotificationSendPayload } from "../types";

export interface HttpNotificationProviderOptions {
  endpoint?: string;
  token?: string;
}

function headers(token: string | undefined) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "Content-Type": "application/json",
  };
}

async function providerMessageId(response: Response) {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return undefined;

  try {
    const body = await response.json() as { providerMessageId?: unknown; id?: unknown };
    return typeof body.providerMessageId === "string"
      ? body.providerMessageId
      : typeof body.id === "string"
        ? body.id
        : undefined;
  } catch {
    return undefined;
  }
}

async function errorBody(response: Response) {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}

export function createHttpNotificationProvider(
  options: HttpNotificationProviderOptions = {},
): NotificationProvider {
  const endpoint = options.endpoint ?? process.env.NOTIFICATION_HTTP_ENDPOINT;
  const token = options.token ?? process.env.NOTIFICATION_HTTP_TOKEN;

  return {
    async send(payload: NotificationSendPayload) {
      if (!endpoint) {
        return { ok: false, error: "NOTIFICATION_HTTP_ENDPOINT is required" };
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return {
          ok: false,
          error: `HTTP notification provider returned ${response.status}: ${await errorBody(response)}`,
        };
      }

      return { ok: true, providerMessageId: await providerMessageId(response) };
    },
  };
}
