import { describe, expect, it } from "vitest";
import { InvalidSubscriptionInputError } from "./subscriptions";
import { normalizeStripeWebhookEvent, stripePriceIdForTier } from "./providers";

describe("billing provider adapters", () => {
  it("resolves Stripe monthly price ids by tier", () => {
    expect(stripePriceIdForTier("pro", {
      STRIPE_PRICE_PRO_MONTHLY: "price_pro",
      STRIPE_PRICE_BUSINESS_MONTHLY: "price_business",
    })).toBe("price_pro");
    expect(stripePriceIdForTier("business", {
      STRIPE_PRICE_PRO_MONTHLY: "price_pro",
      STRIPE_PRICE_BUSINESS_MONTHLY: "price_business",
    })).toBe("price_business");
  });

  it("rejects self-service Stripe checkout for tiers without configured prices", () => {
    expect(() => stripePriceIdForTier("enterprise", {})).toThrow(InvalidSubscriptionInputError);
    expect(() => stripePriceIdForTier("pro", {})).toThrow(InvalidSubscriptionInputError);
  });

  it("maps Stripe checkout completion into the internal provider event", () => {
    const event = normalizeStripeWebhookEvent({
      id: "evt_checkout_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          customer: "cus_123",
          subscription: {
            id: "sub_123",
            status: "active",
            current_period_end: 1782604800,
            cancel_at_period_end: false,
          },
          client_reference_id: "user_buyer",
          customer_details: { email: "buyer@example.com" },
          metadata: { tier: "pro" },
        },
      },
    });

    expect(event).toEqual({
      id: "evt_checkout_1",
      type: "checkout.completed",
      provider: "stripe",
      userId: "user_buyer",
      email: "buyer@example.com",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
      providerSessionId: "cs_test_123",
      tier: "pro",
      status: "active",
      currentPeriodEnd: "2026-06-28T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      metadata: { stripeEventType: "checkout.session.completed" },
    });
  });

  it("falls back to Stripe subscription item period end when root period end is absent", () => {
    const event = normalizeStripeWebhookEvent({
      id: "evt_subscription_updated_1",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          customer: "cus_123",
          status: "active",
          cancel_at_period_end: true,
          items: {
            data: [{ current_period_end: 1782604800 }],
          },
          metadata: { tier: "business", userId: "user_buyer" },
        },
      },
    });

    expect(event).toMatchObject({
      id: "evt_subscription_updated_1",
      type: "subscription.updated",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
      tier: "business",
      status: "active",
      currentPeriodEnd: "2026-06-28T00:00:00.000Z",
      cancelAtPeriodEnd: true,
    });
  });

  it("maps Stripe invoice payment failure into a past-due provider event", () => {
    const event = normalizeStripeWebhookEvent({
      id: "evt_invoice_failed_1",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_123",
          customer: "cus_123",
          subscription: "sub_123",
          number: "WIN-1001",
          hosted_invoice_url: "https://invoice.stripe.test/in_123",
          invoice_pdf: "https://invoice.stripe.test/in_123.pdf",
          amount_due: 7900,
          amount_paid: 0,
          currency: "usd",
          due_date: 1782604800,
          metadata: { tier: "business", userId: "user_buyer" },
        },
      },
    });

    expect(event).toEqual({
      id: "evt_invoice_failed_1",
      type: "invoice.payment_failed",
      provider: "stripe",
      userId: "user_buyer",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
      providerInvoiceId: "in_123",
      invoiceNumber: "WIN-1001",
      invoiceUrl: "https://invoice.stripe.test/in_123",
      invoicePdfUrl: "https://invoice.stripe.test/in_123.pdf",
      amountDueCents: 7900,
      amountPaidCents: 0,
      currency: "USD",
      dueAt: "2026-06-28T00:00:00.000Z",
      paidAt: null,
      tier: "business",
      status: "past_due",
      metadata: { stripeEventType: "invoice.payment_failed" },
    });
  });
});
