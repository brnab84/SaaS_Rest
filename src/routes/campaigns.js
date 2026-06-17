import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Campaign } from '../models/Campaign.js';
import { notFound } from '../utils/errors.js';

const router = Router();
router.use(requireAuth);

const campaignSchema = z.object({
  channel: z.enum(['instagram', 'whatsapp']),
  type: z.string().optional(),
  content: z.string().optional(),
  status: z.enum(['draft', 'scheduled', 'sent']).optional(),
  metrics: z.object({
    reach: z.number().optional(),
    clicks: z.number().optional(),
    ordersGenerated: z.number().optional(),
  }).optional(),
  scheduledAt: z.coerce.date().optional(),
});
const campaignPatchSchema = campaignSchema.partial();

router.get('/', async (req, res, next) => {
  try {
    const filter = { tenantId: req.auth.tenantId };
    if (req.query.channel) filter.channel = req.query.channel;
    if (req.query.status) filter.status = req.query.status;
    const campaigns = await Campaign.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json(campaigns);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.auth.tenantId });
    if (!campaign) return next(notFound('Campaña no encontrada'));
    res.json(campaign);
  } catch (e) { next(e); }
});

router.post('/', requireRole('owner', 'admin'), validate(campaignSchema), async (req, res, next) => {
  try {
    const campaign = await Campaign.create({ ...req.body, tenantId: req.auth.tenantId });
    res.status(201).json(campaign);
  } catch (e) { next(e); }
});

router.patch('/:id', requireRole('owner', 'admin'), validate(campaignPatchSchema), async (req, res, next) => {
  try {
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.auth.tenantId },
      { $set: req.body },
      { new: true, runValidators: true },
    );
    if (!campaign) return next(notFound('Campaña no encontrada'));
    res.json(campaign);
  } catch (e) { next(e); }
});

router.delete('/:id', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const campaign = await Campaign.findOneAndDelete({ _id: req.params.id, tenantId: req.auth.tenantId });
    if (!campaign) return next(notFound('Campaña no encontrada'));
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
