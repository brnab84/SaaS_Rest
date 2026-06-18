import http from 'node:http';
import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { startWorker } from './workers/runner.js';
import { Order } from './models/Order.js';
import { loadPlans } from './config/plans.js';

async function main() {
  await connectDB();
  // Reconciliar índices de Order (migra el índice de idempotencia de sparse a partial).
  await Order.syncIndexes().catch((e) => logger.warn({ err: e.message }, 'syncIndexes Order'));
  // Cargar/sembrar la config de planes (editable por el root) a memoria.
  await loadPlans().catch((e) => logger.warn({ err: e.message }, 'loadPlans'));
  const role = env.serviceRole;

  // Servicio worker: corre la cola y expone solo /health (para el healthcheck de Railway).
  if (role === 'worker') {
    startWorker();
    http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      } else {
        res.writeHead(404);
        res.end();
      }
    }).listen(env.port, () => logger.info(`Worker (healthcheck) escuchando en :${env.port}`));
    return;
  }

  // Servicio api (o 'all' = api + worker embebido).
  const app = createApp();
  if (role === 'all') startWorker();
  app.listen(env.port, () => logger.info(`RestaurApp escuchando en :${env.port}`));
}

main().catch((e) => { logger.error({ e }, 'Fallo al arrancar'); process.exit(1); });
