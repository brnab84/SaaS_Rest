# ROADMAP — RestaurApp

Cada fase es desplegable de forma independiente. Orden pensado para validar mercado rápido.

## Fase 1 — Core SaaS  ✅ esqueleto listo
- [x] Multi-tenant + JWT + RBAC
- [x] Modelos base con índices
- [ ] CRUD Product (menú) — routes/controllers
- [ ] Rutas públicas landing (`/api/public/:slug/menu`, `/orders`)
- [ ] Dashboard PWA: ventas/gastos básicos con gráficos
**Entregable:** un comercio se registra, carga menú, publica landing, recibe pedidos manuales.

## Fase 2 — Finanzas + IA
- [ ] Servicio Claude: OCR factura (foto → Expense estructurado)
- [ ] Categorización automática de gastos
- [ ] Costeo de platos y márgenes (ya modelado en Product.ingredients)
- [ ] Forecast de ventas (Claude sobre histórico de Orders)
**Entregable:** panel de gastos/costos/forecast con carga de factura por foto.

## Fase 3 — Captación omnicanal
- [ ] WhatsApp Cloud API: recepción de pedidos → Order (channel: whatsapp)
- [ ] Envío de link de pago MP por WhatsApp (ya hay servicio)
- [ ] Instagram Graph API: campañas + DMs → Order
- [ ] Cobro parcial/total (ya soportado en payment-link)
**Entregable:** pedidos de IG/WA caen al panel central con cobro por link.

## Fase 4 — Pedidos activos + Delivery
- [ ] Panel de pedidos en vivo (WebSocket/polling)
- [ ] Botones de estado + notificación automática al cliente (ya hay base)
- [ ] Compartir ubicación (servicio sendLocation listo)
- [ ] PedidosYa (Delivery Hero Plugin API) — gestionar NDA + alta POS partner
**Entregable:** operación de cocina completa, multi-canal incluido delivery.

## Fase 5 — Landing pro configurable
- [ ] Editor de landing por tenant (branding, menú, info)
- [ ] Render server-side por slug
- [ ] Pedido desde landing → módulo central → notifica WhatsApp del comercio
**Entregable:** cada comercio tiene su web de pedidos autoservicio.

## Fase 6 — Billing + escalado
- [ ] Suscripciones (Stripe o MP) por plan (free/pro/business)
- [ ] Onboarding guiado
- [ ] Límites por plan + métricas de uso
**Entregable:** producto cobrable y listo para crecer.

---

## Cómo arrancar en Claude Code
1. Abrí el repo en Claude Code y leé `HANDOFF.md`.
2. Empezá por Fase 1 pendiente: pedile a Claude Code
   *"implementá el CRUD de Product y las rutas públicas de landing siguiendo las
   convenciones del HANDOFF"*.
3. Configurá MongoDB Atlas y completá `.env`.
4. Probá local (`npm run dev`), luego conectá el repo a Railway para auto-deploy desde `main`.
5. Avanzá fase por fase; cada una es un PR/deploy independiente.

## Decisiones de arquitectura ya tomadas
- Worker separado para webhooks (evita bloquear el API y soporta reintentos de MP/Meta).
- Idempotencia obligatoria en todo webhook (índice único `externalRef` + chequeo de paymentId).
- Diferencial de producto: optimizado para el independiente que vende por IG/WhatsApp,
  hueco que Toast/Square/Lightspeed no cubren bien en LATAM.
