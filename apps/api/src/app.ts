import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';

import { db } from './db/client.js';
import { redis } from './redis/client.js';

function createLogger() {
  if (process.env.NODE_ENV === 'production') {
    return true;
  }

  return {
    level: 'info' as const,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
      },
    },
  };
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: createLogger(),
  });

  await app.register(helmet);
  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });
  await app.register(sensible);

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  app.get('/db-ping', async (_request, reply) => {
    try {
      await db.execute(sql`SELECT 1`);
      return { ok: true, database: 'up' as const };
    } catch (err) {
      void reply.code(503);
      return {
        ok: false,
        database: 'down' as const,
        error: err instanceof Error ? err.message : 'unknown error',
      };
    }
  });

  app.get('/redis-ping', async () => {
    await redis.set('ping', 'pong');
    const result = await redis.get('ping');
    return { pong: result };
  });

  return app;
}

/** Fastify app instance type — useful in tests after `await buildApp()`. */
export type App = Awaited<ReturnType<typeof buildApp>>;
