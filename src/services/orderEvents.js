import { EventEmitter } from 'node:events';

// Bus de eventos en proceso para avisar cambios de pedidos a los clientes SSE (panel en vivo).
// Es por instancia del API; si algún día corren varias instancias, migrar a Redis pub/sub.
export const orderEvents = new EventEmitter();
orderEvents.setMaxListeners(0); // sin límite: una suscripción por panel abierto

// Notifica que un pedido del tenant cambió (nuevo / cambio de estado / cobro / cancelación).
export function emitOrderChange(tenantId) {
  try { orderEvents.emit('change', String(tenantId)); } catch { /* best-effort */ }
}
