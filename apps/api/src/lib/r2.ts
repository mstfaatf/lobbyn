import { S3Client } from '@aws-sdk/client-s3';

const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;

if (!process.env.CLOUDFLARE_R2_ACCOUNT_ID) {
  throw new Error(
    'CLOUDFLARE_R2_ACCOUNT_ID is not set. Define it in apps/api/.env (see .env.example).',
  );
}

if (!accessKeyId) {
  throw new Error(
    'CLOUDFLARE_R2_ACCESS_KEY_ID is not set. Define it in apps/api/.env (see .env.example).',
  );
}

if (!secretAccessKey) {
  throw new Error(
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY is not set. Define it in apps/api/.env (see .env.example).',
  );
}

if (!bucketName) {
  throw new Error(
    'CLOUDFLARE_R2_BUCKET_NAME is not set. Define it in apps/api/.env (see .env.example).',
  );
}

if (!endpoint) {
  throw new Error(
    'CLOUDFLARE_R2_ENDPOINT is not set. Define it in apps/api/.env (see .env.example).',
  );
}

export const BUCKET_NAME = bucketName;

export const r2Client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  forcePathStyle: true,
});
