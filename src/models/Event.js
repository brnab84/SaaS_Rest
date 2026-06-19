import { Schema, model } from 'mongoose';

// Evento de catering: agrupa gastos (Expense con eventId) y guarda lo cobrado para ver el margen.
const eventSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true },
  date: { type: Date, default: Date.now },
  pax: { type: Number, default: null },
  description: String,
  revenue: { type: Number, default: 0 }, // monto cobrado al cliente
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

eventSchema.index({ tenantId: 1, date: -1 });

export const Event = model('Event', eventSchema);
