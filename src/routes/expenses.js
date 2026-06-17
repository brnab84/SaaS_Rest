import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Expense } from '../models/Expense.js';
import { ocrInvoice } from '../services/claude.js';
import { notFound, badRequest } from '../utils/errors.js';

const router = Router();
router.use(requireAuth);

// Carga de foto de factura en memoria (máx 10MB) para OCR; no se persiste el binario acá.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const CATEGORIES = ['supplies', 'rent', 'salary', 'utilities', 'other'];

const expenseSchema = z.object({
  vendor: z.string().optional(),
  date: z.coerce.date().optional(),
  total: z.number().nonnegative(),
  currency: z.string().optional(),
  category: z.enum(CATEGORIES).optional(),
  items: z.array(z.object({
    desc: z.string().optional(),
    qty: z.number().optional(),
    amount: z.number().optional(),
  })).optional(),
  photoUrl: z.string().url().optional(),
});
const expensePatchSchema = expenseSchema.partial();

// Listar gastos del tenant (filtros por categoría y rango de fechas)
router.get('/', async (req, res, next) => {
  try {
    const filter = { tenantId: req.auth.tenantId };
    if (req.query.category) filter.category = req.query.category;
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(req.query.from);
      if (req.query.to) filter.date.$lte = new Date(req.query.to);
    }
    const expenses = await Expense.find(filter).sort({ date: -1 }).limit(500);
    res.json(expenses);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const expense = await Expense.findOne({ _id: req.params.id, tenantId: req.auth.tenantId });
    if (!expense) return next(notFound('Gasto no encontrado'));
    res.json(expense);
  } catch (e) { next(e); }
});

// Carga manual de gasto (la carga por foto/OCR vive en Fase 2: POST /api/expenses/ocr)
router.post('/', requireRole('owner', 'admin'), validate(expenseSchema), async (req, res, next) => {
  try {
    const expense = await Expense.create({
      ...req.body,
      tenantId: req.auth.tenantId,
      createdBy: req.auth.userId,
      ocrStatus: 'done', // carga manual = sin OCR pendiente
    });
    res.status(201).json(expense);
  } catch (e) { next(e); }
});

router.patch('/:id', requireRole('owner', 'admin'), validate(expensePatchSchema), async (req, res, next) => {
  try {
    const expense = await Expense.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.auth.tenantId },
      { $set: req.body },
      { new: true, runValidators: true },
    );
    if (!expense) return next(notFound('Gasto no encontrado'));
    res.json(expense);
  } catch (e) { next(e); }
});

router.delete('/:id', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const expense = await Expense.findOneAndDelete({ _id: req.params.id, tenantId: req.auth.tenantId });
    if (!expense) return next(notFound('Gasto no encontrado'));
    res.status(204).end();
  } catch (e) { next(e); }
});

// Carga por foto: OCR de factura con Claude → Expense estructurado (queda en 'review').
router.post('/ocr', requireRole('owner', 'admin'), upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return next(badRequest('Falta la foto de la factura (campo "photo")'));
    if (!req.file.mimetype?.startsWith('image/')) {
      return next(badRequest('El archivo debe ser una imagen'));
    }
    const data = await ocrInvoice({
      imageBase64: req.file.buffer.toString('base64'),
      mediaType: req.file.mimetype,
    });

    const expense = await Expense.create({
      tenantId: req.auth.tenantId,
      createdBy: req.auth.userId,
      vendor: data.vendor,
      date: data.date ? new Date(data.date) : undefined,
      total: data.total,
      currency: data.currency,
      category: data.category,
      items: data.items,
      ocrRaw: JSON.stringify(data),
      ocrStatus: 'review', // el dueño confirma antes de darlo por bueno
    });
    res.status(201).json(expense);
  } catch (e) { next(e); }
});

export default router;
