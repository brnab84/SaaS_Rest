import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

async function main() {
  await connectDB();
  const app = createApp();
  app.listen(env.port, () => logger.info(`RestaurApp escuchando en :${env.port}`));
}

main().catch((e) => { logger.error({ e }, 'Fallo al arrancar'); process.exit(1); });
