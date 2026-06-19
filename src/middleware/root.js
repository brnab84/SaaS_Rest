import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { forbidden } from '../utils/errors.js';

// Solo el/los dueño(s) de la app (cuenta cuyo email está en ROOT_EMAIL) puede acceder al panel
// de administración. Se resuelve por email del usuario logueado, no por rol del tenant.
export async function requireRoot(req, _res, next) {
  try {
    if (!env.rootEmails.length) return next(forbidden());
    const user = await User.findById(req.auth?.userId).select('email');
    if (!user || !env.rootEmails.includes(user.email.toLowerCase())) return next(forbidden('Solo el administrador de la plataforma'));
    next();
  } catch (e) { next(e); }
}
