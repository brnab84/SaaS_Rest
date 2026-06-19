import { Schema, model } from 'mongoose';

// Mensajería entre el dueño de la app (root) y un comercio (tenant).
// from = quién lo envió. read = ¿lo vio el destinatario?
const messageSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  from: { type: String, enum: ['root', 'tenant'], required: true },
  text: { type: String, required: true },
  read: { type: Boolean, default: false },
}, { timestamps: true });

messageSchema.index({ tenantId: 1, createdAt: 1 });

export const Message = model('Message', messageSchema);
