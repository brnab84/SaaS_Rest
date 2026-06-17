// Entrypoint del worker dedicado (npm run worker, o servicio separado con su propio start command).
// El servicio Railway con SERVICE_ROLE=worker corre server.js, que reutiliza startWorker().
import { connectDB, disconnectDB } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { startWorker } from './runner.js';

async function main() {
  await connectDB();
  const stop = startWorker();
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, async () => {
      stop();
      await disconnectDB();
      logger.info('Worker detenido');
      process.exit(0);
    });
  }
}

main().catch((e) => { logger.error({ e }, 'Fallo del worker'); process.exit(1); });
