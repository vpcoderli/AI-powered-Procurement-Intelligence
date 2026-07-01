import { describe, expect, it } from "vitest";
import { SendEmailCommand, type SESv2Client } from "@aws-sdk/client-sesv2";
import {
  SesNotificationProviderConfigError,
  createSesNotificationProvider,
} from "./ses";

type SentCommand = { command: unknown; commandName: string };

function fakeSesClient(handler: (command: unknown) => unknown, sent: SentCommand[] = []): SESv2Client {
  return {
    send: async (command: unknown) => {
      sent.push({ command, commandName: (command as { constructor: { name: string } }).constructor.name });
      return handler(command);
    },
  } as unknown as SESv2Client;
}

const baseEnv = {
  NOTIFICATION_SES_REGION: "us-east-1",
  NOTIFICATION_SES_FROM_ADDRESS: "alerts@apsi.example.com",
  NOTIFICATION_SES_ACCESS_KEY_ID: "AKIA_TEST_ACCESS_KEY",
  NOTIFICATION_SES_SECRET_ACCESS_KEY: "test-secret-key",
};

const payload = {
  id: "notification_1",
  channel: "email" as const,
  recipient: "buyer@example.com",
  subject: "APSi daily bid matches",
  bodyText: "1 matching bid",
  dedupeKey: "alert_1:2026-05-19:email",
  matchedBidIds: ["bid_1"],
};

describe("SES notification provider (@aws-sdk/client-sesv2)", () => {
  it("requires NOTIFICATION_SES_FROM_ADDRESS to construct the provider", () => {
    expect(() =>
      createSesNotificationProvider({ env: { ...baseEnv, NOTIFICATION_SES_FROM_ADDRESS: "" } }),
    ).toThrow(SesNotificationProviderConfigError);
  });

  it("requires a region before sending when no client is injected", async () => {
    // Region validation happens lazily inside buildClientConfig, on first
    // send, since the real SESv2Client is constructed lazily. Do not inject
    // a fake client here -- that would bypass buildClientConfig entirely.
    const provider = createSesNotificationProvider({
      env: { ...baseEnv, NOTIFICATION_SES_REGION: "", AWS_REGION: "" },
    });

    const result = await provider.send(payload);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("NOTIFICATION_SES_REGION");
  });

  it("sends an email and tags it with the notification id for webhook correlation", async () => {
    const sent: SentCommand[] = [];
    const client = fakeSesClient(() => ({ MessageId: "ses-message-id-1" }), sent);
    const provider = createSesNotificationProvider({ env: baseEnv, client });

    const result = await provider.send(payload);

    expect(result).toEqual({ ok: true, providerMessageId: "ses-message-id-1" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.commandName).toBe(SendEmailCommand.name);

    const input = (sent[0]?.command as SendEmailCommand).input;
    expect(input.FromEmailAddress).toBe("alerts@apsi.example.com");
    expect(input.Destination?.ToAddresses).toEqual(["buyer@example.com"]);
    expect(input.Content?.Simple?.Subject?.Data).toBe("APSi daily bid matches");
    expect(input.Content?.Simple?.Body?.Text?.Data).toBe("1 matching bid");
    expect(input.EmailTags).toEqual([{ Name: "apsi_notification_id", Value: "notification_1" }]);
  });

  it("returns a structured failure instead of throwing when SendEmail rejects", async () => {
    const client = fakeSesClient(() => {
      throw new Error("MessageRejected: Email address is not verified");
    });
    const provider = createSesNotificationProvider({ env: baseEnv, client });

    const result = await provider.send(payload);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("MessageRejected");
  });

  it("passes an explicit configuration set name when configured", async () => {
    const sent: SentCommand[] = [];
    const client = fakeSesClient(() => ({ MessageId: "msg_2" }), sent);
    const provider = createSesNotificationProvider({
      env: { ...baseEnv, NOTIFICATION_SES_CONFIGURATION_SET: "apsi-notifications" },
      client,
    });

    await provider.send(payload);

    const input = (sent[0]?.command as SendEmailCommand).input;
    expect(input.ConfigurationSetName).toBe("apsi-notifications");
  });
});
