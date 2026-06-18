// Planes y límites por comercio. La diferenciación es por volumen (productos y pedidos/mes);
// todas las funciones (IA, integraciones) están incluidas en todos los planes para no romper
// nada al cambiar de plan. El cobro real (Mercado Pago/Stripe) se activa cuando se carguen
// credenciales; por ahora el dueño puede cambiar de plan desde el panel (alta manual).
export const PLANS = {
  free: {
    label: 'Free',
    priceMonthly: 0,
    limits: { products: 30, ordersPerMonth: 100 },
    blurb: 'Para arrancar: carta, pedidos y tu landing.',
  },
  pro: {
    label: 'Pro',
    priceMonthly: 9900,
    limits: { products: 300, ordersPerMonth: 2000 },
    blurb: 'Catálogo grande y más pedidos por mes.',
  },
  business: {
    label: 'Business',
    priceMonthly: 24900,
    limits: { products: Infinity, ordersPerMonth: Infinity },
    blurb: 'Sin límites, para alto volumen.',
  },
};

export const PLAN_IDS = Object.keys(PLANS);
export const getPlan = (id) => PLANS[id] || PLANS.free;
