import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireFeature } from '../middleware/feature.js';
import { validate } from '../middleware/validate.js';
import { Event } from '../models/Event.js';
import { Expense } from '../models/Expense.js';
import { extractExpenseList } from '../services/claude.js';
import { notFound, badRequest } from '../utils/errors.js';

const router = Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const oid = (id) => new mongoose.Types.ObjectId(id);

// Lista de eventos con lo gastado, cantidad de ítems y margen (cobrado - gastado).
router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.auth.tenantId;
    const events = await Event.find({ tenantId }).sort({ date: -1 }).limit(200).lean();
    const agg = await Expense.aggregate([
      { $match: { tenantId: oid(tenantId), eventId: { $ne: null } } },
      { $group: { _id: '$eventId', spent: { $sum: '$total' }, items: { $sum: 1 } } },
    ]);
    const byId = Object.fromEntries(agg.map((x) => [String(x._id), x]));
    res.json(events.map((e) => {
      const s = byId[String(e._id)] || { spent: 0, items: 0 };
      return { ...e, id: String(e._id), spent: s.spent, items: s.items, margin: (e.revenue || 0) - s.spent };
    }));
  } catch (e) { next(e); }
});

const eventSchema = z.object({
  name: z.string().min(1).max(120),
  date: z.coerce.date().optional(),
  pax: z.number().int().min(0).nullable().optional(),
  description: z.string().max(500).optional(),
  revenue: z.number().min(0).optional(),
});

router.post('/', requireRole('owner', 'admin'), validate(eventSchema), async (req, res, next) => {
  try {
    const ev = await Event.create({ ...req.body, tenantId: req.auth.tenantId, createdBy: req.auth.userId });
    res.status(201).json(ev);
  } catch (e) { next(e); }
});

// Detalle: el evento + sus ítems (gastos vinculados).
router.get('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return next(notFound('Evento no encontrado'));
    const ev = await Event.findOne({ _id: req.params.id, tenantId: req.auth.tenantId }).lean();
    if (!ev) return next(notFound('Evento no encontrado'));
    const items = await Expense.find({ tenantId: req.auth.tenantId, eventId: ev._id }).sort({ createdAt: 1 }).lean();
    const spent = items.reduce((a, x) => a + (x.total || 0), 0);
    res.json({ ...ev, id: String(ev._id), spent, margin: (ev.revenue || 0) - spent, items });
  } catch (e) { next(e); }
});

router.patch('/:id', requireRole('owner', 'admin'), validate(eventSchema.partial()), async (req, res, next) => {
  try {
    const ev = await Event.findOneAndUpdate({ _id: req.params.id, tenantId: req.auth.tenantId }, { $set: req.body }, { new: true });
    if (!ev) return next(notFound('Evento no encontrado'));
    res.json(ev);
  } catch (e) { next(e); }
});

// Borra el evento y sus ítems (gastos vinculados).
router.delete('/:id', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const ev = await Event.findOneAndDelete({ _id: req.params.id, tenantId: req.auth.tenantId });
    if (!ev) return next(notFound('Evento no encontrado'));
    await Expense.deleteMany({ tenantId: req.auth.tenantId, eventId: ev._id });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Carga masiva de ítems (tabla rápida / pegar planilla / foto ya parseada).
// body.items: [{ name, vendor, amount, note, date }]
const itemsSchema = z.object({
  items: z.array(z.object({
    name: z.string().min(1).max(160),
    vendor: z.string().max(80).optional(),
    amount: z.coerce.number().nonnegative(),
    note: z.string().max(120).optional(),
    date: z.coerce.date().optional(),
  })).min(1).max(300),
});
router.post('/:id/items', requireRole('owner', 'admin'), validate(itemsSchema), async (req, res, next) => {
  try {
    const ev = await Event.findOne({ _id: req.params.id, tenantId: req.auth.tenantId }).select('_id date');
    if (!ev) return next(notFound('Evento no encontrado'));
    const docs = req.body.items
      .filter((i) => i.name && Number.isFinite(i.amount) && i.amount > 0)
      .map((i) => ({
        tenantId: req.auth.tenantId,
        eventId: ev._id,
        vendor: i.vendor || undefined,
        note: i.note || undefined,
        total: i.amount,
        category: 'supplies',
        date: i.date || ev.date || new Date(),
        items: [{ desc: i.name, amount: i.amount }],
        createdBy: req.auth.userId,
        ocrStatus: 'done',
      }));
    if (!docs.length) return res.json({ added: 0 });
    const created = await Expense.insertMany(docs);
    res.status(201).json({ added: created.length });
  } catch (e) { next(e); }
});

// Foto de la lista → IA extrae las filas (para revisar antes de guardar).
router.post('/:id/items/photo', requireRole('owner', 'admin'), requireFeature('ai'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file || !req.file.mimetype?.startsWith('image/')) return next(badRequest('Subí una foto de la lista'));
    const data = await extractExpenseList({ imageBase64: req.file.buffer.toString('base64'), mediaType: req.file.mimetype });
    res.json({ items: (data.items || []).map((i) => ({ name: i.name || '', vendor: i.vendor || '', amount: Number(i.amount) || 0, note: i.note || '' })) });
  } catch (e) { next(e); }
});

export default router;
