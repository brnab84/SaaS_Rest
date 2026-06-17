import crypto from 'node:crypto';

export function hmacSha256Hex(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

// Comparación en tiempo constante de dos strings hex (evita timing attacks).
export function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Manifest de Mercado Pago: solo incluye los campos presentes, en orden id;request-id;ts.
export function buildMpManifest({ dataId, requestId, ts }) {
  let m = '';
  if (dataId) m += `id:${dataId};`;
  if (requestId) m += `request-id:${requestId};`;
  m += `ts:${ts};`;
  return m;
}

// Valida el header x-signature de MP (formato "ts=...,v1=...").
export function verifyMpSignature({ signatureHeader, requestId, dataId, secret }) {
  if (!signatureHeader || !secret) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.split('=').map((s) => s.trim())),
  );
  if (!parts.ts || !parts.v1) return false;
  const manifest = buildMpManifest({ dataId, requestId, ts: parts.ts });
  return safeEqualHex(hmacSha256Hex(secret, manifest), parts.v1);
}

// Valida la firma x-hub-signature-256 de Meta (WhatsApp Cloud). rawBody: Buffer.
export function verifyMetaSignature({ signatureHeader, rawBody, appSecret }) {
  if (!signatureHeader || !rawBody || !appSecret) return false;
  const expected = 'sha256=' + hmacSha256Hex(appSecret, rawBody);
  return safeEqualHex(signatureHeader, expected);
}
