# ROADMAP — RestaurApp

Cada fase es desplegable de forma independiente. Orden pensado para validar mercado rápido.
Leyenda: `[x]` hecho · `[~]` parcial · `[ ]` pendiente. Actualizado: 2026-06-18 (v0.17.0).

## Fase 1 — Core SaaS  ✅ lista
- [x] Multi-tenant + JWT + RBAC
- [x] Modelos base con índices
- [x] CRUD Product (menú) — API + ABM en el panel
- [x] Rutas públicas landing (`/api/public/:slug/menu`, `/orders`, `/orders/:id/cancel`)
- [x] Dashboard PWA: ventas/gastos con gráficos
- [x] Página visual pública por slug (storefront) — ver Fase 5
**Entregable:** un comercio se registra, carga menú, recibe pedidos. ✅

## Fase 2 — Finanzas + IA  ✅ lista (falta cargar API key en prod)
- [x] Servicio Claude: OCR factura (foto → Expense) + carga en el panel
- [x] Categorización automática (el OCR sugiere categoría)
- [x] Costeo de platos y márgenes (UI en Menú: costo, margen y %)
- [x] Forecast de ventas (Claude) con selector de horizonte 7/14/30 días
- [x] Crear artículo del menú desde una foto (IA)
- [x] Importar menú desde PDF / imagen / texto (IA)
- [x] Gastos: editar, export e import CSV
- [~] Requiere cargar `ANTHROPIC_API_KEY` en el servicio `api` para activar la IA en prod
**Entregable:** panel de gastos/costos/forecast con carga por foto e IA. ✅

## Fase 3 — Captación omnicanal  🟡 en curso
- [x] WhatsApp Cloud API: recepción de pedidos → Order (channel: whatsapp)
- [x] Mensajes al cliente por estado **parametrizables** (WhatsApp)
- [x] Importar catálogo desde WhatsApp Business (Graph API /products)
- [x] Envío de link de pago MP + cobro parcial/total
- [ ] Instagram Graph API: campañas + DMs → Order (requiere app aprobada + credenciales Meta)
**Entregable:** pedidos de IG/WA caen al panel central con cobro por link.

## Fase 4 — Pedidos activos + Delivery  🟡 en curso
- [x] Botones de estado + notificación automática al cliente (WhatsApp)
- [x] Compartir ubicación (servicio sendLocation)
- [x] Panel de pedidos **en vivo con push real (SSE)** + polling de respaldo (25s)
- [x] Aviso de pedido nuevo en la app: sonido configurable + notificación del sistema
- [x] Responder rápido por WhatsApp y cancelar pedido (panel y cliente)
- [ ] PedidosYa (Delivery Hero Plugin API) — requiere NDA + alta POS partner
**Entregable:** operación de cocina completa, multi-canal incluido delivery.

## Fase 5 — Landing pro configurable  ✅ lista
- [x] Pedido desde landing → módulo central (POST listo)
- [x] Render de la página de pedidos por slug (storefront `/r/:slug`)
- [x] Editor de landing por tenant (branding, portada, logo, rubro, tema)
- [x] Catálogo tipo PedidosYa/Rappi con navegación por categorías
**Entregable:** cada comercio tiene su web de pedidos autoservicio. ✅

## Fase 6 — Billing + escalado  🟡 en curso
- [x] Planes (free/pro/business) con límites de productos y pedidos/mes
- [x] Métricas de uso + panel "Plan y uso" en Ajustes
- [x] Enforcement del límite de productos al crear/importar
- [x] Cambio de plan desde el panel (alta manual)
- [ ] Cobro automático por suscripción (Mercado Pago/Stripe) — requiere credenciales
- [x] Onboarding (registro de comercio)
**Entregable:** producto cobrable y listo para crecer.

## Fase 7 — Panel de administración + crecimiento  ✅ lista
- [x] Config de integraciones por comercio (Instagram, WhatsApp, Mercado Pago) — tokens cifrados
- [x] Tema/branding configurable y persistente; el tema del panel = el de la landing (7 temas)
- [x] Creador de campañas + sugerencias de Instagram con IA
- [x] Gastos por foto con IA + carga manual + edición + CSV
- [x] Categorías del menú parametrizables (dropdown) + navegación por categorías
- [x] Landing tipo catálogo: portada, logo, rubro y secciones por categoría
- [x] Productos con foto; crear desde foto (IA); duplicar; importar CSV/PDF/WhatsApp
- [x] Abrir/cerrar tienda; marcar pedido cobrado; subida de imágenes (GridFS)
**Entregable:** el comercio autogestiona integraciones, branding, marketing y finanzas. ✅

---

## Pendiente real (lo que falta y de qué depende)
- **Cobro de suscripciones** (Fase 6): código de planes listo; falta el checkout con credenciales MP/Stripe.
- **Instagram Graph API** (Fase 3): requiere app aprobada + credenciales Meta.
- **PedidosYa** (Fase 4): requiere NDA + alta como POS partner.
- **Activar en prod**: cargar `ANTHROPIC_API_KEY` (IA), `MP_*` (pagos), `WA_*` (envío WhatsApp).

## Infra y producto ya hecho
- Deploy en Railway: servicios `api` + `worker`, auto-deploy desde `main`.
- Worker async con cola en Mongo y reintentos (backoff).
- PWA del panel: 7 temas conmutables, instalable, responsive estilo app nativa.
- Pedidos en vivo por SSE (push) con polling de respaldo.
- Versionado atado a git (`/api/version`, footer en la app).
- Flag de admin de registro (`REGISTRATION_OPEN`).
- Tests (node:test) + GitHub Actions CI.
- Producción: https://api-production-1cc8.up.railway.app (panel en `/app`).

## Decisiones de arquitectura
- Worker separado para webhooks (evita bloquear el API y soporta reintentos de MP/Meta).
- Idempotencia obligatoria en webhooks (índice parcial único `externalRef`).
- SSE en proceso para el panel en vivo (con varias instancias del API, migrar a Redis pub/sub).
- Diferencial: optimizado para el independiente que vende por IG/WhatsApp en LATAM.
