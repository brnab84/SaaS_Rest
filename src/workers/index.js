import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { claimNextJob } from '../jobs/queue.js';
import { processMpPayment, processWaMessage } from '../jobs/handlers.js';

// Mapeo de tipo de job → handler de procesamiento.
const HANDLERS = {
  mp_payment: (p) => processMpPayment(p),
  wa_message: (p) => processWaMessage(p),
};

let running = true;

// Procesa un job si hay alguno listo. Devuelve true si trabajó (para no dormir).
async function runOne() {
  const job = await claimNextJob();
  if (!job) return false;
  try {
    const handler = HANDLERS[job.type];
    if (!handler) throw new Error(`Tipo de job desconocido: ${job.type}`);
    await handler(job.payload);
    job.status = 'done';
    await job.save();
  } catch (e) {
    job.lastError = e.message;
    if (job.attempts >= job.maxAttempts) {
      job.status = 'failed';
      logger.error({ jobId: job.id, type: job.type, err: e.message }, 'Job agotó reintentos');
    } else {
      job.status = 'pending';
      const backoffMs = Math.min(60_000, 1000 * 2 ** job.attempts); // exponencial, tope 60s
      job.runAt = new Date(Date.now() + backoffMs);
      logger.warn({ jobId: job.id, type: job.type, attempts: job.attempts }, 'Job reintentará');
    }
    await job.save();
  }
  return true;
}

async function loop() {
  while (running) {
    let worked = false;
    try {
      worked = await runOne();
    } catch (e) {
      logger.error({ e }, 'Error en loop del worker');
    }
    if (!worked) await sleep(env.workerPollMs);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await connectDB();
  logger.info({ pollMs: env.workerPollMs }, 'Worker de jobs iniciado');
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => { running = false; });
  }
  await loop();
  await disconnectDB();
  logger.info('Worker detenido');
}

main().catch((e) => { logger.error({ e }, 'Fallo del worker'); process.exit(1); });
