import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Define it in apps/api/.env (see .env.example).',
  );
}

const sql = neon(databaseUrl);

export const db = drizzle(sql);
