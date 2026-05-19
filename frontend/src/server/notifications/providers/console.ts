import type { NotificationProvider } from "../types";

export function createConsoleNotificationProvider(): NotificationProvider {
  return {
    async send(payload) {
      console.info("[notification]", {
        id: payload.id,
        channel: payload.channel,
        recipient: payload.recipient,
        subject: payload.subject,
        dedupeKey: payload.dedupeKey,
        matchedBidIds: payload.matchedBidIds,
      });

      return { ok: true, providerMessageId: `console:${payload.id}` };
    },
  };
}
