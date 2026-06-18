import { Tenant } from '../models/Tenant.js';
import { getPlan } from '../config/plans.js';
import { forbidden } from '../utils/errors.js';

// Bloquea el endpoint si el plan del comercio no incluye la feature pedida.
// Las features se configuran por plan desde el panel root.
const LABEL = { ai: 'Inteligencia Artificial', integrations: 'Integraciones', whitelabel: 'Marca blanca' };

export function requireFeature(name) {
  return async (req, _res, next) => {
    try {
      const tenant = await Tenant.findById(req.auth.tenantId).select('plan');
      const features = getPlan(tenant?.plan).features || {};
      if (features[name] === false) {
        return next(forbidden(`Tu plan no incluye ${LABEL[name] || name}. Mejorá tu plan en Ajustes → Plan y uso.`));
      }
      next();
    } catch (e) { next(e); }
  };
}
