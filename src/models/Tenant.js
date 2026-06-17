import { Schema, model } from 'mongoose';

const tenantSchema = new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true }, // URL landing
  plan: { type: String, enum: ['free', 'pro', 'business'], default: 'free' },
  settings: {
    currency: { type: String, default: 'ARS' },
    // tokenRef = clave a un secret externo (Railway env / vault), nunca el token en claro
    whatsapp: { phoneId: String, wabaId: String, tokenRef: String },
    instagram: { igUserId: String, tokenRef: String },
    mercadopago: { tokenRef: String, webhookSecretRef: String, publicKey: String },
    pedidosya: { vendorId: String, integrationActive: { type: Boolean, default: false } },
  },
  branding: { logo: String, colors: { type: Map, of: String }, description: String },
}, { timestamps: true });

export const Tenant = model('Tenant', tenantSchema);
