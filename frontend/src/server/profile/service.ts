import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { readSupplierProfile, saveSupplierProfile } from "./repository";
import { getMysqlSupplierProfile, upsertMysqlSupplierProfile } from "./mysql-service";
import type { SupplierProfile, SupplierProfileInput } from "./types";

type StoredSupplierProfile = Omit<SupplierProfile, "completionScore">;

function normalizeString(value: string | undefined) {
  return typeof value === "string" ? value.trim() : undefined;
}

function normalizeStringArray(value: string[] | undefined) {
  if (!Array.isArray(value)) return undefined;

  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}

function normalizeContractValue(value: number | null | undefined) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;

  return Math.max(0, Math.trunc(value));
}

function completionScore(profile: StoredSupplierProfile) {
  const completed = [
    profile.companyName.length > 0,
    profile.businessTypes.length > 0,
    profile.categories.length > 0,
    profile.keywords.length > 0,
    profile.certifications.length > 0,
    profile.serviceStates.length > 0,
    profile.minContractValue !== null || profile.maxContractValue !== null,
    profile.riskPreferences.length > 0,
  ].filter(Boolean).length;

  return Math.round((completed / 8) * 100);
}

function withCompletion(profile: StoredSupplierProfile): SupplierProfile {
  return {
    ...profile,
    completionScore: completionScore(profile),
  };
}

function normalizeInput(input: SupplierProfileInput) {
  return {
    companyName: normalizeString(input.companyName),
    businessTypes: normalizeStringArray(input.businessTypes),
    categories: normalizeStringArray(input.categories),
    keywords: normalizeStringArray(input.keywords),
    certifications: normalizeStringArray(input.certifications),
    serviceStates: normalizeStringArray(input.serviceStates),
    minContractValue: normalizeContractValue(input.minContractValue),
    maxContractValue: normalizeContractValue(input.maxContractValue),
    riskPreferences: normalizeStringArray(input.riskPreferences),
  };
}

export async function getSupplierProfile(db: AppDatabase, userId: string): Promise<SupplierProfile> {
  if (isMysqlDatabaseUrlConfigured()) {
    return getMysqlSupplierProfile(resolveMysqlPool(), userId);
  }

  return withCompletion(await readSupplierProfile(db, userId));
}

export async function upsertSupplierProfile(
  db: AppDatabase,
  userId: string,
  input: SupplierProfileInput,
): Promise<SupplierProfile> {
  if (isMysqlDatabaseUrlConfigured()) {
    return upsertMysqlSupplierProfile(resolveMysqlPool(), userId, input);
  }

  const current = await readSupplierProfile(db, userId);
  const normalized = normalizeInput(input);
  const next: StoredSupplierProfile = {
    ...current,
    ...(normalized.companyName !== undefined ? { companyName: normalized.companyName } : {}),
    ...(normalized.businessTypes !== undefined ? { businessTypes: normalized.businessTypes } : {}),
    ...(normalized.categories !== undefined ? { categories: normalized.categories } : {}),
    ...(normalized.keywords !== undefined ? { keywords: normalized.keywords } : {}),
    ...(normalized.certifications !== undefined ? { certifications: normalized.certifications } : {}),
    ...(normalized.serviceStates !== undefined ? { serviceStates: normalized.serviceStates } : {}),
    ...(normalized.minContractValue !== undefined
      ? { minContractValue: normalized.minContractValue }
      : {}),
    ...(normalized.maxContractValue !== undefined
      ? { maxContractValue: normalized.maxContractValue }
      : {}),
    ...(normalized.riskPreferences !== undefined
      ? { riskPreferences: normalized.riskPreferences }
      : {}),
  };

  return withCompletion(await saveSupplierProfile(db, next));
}
