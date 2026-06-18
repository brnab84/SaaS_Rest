import { PlanConfig } from '../models/PlanConfig.js';

export const PLAN_IDS = ['free', 'pro', 'business'];

// Defaults (semilla inicial). El root los edita desde el panel; quedan en DB.
// limits null = sin límite. features: qué puede hacer cada plan.
export const PLAN_DEFAULTS = {
  free: {
    label: 'Free', priceMonthly: 0,
    limits: { products: 30, ordersPerMonth: 100 },
    features: { ai: true, integrations: true, whitelabel: false },
    blurb: 'Para arrancar: carta, pedidos y tu landing.',
  },
  pro: {
    label: 'Pro', priceMonthly: 9900,
    limits: { products: 300, ordersPerMonth: 2000 },
    features: { ai: true, integrations: true, whitelabel: false },
    blurb: 'Catálogo grande y más pedidos por mes.',
  },
  business: {
    label: 'Business', priceMonthly: 24900,
    limits: { products: null, ordersPerMonth: null },
    features: { ai: true, integrations: true, whitelabel: true },
    blurb: 'Sin límites, para alto volumen.',
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
let cache = clone(PLAN_DEFAULTS); // sincronía garantizada aun antes de cargar de DB

// Carga (y siembra los faltantes) la config de planes desde DB a memoria. Llamar al arrancar.
export async function loadPlans() {
  try {
    const docs = await PlanConfig.find().lean();
    const byId = Object.fromEntries(docs.map((d) => [d._id, d]));
    const out = clone(PLAN_DEFAULTS);
    for (const id of PLAN_IDS) {
      const d = byId[id];
      if (d) {
        out[id] = {
          label: d.label ?? out[id].label,
          priceMonthly: d.priceMonthly ?? out[id].priceMonthly,
          limits: {
            products: d.limits?.products ?? null,
            ordersPerMonth: d.limits?.ordersPerMonth ?? null,
          },
          features: { ...out[id].features, ...(d.features || {}) },
          blurb: d.blurb ?? out[id].blurb,
        };
      } else {
        await PlanConfig.create({ _id: id, ...clone(PLAN_DEFAULTS[id]) }).catch(() => {});
      }
    }
    cache = out;
  } catch {
    cache = clone(PLAN_DEFAULTS);
  }
  return cache;
}

export const refreshPlans = () => loadPlans();
export const getPlan = (id) => cache[id] || cache.free || PLAN_DEFAULTS.free;
export const allPlans = () => cache;
