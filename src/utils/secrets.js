// Store de secretos centralizado.
// Un `tokenRef` es el NOMBRE de una variable de entorno / clave de vault, nunca el valor.
// Hoy resuelve contra process.env; mañana se puede enchufar un vault (Railway, Vault, etc.)
// sin tocar ningún call-site: toda la app pasa por acá.
export function resolveSecret(ref) {
  if (!ref) return null;
  return process.env[ref] ?? null;
}

import { decryptSecret } from './crypto.js';

// Resuelve un secreto de tenant: primero el cifrado en DB (panel), luego el tokenRef (env/vault).
export function resolveTenantSecret(encBlob, ref) {
  if (encBlob) { const v = decryptSecret(encBlob); if (v) return v; }
  return resolveSecret(ref);
}
