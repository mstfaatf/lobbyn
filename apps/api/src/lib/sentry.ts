import * as Sentry from '@sentry/node';

if (!process.env.SENTRY_DSN) {
  throw new Error('SENTRY_DSN environment variable is required');
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 1.0,
});

export default Sentry;
