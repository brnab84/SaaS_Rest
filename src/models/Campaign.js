import { Schema, model } from 'mongoose';

const campaignSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  channel: { type: String, enum: ['instagram', 'whatsapp'], required: true },
  type: String,
  content: String,
  status: { type: String, enum: ['draft', 'scheduled', 'sent'], default: 'draft' },
  metrics: { reach: Number, clicks: Number, ordersGenerated: Number },
  scheduledAt: Date,
}, { timestamps: true });

export const Campaign = model('Campaign', campaignSchema);
