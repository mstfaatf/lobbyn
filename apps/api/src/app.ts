import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import Sentry from './lib/sentry.js';

import adminPlugin from './routes/admin/index.js';
import authRoutes from './routes/auth/index.js';
import feedRoutes from './routes/feed/index.js';
import marketplaceRoutes from './routes/marketplace/index.js';
import mediaRoutes from './routes/media/index.js';
import notificationsPlugin from './routes/notifications/index.js';
import profileRoutes from './routes/profile/index.js';
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
  await app.register(mediaRoutes);
  await app.register(notificationsPlugin, { prefix: '/v1/notifications' });
  await app.register(profileRoutes, { prefix: '/v1/profile' });
  await app.register(adminPlugin, { prefix: '/v1/admin' });

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    Sentry.captureException(error);
    const statusCode = error.statusCode ?? 500;
    void reply.status(statusCode).send({ message: error.message });
  });

  return app;
}

/** Fastify app instance type — useful in tests after `await buildApp()`. */
export type App = Awaited<ReturnType<typeof buildApp>>;
