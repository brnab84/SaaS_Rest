import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Product } from '../models/Product.js';
import { Tenant } from '../models/Tenant.js';
import { extractMenu, extractProductFromPhoto } from '../services/claude.js';
import { notFound, badRequest } from '../utils/errors.js';

const router = Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Importar menú con IA: subí un PDF/imagen (campo "file") o pegá el texto (campo "text").
router.post('/import', requireRole('owner', 'admin'), upload.single('file'), async (req, res, next) => {
  try {
    let data;
    if (req.file) {
      const isPdf = req.file.mimetype === 'application/pdf';
      if (!isPdf && !req.file.mimetype?.startsWith('image/')) return next(badRequest('El archivo debe ser un PDF o una imagen'));
      data = await extractMenu({ fileBase64: req.file.buffer.toString('base64'), mediaType: req.file.mimetype, isPdf });
    } else if (req.body?.text) {
      data = await extractMenu({ text: String(req.body.text).slice(0, 20000) });
    } else {
      return next(badRequest('Subí un PDF/imagen o pegá el texto del menú'));
    }
    const docs = (data.products || [])
      .filter((p) => p.name && typeof p.price === 'number')
      .map((p) => ({ tenantId: req.auth.tenantId, name: p.name, description: p.description, price: p.price, category: p.category, available: true }));
    if (!docs.length) return res.json({ imported: 0 });
    const created = await Product.insertMany(docs);
    res.status(201).json({ imported: created.length });
  } catch (e) { next(e); }
});

// Crear artículo desde una foto del plato: la IA detecta nombre, descripción y categoría.
router.post('/from-photo', requireRole('owner', 'admin'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file || !req.file.mimetype?.startsWith('image/')) return next(badRequest('Subí una imagen del plato'));
    const tenant = await Tenant.findById(req.auth.tenantId).select('settings.categories');
    const categories = tenant?.settings?.categories || [];
    const data = await extractProductFromPhoto({ imageBase64: req.file.buffer.toString('base64'), mediaType: req.file.mimetype, categories });
    res.json({ name: data.name || '', description: data.description || '', category: data.category || '' });
  } catch (e) { next(e); }
});

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
