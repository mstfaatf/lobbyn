import 'dotenv/config';

import './db/client.js';
import './redis/client.js';
import './lib/r2.js';

import { buildApp } from './app.js';

async function main(): Promise<void> {
  const app = await buildApp();

  const rawPort = process.env.PORT;
  const parsed = rawPort !== undefined ? Number.parseInt(rawPort, 10) : NaN;
  const port = Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;

  await app.listen({ port, host: '0.0.0.0' });

  app.log.info(`Server running on port ${port}`);

  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'shutdown initiated');
    await app.close();
    process.exit(0);
  };

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
