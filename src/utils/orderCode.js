import crypto from 'node:crypto';

// Código corto y legible para mostrar al cliente (ej. "A7K3Q9").
// No es identidad: la unicidad real la da _id. Sirve para referenciar el pedido por voz/WhatsApp.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I/O/0/1 para evitar confusión
export function generateOrderCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  let code = '';
  for (let i = 0; i < len; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}
