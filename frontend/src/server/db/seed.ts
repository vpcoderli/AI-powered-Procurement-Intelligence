import { eq } from "drizzle-orm";
import { STATE_CRAWLER_SOURCES } from "@/lib/state-crawler-sources";
import { MOCK_BIDS } from "../../lib/mock-data";
import type { AppDatabase } from "./client";
import { bidAttachments, bids, dataSources, supplierProfiles, users } from "./schema";

const SEED_TIMESTAMP = "2026-05-19T00:00:00.000Z";

function parseAmount(value: string) {
  const matches = [...value.matchAll(/\$?(\d+(?:\.\d+)?)\s*([MK])?/gi)];
  const amounts = matches.map((match) => {
    const number = Number(match[1]);
    const suffix = match[2]?.toUpperCase();
    if (suffix === "M") return Math.round(number * 1_000_000);
    if (suffix === "K") return Math.round(number * 1_000);
    return Math.round(number);
  });

  return {
    amountMin: amounts[0] ?? null,
    amountMax: amounts[1] ?? amounts[0] ?? null,
  };
}

function seededAttachmentId(bidId: string, index: number) {
  return `seed:${bidId}:attachment:${index + 1}`;
}

export async function seedDatabase(db: AppDatabase) {
  db.insert(users)
    .values({
      id: "anon_seed",
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    })
    .onConflictDoNothing()
    .run();

  db.insert(supplierProfiles)
    .values({
      userId: "anon_seed",
      companyName: "Demo Supply Co.",
      businessTypes: JSON.stringify(["distributor", "service provider"]),
      categories: JSON.stringify(["cloud", "cybersecurity", "logistics", "medical supplies"]),
      keywords: JSON.stringify(["cloud", "security", "logistics", "analytics", "emergency"]),
      certifications: JSON.stringify(["SBE"]),
      serviceStates: JSON.stringify(["US", "CA", "TX", "NY", "FL", "IL"]),
      minContractValue: 25_000,
      maxContractValue: 5_000_000,
      riskPreferences: JSON.stringify(["avoid missing attachments", "watch short deadlines"]),
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    })
    .onConflictDoNothing()
    .run();

  const sourceRows = new Map<string, typeof dataSources.$inferInsert>(
    MOCK_BIDS.filter((bid) => bid.issuerType !== "state").map((bid) => [
      bid.source,
      {
        id: bid.source
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, ""),
        label: bid.source,
        issuerType: bid.issuerType,
        stateCode: bid.stateCode,
        baseUrl: bid.sourceUrl,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
      },
    ]),
  );

  for (const source of STATE_CRAWLER_SOURCES) {
    sourceRows.set(source.id, {
      id: source.id,
      label: source.label,
      issuerType: "state",
      stateCode: source.stateCode,
      baseUrl: source.baseUrl,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    });
  }

  for (const source of sourceRows.values()) {
    db.insert(dataSources)
      .values(source)
      .onConflictDoUpdate({
        target: dataSources.id,
        set: {
          label: source.label,
          issuerType: source.issuerType,
          stateCode: source.stateCode,
          baseUrl: source.baseUrl,
          updatedAt: SEED_TIMESTAMP,
        },
      })
      .run();
  }

  for (const bid of MOCK_BIDS) {
    const amount = parseAmount(bid.amount);
    db.insert(bids)
      .values({
        id: bid.id,
        source: bid.source,
        sourceBidId: `mock:${bid.id}`,
        dedupeKey: `mock:${bid.id}`,
        title: bid.title,
        description: bid.description,
        fullDescription: bid.fullDescription,
        originalCategory: bid.originalCategory,
        amount: bid.amount,
        amountMin: amount.amountMin,
        amountMax: amount.amountMax,
        currency: "USD",
        publishedDate: bid.publishedDate,
        deadlineDate: bid.deadlineDate,
        issuerName: bid.issuerName,
        issuerType: bid.issuerType,
        stateCode: bid.stateCode,
        contactName: bid.contactName,
        contactEmail: bid.contactEmail,
        contactPhone: bid.contactPhone,
        sourceUrl: bid.sourceUrl,
        isActive: bid.isActive ? 1 : 0,
        rawPayload: JSON.stringify(bid),
        firstSeenAt: SEED_TIMESTAMP,
        lastSeenAt: SEED_TIMESTAMP,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
      })
      .onConflictDoUpdate({
        target: bids.id,
        set: {
          source: bid.source,
          sourceBidId: `mock:${bid.id}`,
          dedupeKey: `mock:${bid.id}`,
          title: bid.title,
          description: bid.description,
          fullDescription: bid.fullDescription,
          originalCategory: bid.originalCategory,
          amount: bid.amount,
          amountMin: amount.amountMin,
          amountMax: amount.amountMax,
          currency: "USD",
          publishedDate: bid.publishedDate,
          deadlineDate: bid.deadlineDate,
          issuerName: bid.issuerName,
          issuerType: bid.issuerType,
          stateCode: bid.stateCode,
          contactName: bid.contactName,
          contactEmail: bid.contactEmail,
          contactPhone: bid.contactPhone,
          sourceUrl: bid.sourceUrl,
          isActive: bid.isActive ? 1 : 0,
          rawPayload: JSON.stringify(bid),
          lastSeenAt: SEED_TIMESTAMP,
          updatedAt: SEED_TIMESTAMP,
        },
      })
      .run();

    db.delete(bidAttachments).where(eq(bidAttachments.bidId, bid.id)).run();
    bid.attachments.forEach((attachment, index) => {
      db.insert(bidAttachments)
        .values({
          id: seededAttachmentId(bid.id, index),
          bidId: bid.id,
          name: attachment.name,
          url: attachment.url,
          sizeLabel: attachment.size,
          sortOrder: index,
          createdAt: SEED_TIMESTAMP,
        })
        .run();
    });
  }
}
