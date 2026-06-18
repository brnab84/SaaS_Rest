import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRoot } from '../middleware/root.js';
import { validate } from '../middleware/validate.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { Product } from '../models/Product.js';
import { Order } from '../models/Order.js';
import { Expense } from '../models/Expense.js';
import { Campaign } from '../models/Campaign.js';
import { PlanConfig } from '../models/PlanConfig.js';
import { allPlans, getPlan, refreshPlans, PLAN_IDS } from '../config/plans.js';
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

    res.json({ totals: { tenants: rows.length, byPlan, mrr }, plans: allPlans(), tenants: rows });
  } catch (e) { next(e); }
});

// Detalle de un comercio: actividad y uso para el panel root.
router.get('/tenants/:id', async (req, res, next) => {
  try {
    const t = await Tenant.findById(req.params.id).lean();
    if (!t) return next(notFound('Comercio no encontrado'));
    const tid = t._id;
    const [products, ordersByStatus, paid, expenses, campaigns, owner, lastOrder] = await Promise.all([
      Product.countDocuments({ tenantId: tid }),
      Order.aggregate([{ $match: { tenantId: tid } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Order.aggregate([{ $match: { tenantId: tid, 'payment.status': 'paid' } }, { $group: { _id: null, n: { $sum: 1 }, total: { $sum: '$total' } } }]),
      Expense.aggregate([{ $match: { tenantId: tid } }, { $group: { _id: null, n: { $sum: 1 }, total: { $sum: '$total' } } }]),
      Campaign.countDocuments({ tenantId: tid }),
      User.findOne({ tenantId: tid, role: 'owner' }).select('email createdAt').lean(),
      Order.findOne({ tenantId: tid }).sort({ createdAt: -1 }).select('code total status createdAt').lean(),
    ]);
    const ordersStatus = Object.fromEntries(ordersByStatus.map((x) => [x._id, x.n]));
    const ordersTotal = ordersByStatus.reduce((a, x) => a + x.n, 0);
    res.json({
      id: String(tid),
      name: t.name,
      slug: t.slug,
      plan: t.plan || 'free',
      createdAt: t.createdAt,
      ownerEmail: owner?.email || '—',
      products,
      orders: { total: ordersTotal, byStatus: ordersStatus },
      paid: { count: paid[0]?.n || 0, revenue: paid[0]?.total || 0 },
      expenses: { count: expenses[0]?.n || 0, total: expenses[0]?.total || 0 },
      campaigns,
      lastOrder: lastOrder || null,
    });
  } catch (e) { next(e); }
});

// Config de planes (editable por el root)
router.get('/plans', (req, res) => res.json(allPlans()));

const planEditSchema = z.object({
  label: z.string().min(1).max(40).optional(),
  priceMonthly: z.number().min(0).optional(),
  limits: z.object({
    products: z.number().int().min(0).nullable().optional(),
    ordersPerMonth: z.number().int().min(0).nullable().optional(),
  }).optional(),
  features: z.object({
    ai: z.boolean().optional(),
    integrations: z.boolean().optional(),
    whitelabel: z.boolean().optional(),
  }).optional(),
  blurb: z.string().max(160).optional(),
});

router.patch('/plans/:id', validate(planEditSchema), async (req, res, next) => {
  try {
    if (!PLAN_IDS.includes(req.params.id)) return next(notFound('Plan no encontrado'));
    const b = req.body; const $set = {};
    if (b.label !== undefined) $set.label = b.label;
    if (b.priceMonthly !== undefined) $set.priceMonthly = b.priceMonthly;
    if (b.blurb !== undefined) $set.blurb = b.blurb;
    if (b.limits?.products !== undefined) $set['limits.products'] = b.limits.products;
    if (b.limits?.ordersPerMonth !== undefined) $set['limits.ordersPerMonth'] = b.limits.ordersPerMonth;
    if (b.features) for (const [k, v] of Object.entries(b.features)) if (v !== undefined) $set[`features.${k}`] = v;
    await PlanConfig.findByIdAndUpdate(req.params.id, { $set }, { upsert: true, setDefaultsOnInsert: true });
    await refreshPlans();
    res.json(allPlans()[req.params.id]);
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
