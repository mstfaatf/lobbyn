import IORedis from 'ioredis';

const redisUrl = process.env.UPSTASH_QUEUE_REDIS_URL;

if (!redisUrl) {
  throw new Error('Missing UPSTASH_QUEUE_REDIS_URL');
}

export const queueRedis = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: {},
});
