export const ISSUER_TYPES = [
  "federal",
  "state",
  "county",
  "city",
  "township",
  "special_district",
] as const;

export type IssuerType = (typeof ISSUER_TYPES)[number];
export type IssuerTypeFilter = "all" | IssuerType;
export const ISSUER_TYPE_FILTERS = ["all", ...ISSUER_TYPES] as const;

export function isIssuerTypeFilter(value: unknown): value is IssuerTypeFilter {
  return typeof value === "string" && ISSUER_TYPE_FILTERS.some((issuerType) => issuerType === value);
}

export function issuerTypeLabelKey(issuerType: IssuerType) {
  return `dashboard.${issuerType}` as const;
}
