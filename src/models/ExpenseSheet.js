import { Schema, model } from 'mongoose';

// Hoja (pestaña tipo Excel) para agrupar gastos generales. La hoja "General" es implícita
// (sheetId = null en Expense); estas son las hojas extra que crea el comercio.
const expenseSheetSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  order: { type: Number, default: 0 },
}, { timestamps: true });

export const ExpenseSheet = model('ExpenseSheet', expenseSheetSchema);
