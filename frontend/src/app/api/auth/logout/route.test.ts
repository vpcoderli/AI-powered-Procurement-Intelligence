import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/service")>();

  return {
    ...actual,
    logoutSession: vi.fn(),
  };
});

describe("POST /api/auth/logout", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("clears the session cookie", async () => {
    vi.mocked(authService.logoutSession).mockResolvedValueOnce();

    const response = await POST(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_existing` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(authService.logoutSession).toHaveBeenCalledWith({}, "sess_existing");
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
