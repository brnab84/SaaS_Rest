import { Schema, model } from 'mongoose';

const tenantSchema = new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true }, // URL landing
  plan: { type: String, enum: ['free', 'pro', 'business'], default: 'free' },
  settings: {
    currency: { type: String, default: 'ARS' },
    storeOpen: { type: Boolean, default: true }, // ¿la tienda acepta pedidos ahora?
    allowCancel: { type: Boolean, default: true }, // ¿el cliente puede cancelar su pedido (mientras esté "nuevo")?
    categories: { type: [String], default: undefined }, // categorías del menú (dropdown)
    // Mensajes que se envían al cliente por WhatsApp según el estado del pedido (parametrizables).
    orderMessages: {
      confirmed: String, preparing: String, ready: String, on_way: String, delivered: String,
    },
    // tokenRef = clave a un secret en env/vault. tokenEnc = secreto cifrado (AES-GCM) en DB
    // para tokens cargados por el comercio desde el panel. Nunca el token en claro.
    whatsapp: { phoneId: String, wabaId: String, tokenRef: String, tokenEnc: String },
    instagram: { igUserId: String, tokenRef: String, tokenEnc: String },
    mercadopago: {
      tokenRef: String, webhookSecretRef: String, publicKey: String,
      accessTokenEnc: String, webhookSecretEnc: String,
    },
    pedidosya: { vendorId: String, integrationActive: { type: Boolean, default: false } },
  },
  branding: {
    logo: String, cover: String, colors: { type: Map, of: String },
    description: String, theme: String, cuisine: String, // cuisine = rubro (sushi, empanadas, etc.)
    phone: String, // WhatsApp/teléfono de contacto público (para que el cliente siga su pedido)
  },
}, { timestamps: true });

export const Tenant = model('Tenant', tenantSchema);
