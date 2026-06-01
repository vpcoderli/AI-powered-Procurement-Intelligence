import type { Pool } from "mysql2/promise";
import { ensureUserFromMysql } from "@/server/bids/repository";
import { mysqlExecute, mysqlSelectOne, normalizeMysqlNumber } from "@/server/db/mysql-runtime";
import type { SupplierProfile, SupplierProfileInput } from "./types";

type StoredSupplierProfile = Omit<SupplierProfile, "completionScore">;

interface MysqlSupplierProfileRow {
  userId: string;
  companyName: string;
  businessTypes: string;
  categories: string;
  keywords: string;
  certifications: string;
  serviceStates: string;
  minContractValue: number | string | null;
  maxContractValue: number | string | null;
  riskPreferences: string;
  createdAt: string;
  updatedAt: string;
}

function nowIso() {
  return new Date().toISOString();
}

function parseStringArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function emptyProfile(userId: string): StoredSupplierProfile {
  return {
    userId,
    companyName: "",
    businessTypes: [],
    categories: [],
    keywords: [],
    certifications: [],
    serviceStates: [],
    minContractValue: null,
    maxContractValue: null,
    riskPreferences: [],
    createdAt: null,
    updatedAt: null,
  };
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
  return { ...profile, completionScore: completionScore(profile) };
}

function toProfile(row: MysqlSupplierProfileRow): StoredSupplierProfile {
  return {
    userId: row.userId,
    companyName: row.companyName,
    businessTypes: parseStringArray(row.businessTypes),
    categories: parseStringArray(row.categories),
    keywords: parseStringArray(row.keywords),
    certifications: parseStringArray(row.certifications),
    serviceStates: parseStringArray(row.serviceStates),
    minContractValue: normalizeMysqlNumber(row.minContractValue),
    maxContractValue: normalizeMysqlNumber(row.maxContractValue),
    riskPreferences: parseStringArray(row.riskPreferences),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeString(value: string | undefined) {
  return typeof value === "string" ? value.trim() : undefined;
}

function normalizeStringArray(value: string[] | undefined) {
  return Array.isArray(value) ? value.map((item) => item.trim()).filter(Boolean) : undefined;
}

function normalizeContractValue(value: number | null | undefined) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.trunc(value));
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

async function readStoredMysqlSupplierProfile(pool: Pool, userId: string): Promise<StoredSupplierProfile> {
  await ensureUserFromMysql(pool, userId);
  const row = await mysqlSelectOne<MysqlSupplierProfileRow>(
    pool,
    `
      SELECT
        user_id AS userId,
        company_name AS companyName,
        business_types AS businessTypes,
        categories,
        keywords,
        certifications,
        service_states AS serviceStates,
        min_contract_value AS minContractValue,
        max_contract_value AS maxContractValue,
        risk_preferences AS riskPreferences,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM supplier_profiles
      WHERE user_id = ?
      LIMIT 1
    `,
    [userId],
  );

  return row ? toProfile(row) : emptyProfile(userId);
}

export async function getMysqlSupplierProfile(pool: Pool, userId: string): Promise<SupplierProfile> {
  return withCompletion(await readStoredMysqlSupplierProfile(pool, userId));
}

export async function upsertMysqlSupplierProfile(
  pool: Pool,
  userId: string,
  input: SupplierProfileInput,
): Promise<SupplierProfile> {
  const current = await readStoredMysqlSupplierProfile(pool, userId);
  const normalized = normalizeInput(input);
  const next: StoredSupplierProfile = {
    ...current,
    ...(normalized.companyName !== undefined ? { companyName: normalized.companyName } : {}),
    ...(normalized.businessTypes !== undefined ? { businessTypes: normalized.businessTypes } : {}),
    ...(normalized.categories !== undefined ? { categories: normalized.categories } : {}),
    ...(normalized.keywords !== undefined ? { keywords: normalized.keywords } : {}),
    ...(normalized.certifications !== undefined ? { certifications: normalized.certifications } : {}),
    ...(normalized.serviceStates !== undefined ? { serviceStates: normalized.serviceStates } : {}),
    ...(normalized.minContractValue !== undefined ? { minContractValue: normalized.minContractValue } : {}),
    ...(normalized.maxContractValue !== undefined ? { maxContractValue: normalized.maxContractValue } : {}),
    ...(normalized.riskPreferences !== undefined ? { riskPreferences: normalized.riskPreferences } : {}),
  };
  const timestamp = nowIso();
  const createdAt = current.createdAt ?? timestamp;

  await mysqlExecute(
    pool,
    `
      INSERT INTO supplier_profiles (
        user_id,
        company_name,
        business_types,
        categories,
        keywords,
        certifications,
        service_states,
        min_contract_value,
        max_contract_value,
        risk_preferences,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        company_name = VALUES(company_name),
        business_types = VALUES(business_types),
        categories = VALUES(categories),
        keywords = VALUES(keywords),
        certifications = VALUES(certifications),
        service_states = VALUES(service_states),
        min_contract_value = VALUES(min_contract_value),
        max_contract_value = VALUES(max_contract_value),
        risk_preferences = VALUES(risk_preferences),
        updated_at = VALUES(updated_at)
    `,
    [
      userId,
      next.companyName,
      JSON.stringify(next.businessTypes),
      JSON.stringify(next.categories),
      JSON.stringify(next.keywords),
      JSON.stringify(next.certifications),
      JSON.stringify(next.serviceStates),
      next.minContractValue,
      next.maxContractValue,
      JSON.stringify(next.riskPreferences),
      createdAt,
      timestamp,
    ],
  );

  return getMysqlSupplierProfile(pool, userId);
}
