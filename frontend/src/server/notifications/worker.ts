import type { AppDatabase } from "@/server/db/client";
import {
  scheduleDunningReminders,
  type ScheduleDunningRemindersOptions,
  type ScheduleDunningRemindersResult,
} from "@/server/billing/dunning";
import {
  deliverPendingNotifications,
  type NotificationDeliveryOptions,
  type NotificationDeliveryResult,
} from "./delivery";

export interface NotificationWorkerOptions {
  now?: string;
  dunningLimit?: number;
  deliveryLimit?: number;
  maxAttempts?: number;
  scheduler?: (
    db: AppDatabase,
    options: ScheduleDunningRemindersOptions,
  ) => ScheduleDunningRemindersResult;
  deliverer?: typeof deliverPendingNotifications;
}

export interface NotificationWorkerResult {
  dunning: ScheduleDunningRemindersResult;
  delivery: NotificationDeliveryResult;
}

export async function runNotificationWorkerOnce(
  db: AppDatabase,
  options: NotificationWorkerOptions = {},
): Promise<NotificationWorkerResult> {
  const now = options.now ?? new Date().toISOString();
  const scheduler = options.scheduler ?? scheduleDunningReminders;
  const deliverer = options.deliverer ?? deliverPendingNotifications;
  const deliveryOptions: NotificationDeliveryOptions = {
    now,
    limit: options.deliveryLimit,
    maxAttempts: options.maxAttempts,
  };

  const dunning = scheduler(db, {
    now,
    limit: options.dunningLimit,
  });
  const delivery = await deliverer(db, undefined, deliveryOptions);

  return { dunning, delivery };
}
