import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { Order } from '../models/Order.js';
import { Expense } from '../models/Expense.js';
import { Tenant } from '../models/Tenant.js';
import { forecastSales } from '../services/claude.js';

const router = Router();
router.use(requireAuth);

// Rango por defecto: últimos 30 días
function range(req) {
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from
    ? new Date(req.query.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

function tenantOid(req) {
  return new mongoose.Types.ObjectId(req.auth.tenantId);
}

// GET /api/dashboard/summary — KPIs del período (ventas pagadas, gastos, ganancia bruta)
router.get('/summary', async (req, res, next) => {
  try {
    const { from, to } = range(req);
    const tenantId = tenantOid(req);

    const [salesAgg] = await Order.aggregate([
      { $match: { tenantId, 'payment.status': 'paid', createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
    ]);
    const [expenseAgg] = await Expense.aggregate([
      { $match: { tenantId, date: { $gte: from, $lte: to } } },
      { $group: { _id: null, expenses: { $sum: '$total' } } },
    ]);

    const revenue = salesAgg?.revenue || 0;
    const orders = salesAgg?.orders || 0;
    const expenses = expenseAgg?.expenses || 0;

    res.json({
      range: { from, to },
      revenue,
      orders,
      avgTicket: orders ? Math.round((revenue / orders) * 100) / 100 : 0,
      expenses,
      grossProfit: revenue - expenses,
    });
  } catch (e) { next(e); }
});

// GET /api/dashboard/sales — serie diaria de ventas pagadas (para gráfico de línea)
router.get('/sales', async (req, res, next) => {
  try {
    const { from, to } = range(req);
    const series = await Order.aggregate([
      { $match: { tenantId: tenantOid(req), 'payment.status': 'paid', createdAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', revenue: 1, orders: 1 } },
    ]);
    res.json(series);
  } catch (e) { next(e); }
});

// GET /api/dashboard/expenses — gastos agrupados por categoría (para gráfico de torta)
router.get('/expenses', async (req, res, next) => {
  try {
    const { from, to } = range(req);
    const byCategory = await Expense.aggregate([
      { $match: { tenantId: tenantOid(req), date: { $gte: from, $lte: to } } },
      { $group: { _id: '$category', total: { $sum: '$total' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $project: { _id: 0, category: '$_id', total: 1, count: 1 } },
    ]);
    res.json(byCategory);
  } catch (e) { next(e); }
});

// GET /api/dashboard/products — productos más vendidos en pedidos pagados
router.get('/products', async (req, res, next) => {
  try {
    const { from, to } = range(req);
    const top = await Order.aggregate([
      { $match: { tenantId: tenantOid(req), 'payment.status': 'paid', createdAt: { $gte: from, $lte: to } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productId',
          name: { $first: '$items.name' },
          qty: { $sum: '$items.qty' },
          revenue: { $sum: '$items.subtotal' },
        },
      },
      { $sort: { qty: -1 } },
      { $limit: 20 },
      { $project: { _id: 0, productId: '$_id', name: 1, qty: 1, revenue: 1 } },
    ]);
    res.json(top);
  } catch (e) { next(e); }
});

// GET /api/dashboard/forecast?days=7 — proyección de ventas con Claude sobre el histórico
router.get('/forecast', async (req, res, next) => {
  try {
    const tenantId = tenantOid(req);
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 días de histórico

    const history = await Order.aggregate([
      { $match: { tenantId, 'payment.status': 'paid', createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', revenue: 1, orders: 1 } },
    ]);

    if (history.length < 7) {
      return res.json({ forecast: [], summary: 'Histórico insuficiente para proyectar (se necesitan al menos 7 días con ventas).', confidence: 'low' });
    }

    const tenant = await Tenant.findById(req.auth.tenantId).select('settings.currency');
    const result = await forecastSales({ history, days, currency: tenant?.settings?.currency || 'ARS' });
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
