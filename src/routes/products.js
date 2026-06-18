import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Product } from '../models/Product.js';
import { notFound } from '../utils/errors.js';

const router = Router();
router.use(requireAuth);

const ingredientSchema = z.object({
  name: z.string().min(1),
  qty: z.number().nonnegative().optional(),
  unit: z.string().optional(),
  unitCost: z.number().nonnegative().optional(),
});

const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().nonnegative(),
  category: z.string().optional(),
  cost: z.number().nonnegative().optional(),
  ingredients: z.array(ingredientSchema).optional(),
  available: z.boolean().optional(),
  photo: z.string().url().optional().or(z.literal('')),
  sortOrder: z.number().int().optional(),
});
// PATCH: todos los campos opcionales
const productPatchSchema = productSchema.partial();

// Listar el menú del tenant (filtros opcionales por categoría / disponibilidad)
router.get('/', async (req, res, next) => {
  try {
    const filter = { tenantId: req.auth.tenantId };
    if (req.query.category) filter.category = req.query.category;
    if (req.query.available !== undefined) filter.available = req.query.available === 'true';
    const products = await Product.find(filter).sort({ sortOrder: 1, name: 1 });
    res.json(products);
  } catch (e) { next(e); }
});

// Detalle de un producto del tenant
router.get('/:id', async (req, res, next) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, tenantId: req.auth.tenantId });
    if (!product) return next(notFound('Producto no encontrado'));
    res.json(product);
  } catch (e) { next(e); }
});

// Crear producto (solo owner/admin)
router.post('/', requireRole('owner', 'admin'), validate(productSchema), async (req, res, next) => {
  try {
    const product = await Product.create({ ...req.body, tenantId: req.auth.tenantId });
    res.status(201).json(product);
  } catch (e) { next(e); }
});

// Actualizar producto (solo owner/admin)
router.patch('/:id', requireRole('owner', 'admin'), validate(productPatchSchema), async (req, res, next) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.auth.tenantId },
      { $set: req.body },
      { new: true, runValidators: true },
    );
    if (!product) return next(notFound('Producto no encontrado'));
    res.json(product);
  } catch (e) { next(e); }
});

// Eliminar producto (solo owner/admin)
router.delete('/:id', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const product = await Product.findOneAndDelete({ _id: req.params.id, tenantId: req.auth.tenantId });
    if (!product) return next(notFound('Producto no encontrado'));
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
