// No imports on purpose: the client-side LedgeredApprovalPanel imports this module.

/**
 * The display families `data-sources-repository.ts`'s `defaultProviderFamily` gives a row whose
 * `provider_family` column is NULL (a portal of its own, not a shared platform). They are not platforms:
 * a platform review for one of them would make every own-site local source batch-approvable under a ToS
 * that is not theirs, so such rows are approved one by one through the single-source form.
 */
export const SYNTHETIC_PROVIDER_FAMILIES = ["public_portal", "state_portal", "federal_portal"] as const;

export function isSyntheticProviderFamily(family: string | null | undefined): boolean {
  return typeof family === "string" && (SYNTHETIC_PROVIDER_FAMILIES as readonly string[]).includes(family);
}
