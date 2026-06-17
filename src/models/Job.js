import { Schema, model } from 'mongoose';

// Cola de trabajos respaldada en Mongo. Los webhooks encolan; el worker procesa con reintentos.
const jobSchema = new Schema({
  type: { type: String, required: true },        // mp_payment | wa_message
  payload: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  runAt: { type: Date, default: Date.now },       // no procesar antes de esta fecha (backoff)
  lastError: String,
}, { timestamps: true });

// El worker reclama por (status, runAt); este índice cubre esa búsqueda.
jobSchema.index({ status: 1, runAt: 1 });

export const Job = model('Job', jobSchema);
