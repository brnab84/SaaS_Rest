# ROADMAP — RestaurApp

Cada fase es desplegable de forma independiente. Orden pensado para validar mercado rápido.
Leyenda: `[x]` hecho · `[~]` parcial · `[ ]` pendiente. Actualizado: 2026-06-17.

## Fase 1 — Core SaaS  ✅ casi lista
- [x] Multi-tenant + JWT + RBAC
- [x] Modelos base con índices
- [x] CRUD Product (menú) — API + ABM en el panel
- [x] Rutas públicas landing (`/api/public/:slug/menu`, `/orders`)
- [x] Dashboard PWA: ventas/gastos con gráficos
- [~] Falta la página visual pública (ver Fase 5)
**Entregable:** un comercio se registra, carga menú, recibe pedidos. ✅

## Fase 2 — Finanzas + IA  🟡 en curso
- [x] Servicio Claude: OCR factura (foto → Expense) + carga en el panel
- [~] Categorización automática (el OCR ya sugiere categoría)
- [ ] Costeo de platos y márgenes (modelado en Product.ingredients; falta UI)
- [x] Forecast de ventas (Claude sobre histórico)
- [~] Requiere cargar `ANTHROPIC_API_KEY` para activar OCR/forecast en prod
**Entregable:** panel de gastos/costos/forecast con carga de factura por foto.

## Fase 3 — Captación omnicanal  🟡 en curso
- [x] WhatsApp Cloud API: recepción de pedidos → Order (channel: whatsapp)
- [x] Envío de link de pago MP (servicio + endpoint)
- [ ] Instagram Graph API: campañas + DMs → Order (requiere app + credenciales Meta)
- [x] Cobro parcial/total (payment-link con monto)
**Entregable:** pedidos de IG/WA caen al panel central con cobro por link.

## Fase 4 — Pedidos activos + Delivery  🟡 en curso
- [x] Botones de estado + notificación automática al cliente (WhatsApp)
- [x] Compartir ubicación (servicio sendLocation)
- [~] Panel de pedidos en vivo (hoy refresco manual; falta polling/WebSocket)
- [ ] PedidosYa (Delivery Hero Plugin API) — requiere NDA + alta POS partner
**Entregable:** operación de cocina completa, multi-canal incluido delivery.

## Fase 5 — Landing pro configurable  🟡 en curso
- [~] Pedido desde landing → módulo central (endpoint POST listo)
- [ ] Render de la página de pedidos por slug (la web del comercio)
- [ ] Editor de landing por tenant (branding, info)
**Entregable:** cada comercio tiene su web de pedidos autoservicio.

## Fase 6 — Billing + escalado  ⚪ pendiente
- [ ] Suscripciones (Stripe o MP) por plan (free/pro/business)
- [~] Onboarding (registro de comercio ya existe)
- [ ] Límites por plan + métricas de uso
**Entregable:** producto cobrable y listo para crecer.

## Fase 7 — Panel de administración + crecimiento  ✅ casi lista
- [x] Panel de config: integraciones por comercio (Instagram, WhatsApp Business, Mercado Pago) — tokens cifrados
- [x] Tema/branding configurable y persistente; el tema del panel = el de la landing
- [x] Creador de campañas (UI sobre Campaign)
- [x] Sugerencias de publicaciones de Instagram con IA
- [x] Gastos por foto con IA + carga manual
- [x] Exportar gastos (CSV) e importar gastos desde CSV (Excel → "guardar como CSV")
- [~] Forecast con selector de horizonte (7/14/30 días) en Resumen
**Entregable:** el comercio autogestiona integraciones, branding, marketing y finanzas. ✅

---

## Infra y producto ya hecho (no estaba en el roadmap original)
- Deploy en Railway: servicios `api` + `worker`, auto-deploy desde `main`.
- Worker async con cola en Mongo y reintentos (backoff).
- PWA del panel: 6 temas conmutables, instalable, responsive estilo app nativa.
- Versionado atado a git (`/api/version`, footer en la app).
- Flag de admin de registro (`REGISTRATION_OPEN`).
- Tests (node:test) + GitHub Actions CI.
- Producción: https://api-production-1cc8.up.railway.app (panel en `/app`).

## Decisiones de arquitectura ya tomadas
- Worker separado para webhooks (evita bloquear el API y soporta reintentos de MP/Meta).
- Idempotencia obligatoria en todo webhook (índice único `externalRef` + chequeo de paymentId).
- Diferencial de producto: optimizado para el independiente que vende por IG/WhatsApp,
  hueco que Toast/Square/Lightspeed no cubren bien en LATAM.
