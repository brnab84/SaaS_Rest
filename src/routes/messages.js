import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Message } from '../models/Message.js';

const router = Router();
router.use(requireAuth);

// Hilo del comercio con el equipo de la app. Al abrir, marca como leídos los del root.
router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.auth.tenantId;
    await Message.updateMany({ tenantId, from: 'root', read: false }, { $set: { read: true } });
    const messages = await Message.find({ tenantId }).sort({ createdAt: 1 }).limit(200);
    res.json(messages);
  } catch (e) { next(e); }
});

// Badge de no leídos (mensajes del root sin leer).
router.get('/unread', async (req, res, next) => {
  try {
    const unread = await Message.countDocuments({ tenantId: req.auth.tenantId, from: 'root', read: false });
    res.json({ unread });
  } catch (e) { next(e); }
});

const sendSchema = z.object({ text: z.string().min(1).max(2000) });
router.post('/', validate(sendSchema), async (req, res, next) => {
  try {
    const m = await Message.create({ tenantId: req.auth.tenantId, from: 'tenant', text: req.body.text });
    res.status(201).json(m);
  } catch (e) { next(e); }
});

export default router;
