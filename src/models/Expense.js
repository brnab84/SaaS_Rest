import { Schema, model } from 'mongoose';

const expenseSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', default: null, index: true }, // gasto de un evento (null = general)
  vendor: String,
  note: String, // cantidad/observación (ej. "0,8kg", "4 bandejas")
  date: { type: Date, default: Date.now },
  total: { type: Number, required: true },
  currency: { type: String, default: 'ARS' },
  category: { type: String, enum: ['supplies', 'rent', 'salary', 'utilities', 'other'], default: 'other' },
  items: [{ desc: String, qty: Number, amount: Number, _id: false }],
  photoUrl: String,
  ocrRaw: String,
  ocrStatus: { type: String, enum: ['pending', 'done', 'review'], default: 'pending' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

expenseSchema.index({ tenantId: 1, date: -1 });

export const Expense = model('Expense', expenseSchema);
