import { badRequest } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// Valida req[source] con un schema Zod
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(badRequest(result.error.issues.map((i) => i.message).join('; ')));
    }
    req[source] = result.data;
    next();
  };
}

// Manejo centralizado de errores
export function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) logger.error({ err }, 'Error no controlado');
  res.status(status).json({
    error: { code: err.code || 'INTERNAL', message: status >= 500 ? 'Error interno' : err.message },
  });
}
