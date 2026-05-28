import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpNotificationProvider } from "./http";

const payload = {
  id: "notification_1",
  channel: "email" as const,
  recipient: "buyer@example.com",
  subject: "Subject",
  bodyText: "Body",
  dedupeKey: "notification:1",
  matchedBidIds: [],
};

describe("http notification provider", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts notification payloads to a configured endpoint with bearer auth", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ providerMessageId: "mail_123" }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    }));

    const provider = createHttpNotificationProvider({
      endpoint: "https://mail.example.test/send",
      token: "secret-token",
    });

    await expect(provider.send(payload)).resolves.toEqual({ ok: true, providerMessageId: "mail_123" });
    expect(fetchMock).toHaveBeenCalledWith("https://mail.example.test/send", {
      method: "POST",
      headers: {
        "Authorization": "Bearer secret-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  });

  it("returns a provider failure when the endpoint is missing or rejects the request", async () => {
    await expect(createHttpNotificationProvider().send(payload)).resolves.toEqual({
      ok: false,
      error: "NOTIFICATION_HTTP_ENDPOINT is required",
    });

    fetchMock.mockResolvedValueOnce(new Response("Nope", { status: 500 }));

    await expect(
      createHttpNotificationProvider({ endpoint: "https://mail.example.test/send" }).send(payload),
    ).resolves.toEqual({
      ok: false,
      error: "HTTP notification provider returned 500: Nope",
    });
  });
});
