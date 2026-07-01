export const SOURCING_PARTNER_STATUSES = ["active", "on_hold", "risk_review"] as const;
export const QUOTE_REQUEST_STATUSES = ["draft", "sent", "received", "accepted", "declined"] as const;

export type SourcingPartnerStatus = (typeof SOURCING_PARTNER_STATUSES)[number];
export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number];

export interface SourcingPartner {
  id: string;
  organizationId: string;
  createdByUserId: string;
  name: string;
  contactName: string;
  contactEmail: string;
  phone: string;
  category: string;
  regions: string[];
  capabilityTags: string[];
  status: SourcingPartnerStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteRequestArtifact {
  id: string;
  title: string;
  fileName: string;
  artifactType: string;
  purpose: string;
  downloadUrl: string;
}

export interface QuoteRequest {
  id: string;
  organizationId: string;
  intentId: string;
  bidId: string;
  partnerId: string;
  partnerName: string;
  createdByUserId: string;
  title: string;
  description: string;
  status: QuoteRequestStatus;
  requestedDueAt: string | null;
  lineItems: string[];
  quotedAmountCents: number | null;
  currency: string;
  responseNotes: string;
  respondedAt: string | null;
  artifacts: QuoteRequestArtifact[];
  createdAt: string;
  updatedAt: string;
}

export type QuoteComparisonReviewFlagCode =
  | "single_quote"
  | "missing_amount"
  | "mixed_currency"
  | "high_variance";

export interface QuoteComparisonReviewFlag {
  code: QuoteComparisonReviewFlagCode;
  message: string;
  requestIds: string[];
}

export interface QuoteComparisonSummary {
  quotedCount: number;
  currency: string | null;
  lowAmountCents: number | null;
  medianAmountCents: number | null;
  highAmountCents: number | null;
  spreadAmountCents: number | null;
  variancePercent: number | null;
  lowestRequestId: string | null;
  highestRequestId: string | null;
  recommendedReviewFlags: QuoteComparisonReviewFlag[];
}

export type QuoteUploadWarningCode =
  | "empty_upload"
  | "invalid_json"
  | "unsupported_format"
  | "missing_price"
  | "invalid_price";

export interface QuoteUploadWarning {
  code: QuoteUploadWarningCode;
  message: string;
  rowNumber?: number;
  field?: string;
}

export interface QuoteUploadNormalizedRow {
  rowNumber: number;
  vendor: string;
  item: string;
  quantity: number;
  unitPriceCents: number | null;
  totalCents: number | null;
  currency: string;
}

export interface QuoteUploadTotals {
  rowCount: number;
  pricedRowCount: number;
  subtotalCents: number;
  currency: string | null;
}

export interface QuoteUploadComparableQuote {
  vendor: string;
  quotedAmountCents: number;
  currency: string;
  lineItemCount: number;
}

export interface QuoteUploadComparisonSummary {
  vendorCount: number;
  lineItemCount: number;
  comparableQuotes: QuoteUploadComparableQuote[];
}

export interface QuoteUploadParseInput {
  text: string;
  sourceName?: string;
  contentType?: string;
}

export interface QuoteUploadParseResult {
  rows: QuoteUploadNormalizedRow[];
  totals: QuoteUploadTotals;
  warnings: QuoteUploadWarning[];
  comparisonSummary: QuoteUploadComparisonSummary;
}

export interface QuoteWorkspace {
  intentId: string;
  bidId: string;
  organizationId: string;
  summary: {
    partners: number;
    requests: number;
    draft: number;
    sent: number;
    received: number;
    accepted: number;
    comparison: QuoteComparisonSummary;
  };
  partners: SourcingPartner[];
  requests: QuoteRequest[];
}

export interface CreateQuoteRequestInput {
  partnerId?: string;
  partnerName?: string;
  contactName?: string;
  contactEmail?: string;
  phone?: string;
  category?: string;
  regions?: string[] | string;
  capabilityTags?: string[] | string;
  title: string;
  description?: string;
  requestedDueAt?: string | null;
  lineItems?: string[] | string;
  artifactIds?: string[];
}

export interface UpdateQuoteRequestInput {
  requestId: string;
  status?: QuoteRequestStatus;
  requestedDueAt?: string | null;
  quotedAmountCents?: number | null;
  currency?: string;
  responseNotes?: string;
}

export interface QuoteWorkspaceResponse {
  workspace: QuoteWorkspace;
}

export function isSourcingPartnerStatus(value: unknown): value is SourcingPartnerStatus {
  return typeof value === "string" && SOURCING_PARTNER_STATUSES.includes(value as SourcingPartnerStatus);
}

export function isQuoteRequestStatus(value: unknown): value is QuoteRequestStatus {
  return typeof value === "string" && QUOTE_REQUEST_STATUSES.includes(value as QuoteRequestStatus);
}
