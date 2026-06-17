import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { validate } from '../middleware/validate.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { unauthorized, badRequest, forbidden } from '../utils/errors.js';

const router = Router();

// Config pública: el frontend la consulta para mostrar/ocultar "crear cuenta".
router.get('/config', (_req, res) => {
  res.json({ registrationOpen: env.registrationOpen });
});

const registerSchema = z.object({
  businessName: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'slug inválido'),
  email: z.string().email(),
  password: z.string().min(8),
});

// Alta de comercio + usuario owner
router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    if (!env.registrationOpen) return next(forbidden('El registro de nuevas cuentas está cerrado'));
    const { businessName, slug, email, password } = req.body;
    if (await Tenant.findOne({ slug })) return next(badRequest('slug ya en uso'));
    const tenant = await Tenant.create({ name: businessName, slug });
    const user = new User({ tenantId: tenant._id, email, role: 'owner' });
    await user.setPassword(password);
    await user.save();
    res.status(201).json({ token: sign(user), tenant: { id: tenant._id, slug } });
  } catch (e) { next(e); }
});

const loginSchema = z.object({ email: z.string().email(), password: z.string() });

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email, active: true });
    if (!user || !(await user.verifyPassword(req.body.password))) {
      return next(unauthorized('Credenciales inválidas'));
    }
    res.json({ token: sign(user) });
  } catch (e) { next(e); }
});

function sign(user) {
  return jwt.sign(
    { sub: user._id.toString(), tenantId: user.tenantId.toString(), role: user.role },
    env.jwtSecret, { expiresIn: env.jwtExpires },
  );
}

export default router;
