import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { Tenant } from '../models/Tenant.js';
import { Product } from '../models/Product.js';
import { Order } from '../models/Order.js';
import { notFound, badRequest } from '../utils/errors.js';
import { generateOrderCode } from '../utils/orderCode.js';
import { emitOrderChange } from '../services/orderEvents.js';
import { getPlan } from '../config/plans.js';

const router = Router();

// Resuelve el tenant por slug y lo deja en req.tenant (cache nada: es público y barato)
async function resolveTenant(req, _res, next) {
  try {
    const tenant = await Tenant.findOne({ slug: req.params.slug });
    if (!tenant) return next(notFound('Comercio no encontrado'));
    req.tenant = tenant;
    next();
  } catch (e) { next(e); }
}

// GET /api/public/:slug/menu — menú público + branding básico (para la landing)
router.get('/:slug/menu', resolveTenant, async (req, res, next) => {
  try {
    const products = await Product.find({ tenantId: req.tenant._id, available: true })
      .select('name description price category photo sortOrder')
      .sort({ sortOrder: 1, name: 1 });
    res.json({
      tenant: {
        name: req.tenant.name,
        slug: req.tenant.slug,
        currency: req.tenant.settings?.currency || 'ARS',
        storeOpen: req.tenant.settings?.storeOpen !== false,
        allowCancel: req.tenant.settings?.allowCancel !== false,
        whitelabel: getPlan(req.tenant.plan).features?.whitelabel === true, // ¿oculta marca RestaurApp?
        branding: req.tenant.branding || {},
      },
      products,
    });
  } catch (e) { next(e); }
});

const orderSchema = z.object({
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().min(5),
    address: z.string().optional(),
    geo: z.object({ lat: z.number(), lng: z.number() }).optional(),
  }),
  items: z.array(z.object({
    productId: z.string().min(1),
    qty: z.number().int().positive(),
  })).min(1, 'El pedido necesita al menos un ítem'),
  notes: z.string().max(500).optional(),
});

// POST /api/public/:slug/orders — crea un pedido desde la landing.
// El total SIEMPRE se recalcula en el server desde los precios reales (nunca confiar en el cliente).
router.post('/:slug/orders', resolveTenant, validate(orderSchema), async (req, res, next) => {
  try {
    if (req.tenant.settings?.storeOpen === false) {
      return next(badRequest('La tienda está cerrada en este momento. Volvé a intentar más tarde.'));
    }
    const { customer, items: requested } = req.body;
    const ids = [...new Set(requested.map((i) => i.productId))];
    const products = await Product.find({
      _id: { $in: ids }, tenantId: req.tenant._id, available: true,
    });
    const byId = new Map(products.map((p) => [p._id.toString(), p]));

    const items = [];
    let total = 0;
    for (const line of requested) {
      const product = byId.get(line.productId);
      if (!product) return next(badRequest(`Producto no disponible: ${line.productId}`));
      const subtotal = product.price * line.qty;
      total += subtotal;
      items.push({
        productId: product._id,
        name: product.name,
        qty: line.qty,
        unitPrice: product.price,
        subtotal,
      });
    }

    const order = await Order.create({
      tenantId: req.tenant._id,
      code: generateOrderCode(),
      channel: 'landing',
      customer,
      items,
      total,
      status: 'new',
      payment: { method: 'mp_link', status: 'pending' },
      timeline: [{ status: 'new', by: 'landing' }],
    });

    emitOrderChange(req.tenant._id); // avisa al panel en vivo (SSE)
    // Respuesta acotada: el cliente público no necesita ver el documento completo.
    res.status(201).json({ id: order._id, code: order.code, total: order.total, status: order.status });
  } catch (e) { next(e); }
});

// GET /api/public/:slug/orders/:id — estado del pedido para el seguimiento del cliente.
// El id del pedido actúa como token (solo lo tiene quien hizo el pedido). Datos acotados.
router.get('/:slug/orders/:id', resolveTenant, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return next(notFound('Pedido no encontrado'));
    const order = await Order.findOne({ _id: req.params.id, tenantId: req.tenant._id })
      .select('code status total items timeline createdAt');
    if (!order) return next(notFound('Pedido no encontrado'));
    res.json({
      id: order._id,
      code: order.code,
      status: order.status,
      total: order.total,
      items: (order.items || []).map((i) => ({ name: i.name, qty: i.qty })),
      timeline: (order.timeline || []).map((t) => ({ status: t.status, at: t.at })),
      createdAt: order.createdAt,
    });
  } catch (e) { next(e); }
});

// POST /api/public/:slug/orders/:id/cancel — el cliente cancela su pedido.
// Solo permitido mientras siga "nuevo" (sin confirmar por el comercio). El id actúa de token.
router.post('/:slug/orders/:id/cancel', resolveTenant, async (req, res, next) => {
  try {
    if (req.tenant.settings?.allowCancel === false) return next(badRequest('Este comercio no permite cancelar pedidos online. Contactalo para cancelar.'));
    if (!mongoose.isValidObjectId(req.params.id)) return next(notFound('Pedido no encontrado'));
    const order = await Order.findOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!order) return next(notFound('Pedido no encontrado'));
    if (order.status === 'cancelled') return res.json({ id: order._id, status: 'cancelled' });
    if (order.status !== 'new') return next(badRequest('El pedido ya está en preparación; contactá al comercio para cancelarlo.'));
    order.status = 'cancelled';
    order.timeline.push({ status: 'cancelled', by: 'landing' });
    await order.save();
    emitOrderChange(req.tenant._id); // avisa al panel en vivo (SSE)
    res.json({ id: order._id, status: 'cancelled' });
  } catch (e) { next(e); }
});

export default router;
