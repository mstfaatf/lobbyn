import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url) {
  throw new Error(
    'UPSTASH_REDIS_REST_URL is not set. Copy apps/api/.env.example to apps/api/.env and add your Upstash REST URL.',
  );
}

if (!token) {
  throw new Error(
    'UPSTASH_REDIS_REST_TOKEN is not set. Copy apps/api/.env.example to apps/api/.env and add your Upstash REST token.',
  );
}

export const redis = new Redis({
  url,
  token,
});
