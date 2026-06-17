import { Job } from '../models/Job.js';

// Encola un trabajo para procesamiento async por el worker.
export function enqueueJob(type, payload, opts = {}) {
  return Job.create({
    type,
    payload,
    maxAttempts: opts.maxAttempts ?? 5,
    runAt: opts.runAt ?? new Date(),
  });
}

// Reclama atómicamente el próximo job listo (pending y vencido), marcándolo processing.
// El $inc + findOneAndUpdate evita que dos workers tomen el mismo job.
export function claimNextJob() {
  return Job.findOneAndUpdate(
    { status: 'pending', runAt: { $lte: new Date() } },
    { $set: { status: 'processing' }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, new: true },
  );
}
