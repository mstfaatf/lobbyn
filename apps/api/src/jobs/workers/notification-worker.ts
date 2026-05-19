import { Worker, type Job } from 'bullmq';

import { db } from '../../db/client.js';
import { notifications } from '../../db/schema/index.js';
import { queueRedis } from '../../redis/queue-client.js';
import type { WriteNotificationJobData } from '../queues.js';

export const notificationWorker = new Worker<WriteNotificationJobData>(
  'notifications',
  async (job: Job<WriteNotificationJobData>) => {
    try {
      const {
        userId,
        buildingId,
        type,
        title,
        body,
        resourceType,
        resourceId,
      } = job.data;

      const [inserted] = await db
        .insert(notifications)
        .values({
          userId,
          buildingId,
          type,
          title,
          body,
          resourceType,
          resourceId,
          isRead: false,
        })
        .returning();

      if (inserted === undefined) {
        throw new Error('insert notification returned no row');
      }

      console.log(
        `[notification-worker] wrote notification ${inserted.id} for user ${userId}`,
      );

      return inserted;
    } catch (error) {
      console.error(
        `[notification-worker] failed to write notification: ${error}`,
      );
      throw error;
    }
  },
  { connection: queueRedis },
);
