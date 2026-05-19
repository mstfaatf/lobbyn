import { Worker, type Job } from 'bullmq';
import { and, eq, lt, lte } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { listings, notifications } from '../../db/schema/index.js';
import { queueRedis } from '../../redis/queue-client.js';
import {
  cleanNotificationsQueue,
  expireListingsQueue,
  type CleanNotificationsJobData,
  type ExpireListingsJobData,
} from '../queues.js';

export const expireListingsWorker = new Worker<ExpireListingsJobData>(
  'expire-listings',
  async (_job: Job<ExpireListingsJobData>) => {
    try {
      const now = new Date();

      const result = await db
        .update(listings)
        .set({ isActive: false })
        .where(
          and(
            eq(listings.isActive, true),
            lte(listings.expiresAt, now),
            eq(listings.isDeleted, false),
          ),
        )
        .returning();

      console.log(`[cron] expired ${result.length} listing(s)`);
    } catch (error) {
      console.error(`[cron] failed to expire listings: ${error}`);
      throw error;
    }
  },
  { connection: queueRedis },
);

export const cleanNotificationsWorker = new Worker<CleanNotificationsJobData>(
  'clean-notifications',
  async (_job: Job<CleanNotificationsJobData>) => {
    try {
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      const result = await db
        .delete(notifications)
        .where(
          and(
            eq(notifications.isRead, true),
            lt(notifications.createdAt, cutoff),
          ),
        )
        .returning();

      console.log(`[cron] cleaned ${result.length} old notification(s)`);
    } catch (error) {
      console.error(`[cron] failed to clean notifications: ${error}`);
      throw error;
    }
  },
  { connection: queueRedis },
);

export async function scheduleCronJobs(): Promise<void> {
  await expireListingsQueue.obliterate({ force: true }).catch(() => {});
  await cleanNotificationsQueue.obliterate({ force: true }).catch(() => {});

  await expireListingsQueue.add(
    'expire-listings-cron',
    { runAt: new Date().toISOString() },
    { repeat: { pattern: '0 * * * *' } },
  );

  await cleanNotificationsQueue.add(
    'clean-notifications-cron',
    { runAt: new Date().toISOString() },
    { repeat: { pattern: '0 3 * * *' } },
  );

  console.log(
    '[cron] scheduled expire-listings (hourly) and clean-notifications (daily 3am UTC)',
  );
}
