import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import * as billingService from "@/server/billing/subscriptions";
import { GET } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/service")>();

  return {
    ...actual,
    getSessionUser: vi.fn(),
  };
});
vi.mock("@/server/billing/subscriptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/billing/subscriptions")>();

  return {
    ...actual,
    listAccountInvoices: vi.fn(),
  };
});

describe("GET /api/account/billing/invoices", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns invoice history for the authenticated user", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "user",
      tier: "pro",
      features: ["bid_search", "submission_guidance"],
    });
    vi.mocked(billingService.listAccountInvoices).mockReturnValueOnce({
      invoices: [
        {
          id: "invoice_1",
          userId: "user_1",
          provider: "stripe",
          providerInvoiceId: "in_1",
          invoiceNumber: "WIN-1001",
          status: "paid",
          currency: "USD",
          amountDueCents: 7900,
          amountPaidCents: 7900,
          invoiceUrl: "https://billing.example.test/invoices/in_1",
          invoicePdfUrl: null,
          dueAt: "2026-05-28T00:00:00.000Z",
          paidAt: "2026-05-28T00:00:00.000Z",
          createdAt: "2026-05-28T00:00:00.000Z",
          updatedAt: "2026-05-28T00:00:00.000Z",
        },
      ],
    });

    const response = await GET(
      new Request("http://localhost/api/account/billing/invoices", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invoices).toEqual([expect.objectContaining({ invoiceNumber: "WIN-1001", status: "paid" })]);
    expect(billingService.listAccountInvoices).toHaveBeenCalledWith(expect.anything(), "user_1");
  });

  it("requires an authenticated session", async () => {
    const response = await GET(new Request("http://localhost/api/account/billing/invoices"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });
});
