# HANDOFF — RestaurApp

SaaS multi-tenant para restaurantes/delivery independientes en LATAM. Captación por
Instagram/WhatsApp, cobro por link Mercado Pago, integración PedidosYa, panel de pedidos
en vivo, dashboard de ventas/gastos/forecast con OCR de facturas por foto (Claude API), y
landing pública configurable por comercio.

## Stack
- Node 20 + Express + ESM + Zod
- MongoDB Atlas + Mongoose (multi-tenant por `tenantId` en cada colección)
- Auth JWT + RBAC (owner/admin/cashier/kitchen)
- Deploy: Railway (auto-deploy desde `main`). Worker separado para webhooks/colas.
- IA: Claude API (OCR facturas, forecast, categorización de gastos)

## Estructura
```
src/
  config/     env.js, db.js
  models/     Tenant, User, Product, Order, Expense, Campaign
  middleware/ auth.js (requireAuth, requireRole), validate.js (validate + errorHandler)
  routes/     auth.js, orders.js, webhooks.js
  services/   mercadopago.js, whatsapp.js
  workers/    (pendiente) procesamiento async de webhooks
  utils/      logger.js, errors.js
  app.js, server.js
public/
  landing/index.html, css/landing.css, js/landing.js   (landing por tenant)
```

## Estado actual (esqueleto funcional)
HECHO:
- Modelos completos con índices compuestos `{tenantId, ...}` e índice único para idempotencia
  de delivery (`externalRef`).
- Auth: register (crea Tenant + owner) y login con JWT.
- Orders: listar activos, cambiar estado (+notifica WhatsApp), generar link de pago MP.
- Webhooks: MP (confirmación de pago, idempotente) y WhatsApp (verify GET + recepción POST
  con validación de firma HMAC de Meta).
- Servicios MP (preference Checkout Pro → init_point) y WhatsApp Cloud (texto/ubicación/template).
- Seguridad: helmet, CORS, rate limiting (api + auth), error handler centralizado, logger con
  redacción de secretos.
- Landing profesional responsive (firma visual: "comanda" física).

PENDIENTE (marcado con `TODO Claude Code` en el código):
1. Resolver `tokenRef` contra un store de secrets real (hoy lee de `process.env`).
2. Webhook MP: validar firma `x-signature` por tenant y resolver el access token del tenant.
3. Webhook WA: resolver tenant por `phone_number_id`, parsear mensaje y crear/actualizar Order.
4. Rutas públicas de landing: `GET /api/public/:slug/menu` y `POST /api/public/:slug/orders`.
5. CRUD de Product/Expense/Campaign (routes + controllers).
6. Servicio Claude para OCR de facturas (foto → Expense estructurado) y forecast.
7. Worker async (cola) para no procesar webhooks en el request.
8. Integración PedidosYa (Delivery Hero Plugin API) — requiere NDA + alta como POS partner.
9. Dashboard frontend (PWA) con gráficos de ventas/gastos/forecast.
10. Tests (node:test) + GitHub Actions CI.

## Convenciones
- Todo query SIEMPRE filtra por `tenantId` (aislamiento multi-tenant). Nunca buscar por `_id` solo.
- Webhooks responden `200` inmediato y procesan async; idempotencia por `paymentId`/`messageId`.
- Secretos jamás en Mongo ni en logs: se guarda `tokenRef`, el valor vive en env/vault.
- Validación Zod en cada endpoint con datos de entrada.

## Setup local
```
cp .env.example .env      # completar MONGODB_URI y JWT_SECRET como mínimo
npm install
npm run dev               # API en :3000
npm run worker            # worker (cuando exista)
```

## Deploy Railway
- Variables: MONGODB_URI, JWT_SECRET, APP_BASE_URL, MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET,
  WA_VERIFY_TOKEN, WA_APP_SECRET, ANTHROPIC_API_KEY, PEYA_*.
- `railway.json` ya configura startCommand y restart policy.
- Configurar el segundo servicio (worker) con startCommand `node src/workers/index.js`.
