import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Tenant } from '../models/Tenant.js';
import { notFound } from '../utils/errors.js';

const router = Router();
router.use(requireAuth);

const SELECT = 'name slug plan settings.currency branding';

// Datos del comercio del usuario logueado.
router.get('/', async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.auth.tenantId).select(SELECT);
    if (!tenant) return next(notFound('Comercio no encontrado'));
    res.json(tenant);
  } catch (e) { next(e); }
});

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  settings: z.object({ currency: z.string().min(2).max(8).optional() }).optional(),
  branding: z.object({
    description: z.string().max(300).optional(),
    logo: z.string().url().optional().or(z.literal('')),
    colors: z.object({ accent: z.string().max(32).optional() }).optional(),
  }).optional(),
});

// Editar comercio (branding/landing). Solo owner/admin. Merge parcial con dot-paths.
router.patch('/', requireRole('owner', 'admin'), validate(patchSchema), async (req, res, next) => {
  try {
    const b = req.body;
    const $set = {};
    if (b.name !== undefined) $set.name = b.name;
    if (b.settings?.currency !== undefined) $set['settings.currency'] = b.settings.currency;
    if (b.branding?.description !== undefined) $set['branding.description'] = b.branding.description;
    if (b.branding?.logo !== undefined) $set['branding.logo'] = b.branding.logo;
    if (b.branding?.colors?.accent !== undefined) $set['branding.colors.accent'] = b.branding.colors.accent;

    const tenant = await Tenant.findByIdAndUpdate(
      req.auth.tenantId, { $set }, { new: true, runValidators: true },
    ).select(SELECT);
    if (!tenant) return next(notFound('Comercio no encontrado'));
    res.json(tenant);
  } catch (e) { next(e); }
});

export default router;
