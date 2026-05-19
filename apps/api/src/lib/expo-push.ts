import Expo, { type ExpoPushMessage } from 'expo-server-sdk';

export const expo = new Expo({
  ...(process.env.EXPO_ACCESS_TOKEN
    ? { accessToken: process.env.EXPO_ACCESS_TOKEN }
    : {}),
});

export async function sendPushNotification({
  pushToken,
  title,
  body,
  data,
}: {
  pushToken: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<void> {
  try {
    if (!Expo.isExpoPushToken(pushToken)) {
      console.warn(`[expo-push] invalid push token: ${pushToken}`);
      return;
    }

    const message: ExpoPushMessage = {
      to: pushToken,
      title,
      body,
      sound: 'default',
      priority: 'high',
      ...(data !== undefined ? { data } : {}),
    };

    const receipts = await expo.sendPushNotificationsAsync([message]);

    for (const receipt of receipts) {
      if (receipt.status === 'error') {
        console.log(
          `[expo-push] error sending to ${pushToken}: ${receipt.message}`,
        );
      }
    }
  } catch (error) {
    console.error(`[expo-push] failed to send push notification: ${error}`);
    throw error;
  }
}
