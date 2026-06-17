import { Schema, model } from 'mongoose';

const itemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product' },
  name: String, qty: Number, unitPrice: Number, subtotal: Number,
}, { _id: false });

const orderSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  code: { type: String, required: true },
  channel: { type: String, enum: ['whatsapp', 'instagram', 'landing', 'pedidosya', 'manual'], required: true },
  customer: {
    name: String, phone: String, address: String,
    geo: { lat: Number, lng: Number },
  },
  items: [itemSchema],
  total: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  deliveryFee: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['new', 'confirmed', 'preparing', 'ready', 'on_way', 'delivered', 'cancelled'],
    default: 'new', index: true,
  },
  payment: {
    method: { type: String, enum: ['mp_link', 'cash', 'mp_checkout'], default: 'mp_link' },
    status: { type: String, enum: ['pending', 'partial', 'paid'], default: 'pending' },
    amountPaid: { type: Number, default: 0 },
    mpPreferenceId: String,
    mpPaymentId: String,
    linkUrl: String,
  },
  externalRef: { source: String, externalId: String }, // idempotencia delivery
  timeline: [{ status: String, at: { type: Date, default: Date.now }, by: String }],
}, { timestamps: true });

orderSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, 'externalRef.source': 1, 'externalRef.externalId': 1 },
  { unique: true, sparse: true });

export const Order = model('Order', orderSchema);
