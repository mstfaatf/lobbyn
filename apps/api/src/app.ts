import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';

import authRoutes from './routes/auth/index.js';
import feedRoutes from './routes/feed/index.js';
import marketplaceRoutes from './routes/marketplace/index.js';
import ticketsRoutes from './routes/tickets/index.js';

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

  await app.register(authRoutes);
  await app.register(feedRoutes);
  await app.register(marketplaceRoutes);
  await app.register(ticketsRoutes);

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  return app;
}

/** Fastify app instance type — useful in tests after `await buildApp()`. */
export type App = Awaited<ReturnType<typeof buildApp>>;
