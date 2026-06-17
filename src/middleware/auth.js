import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized, forbidden } from '../utils/errors.js';

// Verifica JWT y adjunta { userId, tenantId, role } a req.auth
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized('Falta token'));
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.auth = { userId: payload.sub, tenantId: payload.tenantId, role: payload.role };
    next();
  } catch {
    next(unauthorized('Token inválido o expirado'));
  }
}

// RBAC: restringe por rol
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.auth?.role)) return next(forbidden());
    next();
  };
}
