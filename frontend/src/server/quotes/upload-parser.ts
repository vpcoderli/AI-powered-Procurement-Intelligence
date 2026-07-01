import type {
  QuoteUploadComparableQuote,
  QuoteUploadNormalizedRow,
  QuoteUploadParseInput,
  QuoteUploadParseResult,
  QuoteUploadWarning,
} from "./types";

type RawQuoteLineItem = Record<string, unknown>;

const DEFAULT_CURRENCY = "USD";

const FIELD_ALIASES = {
  vendor: ["vendor", "supplier", "partner", "vendorName", "supplierName"],
  item: ["item", "lineItem", "description", "name", "product", "sku"],
  quantity: ["qty", "quantity", "count", "units"],
  unitPrice: ["unitPrice", "unit_price", "unit price", "price", "rate"],
  total: ["total", "lineTotal", "line_total", "line total", "amount", "extendedPrice"],
  currency: ["currency", "ccy"],
} as const;

function normalizeHeader(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function aliasValue(row: RawQuoteLineItem, aliases: readonly string[]) {
  const normalizedEntries = new Map(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]),
  );

  for (const alias of aliases) {
    const value = normalizedEntries.get(normalizeHeader(alias));
    if (value !== undefined) return value;
  }

  return undefined;
}

function normalizeText(value: unknown, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim() || fallback;
}

function normalizeCurrency(value: unknown, fallback = DEFAULT_CURRENCY) {
  const normalized = normalizeText(value, fallback).toUpperCase();
  return normalized.slice(0, 12) || fallback;
}

function parseQuantity(value: unknown) {
  if (value === undefined || value === null || value === "") return 1;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseMoneyCents(value: unknown) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const normalized = raw.replace(/[\u0024\u20ac\u00a3,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return Math.round(parsed * 100);
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell.trim());
  return cells;
}

function parseCsv(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);
    const row: RawQuoteLineItem = {};
    headers.forEach((header, cellIndex) => {
      row[header] = cells[cellIndex] ?? "";
    });
    return { row, rowNumber: index + 2 };
  });
}

