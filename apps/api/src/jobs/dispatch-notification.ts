import {
  notificationQueue,
  pushQueue,
  type SendPushNotificationJobData,
  type WriteNotificationJobData,
} from './queues.js';

export async function dispatchNotification({
  userId,
  buildingId,
  orgId,
  type,
  title,
  body,
  resourceType,
  resourceId,
}: {
  userId: string;
  buildingId: string;
  orgId: string;
  type: string;
  title: string;
  body: string;
  resourceType: string;
  resourceId: string;
}): Promise<void> {
  try {
    const writePayload: WriteNotificationJobData = {
      userId,
      buildingId,
      orgId,
      type,
      title,
      body,
      resourceType,
      resourceId,
    };

    const pushPayload: SendPushNotificationJobData = {
      userId,
      title,
      body,
      resourceType,
      resourceId,
      buildingId,
      orgId,
    };

    await notificationQueue.add('write-notification', writePayload);
    await pushQueue.add('send-push', pushPayload);

    console.log(
      `[dispatch] queued notification + push for user ${userId} type ${type}`,
    );
  } catch (error) {
    console.error(`[dispatch] failed to queue notification + push: ${error}`);
    throw error;
  }
}
