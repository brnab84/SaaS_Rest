import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { forbidden } from '../utils/errors.js';

// Solo el dueño de la app (cuenta cuyo email coincide con ROOT_EMAIL) puede acceder al panel
// de administración. Se resuelve por email del usuario logueado, no por rol del tenant.
export async function requireRoot(req, _res, next) {
  try {
    if (!env.rootEmail) return next(forbidden());
    const user = await User.findById(req.auth?.userId).select('email');
    if (!user || user.email.toLowerCase() !== env.rootEmail) return next(forbidden('Solo el administrador de la plataforma'));
    next();
  } catch (e) { next(e); }
}