function parseJson(text: string) {
  const parsed = JSON.parse(text) as unknown;
  const root = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as RawQuoteLineItem : {};
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(root.lineItems)
      ? root.lineItems
      : Array.isArray(root.items)
        ? root.items
        : Array.isArray(root.rows)
          ? root.rows
          : [];
  const vendor = root.vendor;
  const currency = root.currency;

  return items
    .filter((item): item is RawQuoteLineItem => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((row, index) => ({
      row: {
        vendor,
        currency,
        ...row,
      },
      rowNumber: index + 1,
    }));
}

function looksLikeJson(input: QuoteUploadParseInput, trimmedText: string) {
  const sourceName = input.sourceName?.toLowerCase() ?? "";
  const contentType = input.contentType?.toLowerCase() ?? "";

  return sourceName.endsWith(".json") || contentType.includes("json") || trimmedText.startsWith("{") || trimmedText.startsWith("[");
}

function looksLikeCsv(input: QuoteUploadParseInput) {
  const sourceName = input.sourceName?.toLowerCase() ?? "";
  const contentType = input.contentType?.toLowerCase() ?? "";

  return sourceName.endsWith(".csv") || contentType.includes("csv") || contentType.includes("text/plain");
}

function warningForPrice(
  rowNumber: number,
  unitPriceRaw: unknown,
  totalRaw: unknown,
  unitPriceCents: number | null,
  totalCents: number | null,
): QuoteUploadWarning[] {
  const hasUnitPrice = normalizeText(unitPriceRaw) !== "";
  const hasTotal = normalizeText(totalRaw) !== "";

  if (!hasUnitPrice && !hasTotal) {
    return [{
      code: "missing_price",
      message: `Row ${rowNumber} is missing unit price and total.`,
      rowNumber,
      field: "unitPrice",
    }];
  }

  if (hasUnitPrice && unitPriceCents === null) {
    return [{
      code: "invalid_price",
      message: `Row ${rowNumber} has an invalid unit price: "${String(unitPriceRaw).trim()}".`,
      rowNumber,
      field: "unitPrice",
    }];
  }

  if (hasTotal && totalCents === null) {
    return [{
      code: "invalid_price",
      message: `Row ${rowNumber} has an invalid total: "${String(totalRaw).trim()}".`,
      rowNumber,
      field: "total",
    }];
  }

  return [];
}

function normalizeRows(rawRows: Array<{ row: RawQuoteLineItem; rowNumber: number }>) {
  const rows: QuoteUploadNormalizedRow[] = [];
  const warnings: QuoteUploadWarning[] = [];

  for (const { row, rowNumber } of rawRows) {
    const quantity = parseQuantity(aliasValue(row, FIELD_ALIASES.quantity));
    const unitPriceRaw = aliasValue(row, FIELD_ALIASES.unitPrice);
    const totalRaw = aliasValue(row, FIELD_ALIASES.total);
    const unitPriceCents = parseMoneyCents(unitPriceRaw);
    const parsedTotalCents = parseMoneyCents(totalRaw);
    const totalCents = parsedTotalCents ?? (unitPriceCents === null ? null : Math.round(unitPriceCents * quantity));

    rows.push({
      rowNumber,
      vendor: normalizeText(aliasValue(row, FIELD_ALIASES.vendor), "Unknown vendor"),
      item: normalizeText(aliasValue(row, FIELD_ALIASES.item), "Untitled item"),
      quantity,
      unitPriceCents,
      totalCents,
      currency: normalizeCurrency(aliasValue(row, FIELD_ALIASES.currency)),
    });
    warnings.push(...warningForPrice(rowNumber, unitPriceRaw, totalRaw, unitPriceCents, parsedTotalCents));
  }

  return { rows, warnings };
}

function buildTotals(rows: QuoteUploadNormalizedRow[]) {
  const pricedRows = rows.filter((row) => row.totalCents !== null);
  const currencies = new Set(pricedRows.map((row) => row.currency));

  return {
    rowCount: rows.length,
    pricedRowCount: pricedRows.length,
    subtotalCents: pricedRows.reduce((sum, row) => sum + Number(row.totalCents), 0),
    currency: currencies.size === 1 ? pricedRows[0]?.currency ?? null : null,
  };
}

function buildComparisonSummary(rows: QuoteUploadNormalizedRow[]) {
  const vendors = new Map<string, QuoteUploadComparableQuote>();

  for (const row of rows) {
    if (row.totalCents === null) continue;

    const existing = vendors.get(row.vendor);
    if (existing) {
      existing.quotedAmountCents += row.totalCents;
      existing.lineItemCount += 1;
    } else {
      vendors.set(row.vendor, {
        vendor: row.vendor,
        quotedAmountCents: row.totalCents,
        currency: row.currency,
        lineItemCount: 1,
      });
    }
  }

  return {
    vendorCount: new Set(rows.map((row) => row.vendor)).size,
    lineItemCount: rows.length,
    comparableQuotes: [...vendors.values()].sort((left, right) => left.vendor.localeCompare(right.vendor)),
  };
}

export function parseQuoteUploadText(input: QuoteUploadParseInput): QuoteUploadParseResult {
  const trimmedText = input.text.trim();
  if (!trimmedText) {
    return {
      rows: [],
      totals: { rowCount: 0, pricedRowCount: 0, subtotalCents: 0, currency: null },
      warnings: [{ code: "empty_upload", message: "Quote upload text is empty." }],
      comparisonSummary: { vendorCount: 0, lineItemCount: 0, comparableQuotes: [] },
    };
  }

  let rawRows: Array<{ row: RawQuoteLineItem; rowNumber: number }>;
  if (looksLikeJson(input, trimmedText)) {
    try {
      rawRows = parseJson(trimmedText);
    } catch {
      rawRows = [];
      const warnings: QuoteUploadWarning[] = [{ code: "invalid_json", message: "Quote upload JSON could not be parsed." }];
      return {
        rows: [],
        totals: { rowCount: 0, pricedRowCount: 0, subtotalCents: 0, currency: null },
        warnings,
        comparisonSummary: { vendorCount: 0, lineItemCount: 0, comparableQuotes: [] },
      };
    }
  } else if (looksLikeCsv(input) || trimmedText.includes(",")) {
    rawRows = parseCsv(trimmedText);
  } else {
    return {
      rows: [],
      totals: { rowCount: 0, pricedRowCount: 0, subtotalCents: 0, currency: null },
      warnings: [{ code: "unsupported_format", message: "Quote upload text must be CSV or JSON." }],
      comparisonSummary: { vendorCount: 0, lineItemCount: 0, comparableQuotes: [] },
    };
  }

  const { rows, warnings } = normalizeRows(rawRows);
  return {
    rows,
    totals: buildTotals(rows),
    warnings,
    comparisonSummary: buildComparisonSummary(rows),
  };
}
