import { Queue } from 'bullmq';

import { queueRedis } from '../redis/queue-client.js';

export interface SendPushNotificationJobData {
  userId: string;
  title: string;
  body: string;
  resourceType: string;
  resourceId: string;
  buildingId: string;
  orgId: string;
}

export interface WriteNotificationJobData {
  userId: string;
  buildingId: string;
  orgId: string;
  type: string;
  title: string;
  body: string;
  resourceType: string;
  resourceId: string;
}

export interface ExpireListingsJobData {
  runAt: string;
}

export interface CleanNotificationsJobData {
  runAt: string;
}

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
};

export const notificationQueue = new Queue<WriteNotificationJobData>(
  'notifications',
  {
    connection: queueRedis,
    defaultJobOptions,
  },
);

export const pushQueue = new Queue<SendPushNotificationJobData>('push', {
  connection: queueRedis,
  defaultJobOptions,
});

export const expireListingsQueue = new Queue<ExpireListingsJobData>(
  'expire-listings',
  {
    connection: queueRedis,
    defaultJobOptions,
  },
);

export const cleanNotificationsQueue = new Queue<CleanNotificationsJobData>(
  'clean-notifications',
  {
    connection: queueRedis,
    defaultJobOptions,
  },
);
