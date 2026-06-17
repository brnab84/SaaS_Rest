import { Schema, model } from 'mongoose';

const ingredientSchema = new Schema({
  name: String, qty: Number, unit: String, unitCost: Number,
}, { _id: false });

const productSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true },
  description: String,
  price: { type: Number, required: true },
  category: String,
  cost: { type: Number, default: 0 },          // costo total → margen
  ingredients: [ingredientSchema],             // costeo a nivel ingrediente
  available: { type: Boolean, default: true },
  photo: String,
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

productSchema.index({ tenantId: 1, category: 1 });

export const Product = model('Product', productSchema);
