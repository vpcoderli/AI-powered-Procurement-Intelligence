import { describe, expect, it } from "vitest";
import { parseQuoteUploadText } from "./upload-parser";

describe("quote upload parser", () => {
  it("parses CSV quote line items into normalized rows, totals, and comparison summary", () => {
    const parsed = parseQuoteUploadText({
      text: [
        "vendor,item,qty,unitPrice,total",
        "Acme Distribution,Secure appliance,2,1250.50,2501.00",
        "Acme Distribution,Support engineer,3,300,900",
        "Beta Supply,Secure appliance,2,1275.25,2550.50",
      ].join("\n"),
      sourceName: "quotes.csv",
    });

    expect(parsed.rows).toEqual([
      {
        rowNumber: 2,
        vendor: "Acme Distribution",
        item: "Secure appliance",
        quantity: 2,
        unitPriceCents: 125050,
        totalCents: 250100,
        currency: "USD",
      },
      {
        rowNumber: 3,
        vendor: "Acme Distribution",
        item: "Support engineer",
        quantity: 3,
        unitPriceCents: 30000,
        totalCents: 90000,
        currency: "USD",
      },
      {
        rowNumber: 4,
        vendor: "Beta Supply",
        item: "Secure appliance",
        quantity: 2,
        unitPriceCents: 127525,
        totalCents: 255050,
        currency: "USD",
      },
    ]);
    expect(parsed.totals).toEqual({
      rowCount: 3,
      pricedRowCount: 3,
      subtotalCents: 595150,
      currency: "USD",
    });
    expect(parsed.comparisonSummary).toEqual({
      vendorCount: 2,
      lineItemCount: 3,
      comparableQuotes: [
        {
          vendor: "Acme Distribution",
          quotedAmountCents: 340100,
          currency: "USD",
          lineItemCount: 2,
        },
        {
          vendor: "Beta Supply",
          quotedAmountCents: 255050,
          currency: "USD",
          lineItemCount: 1,
        },
      ],
    });
    expect(parsed.warnings).toEqual([]);
  });

  it("parses JSON quote line items and computes missing totals from quantity and unit price", () => {
    const parsed = parseQuoteUploadText({
      text: JSON.stringify({
        vendor: "Contoso Federal",
        currency: "EUR",
        lineItems: [
          { item: "Gateway license", qty: 4, unitPrice: 199.99 },
          { vendor: "Contoso Federal", item: "Implementation", quantity: "1", unitPrice: "1500.00", total: "1500.00" },
        ],
      }),
      sourceName: "contoso.json",
    });

    expect(parsed.rows).toEqual([
      {
        rowNumber: 1,
        vendor: "Contoso Federal",
        item: "Gateway license",
        quantity: 4,
        unitPriceCents: 19999,
        totalCents: 79996,
        currency: "EUR",
      },
      {
        rowNumber: 2,
        vendor: "Contoso Federal",
        item: "Implementation",
        quantity: 1,
        unitPriceCents: 150000,
        totalCents: 150000,
        currency: "EUR",
      },
    ]);
    expect(parsed.totals).toMatchObject({
      rowCount: 2,
      pricedRowCount: 2,
      subtotalCents: 229996,
      currency: "EUR",
    });
    expect(parsed.comparisonSummary.comparableQuotes).toEqual([
      {
        vendor: "Contoso Federal",
        quotedAmountCents: 229996,
        currency: "EUR",
        lineItemCount: 2,
      },
    ]);
  });

  it("keeps rows deterministic and emits warnings for missing or invalid prices", () => {
    const parsed = parseQuoteUploadText({
      text: [
        "vendor,item,qty,unitPrice,total",
        "Acme Distribution,Secure appliance,2,,",
        "Beta Supply,Support engineer,1,not-a-price,400",
        "Beta Supply,Training,2,100,200",
      ].join("\n"),
      sourceName: "warnings.csv",
    });

    expect(parsed.rows).toEqual([
      {
        rowNumber: 2,
        vendor: "Acme Distribution",
        item: "Secure appliance",
        quantity: 2,
        unitPriceCents: null,
        totalCents: null,
        currency: "USD",
      },
      {
        rowNumber: 3,
        vendor: "Beta Supply",
        item: "Support engineer",
        quantity: 1,
        unitPriceCents: null,
        totalCents: 40000,
        currency: "USD",
      },
      {
        rowNumber: 4,
        vendor: "Beta Supply",
        item: "Training",
        quantity: 2,
        unitPriceCents: 10000,
        totalCents: 20000,
        currency: "USD",
      },
    ]);
    expect(parsed.warnings).toEqual([
      {
        code: "missing_price",
        message: "Row 2 is missing unit price and total.",
        rowNumber: 2,
        field: "unitPrice",
      },
      {
        code: "invalid_price",
        message: 'Row 3 has an invalid unit price: "not-a-price".',
        rowNumber: 3,
        field: "unitPrice",
      },
    ]);
    expect(parsed.totals).toEqual({
      rowCount: 3,
      pricedRowCount: 2,
      subtotalCents: 60000,
      currency: "USD",
    });
    expect(parsed.comparisonSummary).toEqual({
      vendorCount: 2,
      lineItemCount: 3,
      comparableQuotes: [
        {
          vendor: "Beta Supply",
          quotedAmountCents: 60000,
          currency: "USD",
          lineItemCount: 2,
        },
      ],
    });
  });
});
