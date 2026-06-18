import { Schema, model } from 'mongoose';

// Config editable de cada plan (la administra el root desde el panel). _id = id del plan.
// limits null = sin límite. features: qué puede hacer cada plan.
const planConfigSchema = new Schema({
  _id: { type: String }, // 'free' | 'pro' | 'business'
  label: String,
  priceMonthly: Number,
  limits: {
    products: { type: Number, default: null },
    ordersPerMonth: { type: Number, default: null },
  },
  features: {
    ai: { type: Boolean, default: true },
    integrations: { type: Boolean, default: true },
    whitelabel: { type: Boolean, default: false },
  },
  blurb: String,
}, { timestamps: true });

export const PlanConfig = model('PlanConfig', planConfigSchema);
