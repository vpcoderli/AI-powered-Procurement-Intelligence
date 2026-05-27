import { eq } from "drizzle-orm";
import { ensureUser } from "@/server/bids/repository";
import type { AppDatabase } from "@/server/db/client";
import { supplierProfiles } from "@/server/db/schema";
import type { SupplierProfile } from "./types";

type SupplierProfileRecord = Omit<SupplierProfile, "completionScore">;

function nowIso() {
  return new Date().toISOString();
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);

    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    return [];
  }

  return [];
}

function emptyProfile(userId: string): SupplierProfileRecord {
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

function toSupplierProfileRecord(row: typeof supplierProfiles.$inferSelect): SupplierProfileRecord {
  return {
    userId: row.userId,
    companyName: row.companyName,
    businessTypes: parseStringArray(row.businessTypes),
    categories: parseStringArray(row.categories),
    keywords: parseStringArray(row.keywords),
    certifications: parseStringArray(row.certifications),
    serviceStates: parseStringArray(row.serviceStates),
    minContractValue: row.minContractValue,
    maxContractValue: row.maxContractValue,
    riskPreferences: parseStringArray(row.riskPreferences),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function readSupplierProfile(db: AppDatabase, userId: string): Promise<SupplierProfileRecord> {
  await ensureUser(db, userId);

  const row = db
    .select()
    .from(supplierProfiles)
    .where(eq(supplierProfiles.userId, userId))
    .limit(1)
    .get();

  return row ? toSupplierProfileRecord(row) : emptyProfile(userId);
}

export async function saveSupplierProfile(
  db: AppDatabase,
  profile: SupplierProfileRecord,
): Promise<SupplierProfileRecord> {
  await ensureUser(db, profile.userId);

  const existing = db
    .select({ createdAt: supplierProfiles.createdAt })
    .from(supplierProfiles)
    .where(eq(supplierProfiles.userId, profile.userId))
    .limit(1)
    .get();
  const timestamp = nowIso();
  const createdAt = existing?.createdAt ?? timestamp;

  db.insert(supplierProfiles)
    .values({
      userId: profile.userId,
      companyName: profile.companyName,
      businessTypes: JSON.stringify(profile.businessTypes),
      categories: JSON.stringify(profile.categories),
      keywords: JSON.stringify(profile.keywords),
      certifications: JSON.stringify(profile.certifications),
      serviceStates: JSON.stringify(profile.serviceStates),
      minContractValue: profile.minContractValue,
      maxContractValue: profile.maxContractValue,
      riskPreferences: JSON.stringify(profile.riskPreferences),
      createdAt,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: supplierProfiles.userId,
      set: {
        companyName: profile.companyName,
        businessTypes: JSON.stringify(profile.businessTypes),
        categories: JSON.stringify(profile.categories),
        keywords: JSON.stringify(profile.keywords),
        certifications: JSON.stringify(profile.certifications),
        serviceStates: JSON.stringify(profile.serviceStates),
        minContractValue: profile.minContractValue,
        maxContractValue: profile.maxContractValue,
        riskPreferences: JSON.stringify(profile.riskPreferences),
        updatedAt: timestamp,
      },
    })
    .run();

  return readSupplierProfile(db, profile.userId);
}
