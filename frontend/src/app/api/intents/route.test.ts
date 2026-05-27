import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as intentService from "@/server/intents/service";
import { GET } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/intents/service", () => ({
  listUserIntents: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const listUserIntents = vi.mocked(intentService.listUserIntents);

describe("GET /api/intents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue({ kind: "authenticated", userId: "user_1" });
  });

  it("lists intents for the current principal", async () => {
    const intents = [{ id: "intent_1", userId: "user_1", status: "intent_added" }];
    listUserIntents.mockResolvedValueOnce(intents);

    const response = await GET(new Request("http://localhost/api/intents"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ intents });
    expect(listUserIntents).toHaveBeenCalledWith(expect.anything(), "user_1");
  });

  it("returns INTERNAL_ERROR for unexpected failures", async () => {
    listUserIntents.mockRejectedValueOnce(new Error("private detail"));

    const response = await GET(new Request("http://localhost/api/intents"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
});
