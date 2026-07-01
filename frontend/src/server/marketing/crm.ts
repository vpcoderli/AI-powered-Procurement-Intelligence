import type { AppDatabase } from "@/server/db/client";
import {
  deliverPendingEventOutboxRows,
  type EventOutboxDeliveryOptions,
  type EventOutboxDeliveryResult,
  type EventOutboxRow,
} from "@/server/events/event-log";

export const marketingCrmDestination = "crm.marketing_leads";

export type MarketingCrmSyncResult = { ok: true } | { ok: false; error: string };
export type MarketingCrmSyncAdapter = (
  row: EventOutboxRow,
) => MarketingCrmSyncResult | Promise<MarketingCrmSyncResult>;

export interface DeliverPendingMarketingCrmLeadHandoffsOptions
  extends Omit<EventOutboxDeliveryOptions, "destinations"> {
  adapter?: MarketingCrmSyncAdapter;
}

async function defaultLocalMarketingCrmSyncAdapter(): Promise<MarketingCrmSyncResult> {
  return { ok: true };
}

export async function deliverPendingMarketingCrmLeadHandoffs(
  db: AppDatabase,
  options: DeliverPendingMarketingCrmLeadHandoffsOptions = {},
): Promise<EventOutboxDeliveryResult> {
  const { adapter = defaultLocalMarketingCrmSyncAdapter, ...deliveryOptions } = options;

  return deliverPendingEventOutboxRows(
    db,
    async (row) => adapter(row),
    {
      ...deliveryOptions,
      destinations: [marketingCrmDestination],
    },
  );
}
