import { Worker, type Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { deviceTokens } from '../../db/schema/index.js';
import { sendPushNotification } from '../../lib/expo-push.js';
import { queueRedis } from '../../redis/queue-client.js';
import type { SendPushNotificationJobData } from '../queues.js';

export const pushWorker = new Worker<SendPushNotificationJobData>(
  'push',
  async (job: Job<SendPushNotificationJobData>) => {
    try {
      const { userId, title, body, resourceType, resourceId } = job.data;

      const tokens = await db
        .select()
        .from(deviceTokens)
        .where(
          and(
            eq(deviceTokens.userId, userId),
            eq(deviceTokens.isActive, true),
          ),
        );

      for (const row of tokens) {
        await sendPushNotification({
          pushToken: row.token,
          title,
          body,
          data: { resourceType, resourceId },
        });
      }

      console.log(
        `[push-worker] sent push to ${tokens.length} device(s) for user ${userId}`,
      );
    } catch (error) {
      console.error(`[push-worker] failed to send push: ${error}`);
      throw error;
    }
  },
  { connection: queueRedis },
);
