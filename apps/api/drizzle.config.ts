import 'dotenv/config';

import { defineConfig } from 'drizzle-kit';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env and set DATABASE_URL.',
  );
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString,
  },
});
