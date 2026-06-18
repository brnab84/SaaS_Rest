import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRoot } from '../middleware/root.js';
import { validate } from '../middleware/validate.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { Product } from '../models/Product.js';
import { Order } from '../models/Order.js';
import { PLANS, getPlan } from '../config/plans.js';
import { notFound } from '../utils/errors.js';

const router = Router();
router.use(requireAuth, requireRoot);

// Panorama de toda la plataforma: comercios, su plan/uso y un MRR estimado.
router.get('/overview', async (req, res, next) => {
  try {
    const tenants = await Tenant.find().select('name slug plan createdAt').sort({ createdAt: -1 }).lean();
    const [prodCounts, orderCounts, owners] = await Promise.all([
      Product.aggregate([{ $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
      Order.aggregate([{ $group: { _id: '$tenantId', n: { $sum: 1 }, revenue: { $sum: { $cond: [{ $eq: ['$payment.status', 'paid'] }, '$total', 0] } } } }]),
      User.find({ role: 'owner' }).select('tenantId email').lean(),
    ]);
    const pById = Object.fromEntries(prodCounts.map((x) => [String(x._id), x.n]));
    const oById = Object.fromEntries(orderCounts.map((x) => [String(x._id), x]));
    const eById = {};
    for (const u of owners) if (!eById[String(u.tenantId)]) eById[String(u.tenantId)] = u.email;

    const rows = tenants.map((t) => ({
      id: String(t._id),
      name: t.name,
      slug: t.slug,
      plan: t.plan || 'free',
      createdAt: t.createdAt,
      ownerEmail: eById[String(t._id)] || '—',
      products: pById[String(t._id)] || 0,
      orders: oById[String(t._id)]?.n || 0,
      revenue: oById[String(t._id)]?.revenue || 0,
    }));

    const byPlan = { free: 0, pro: 0, business: 0 };
    for (const r of rows) byPlan[r.plan] = (byPlan[r.plan] || 0) + 1;
    const mrr = byPlan.pro * getPlan('pro').priceMonthly + byPlan.business * getPlan('business').priceMonthly;

    res.json({ totals: { tenants: rows.length, byPlan, mrr }, plans: PLANS, tenants: rows });
  } catch (e) { next(e); }
});

// Forzar el plan de un comercio (alta/baja manual desde la administración).
const planSchema = z.object({ plan: z.enum(['free', 'pro', 'business']) });
router.patch('/tenants/:id/plan', validate(planSchema), async (req, res, next) => {
  try {
    const t = await Tenant.findByIdAndUpdate(req.params.id, { $set: { plan: req.body.plan } }, { new: true });
    if (!t) return next(notFound('Comercio no encontrado'));
    res.json({ id: String(t._id), plan: t.plan });
  } catch (e) { next(e); }
});

export default router;
