import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ExpenseSheet } from '../models/ExpenseSheet.js';
import { Expense } from '../models/Expense.js';
import { notFound } from '../utils/errors.js';

const router = Router();
router.use(requireAuth);

const sheetSchema = z.object({
  name: z.string().min(1).max(60),
  order: z.number().optional(),
});

// Listar hojas del comercio (la "General" es implícita y la arma el front).
router.get('/', async (req, res, next) => {
  try {
    const sheets = await ExpenseSheet.find({ tenantId: req.auth.tenantId }).sort({ order: 1, createdAt: 1 });
    res.json(sheets);
  } catch (e) { next(e); }
});

router.post('/', requireRole('owner', 'admin'), validate(sheetSchema), async (req, res, next) => {
  try {
    const count = await ExpenseSheet.countDocuments({ tenantId: req.auth.tenantId });
    const sheet = await ExpenseSheet.create({
      tenantId: req.auth.tenantId,
      name: req.body.name,
      order: req.body.order ?? count,
    });
    res.status(201).json(sheet);
  } catch (e) { next(e); }
});

router.patch('/:id', requireRole('owner', 'admin'), validate(sheetSchema.partial()), async (req, res, next) => {
  try {
    const sheet = await ExpenseSheet.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.auth.tenantId },
      { $set: req.body },
      { new: true, runValidators: true },
    );
    if (!sheet) return next(notFound('Hoja no encontrada'));
    res.json(sheet);
  } catch (e) { next(e); }
});

// Borrar la hoja: los gastos NO se borran, vuelven a "General" (sheetId = null).
router.delete('/:id', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const sheet = await ExpenseSheet.findOneAndDelete({ _id: req.params.id, tenantId: req.auth.tenantId });
    if (!sheet) return next(notFound('Hoja no encontrada'));
    await Expense.updateMany({ tenantId: req.auth.tenantId, sheetId: sheet._id }, { $set: { sheetId: null } });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
