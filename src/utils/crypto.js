import crypto from 'node:crypto';
import { env } from '../config/env.js';

// AES-256-GCM para cifrar secretos de cada tenant antes de guardarlos en Mongo.
// La clave deriva de ENCRYPTION_KEY (o JWT_SECRET). Formato: iv:tag:ciphertext (base64).
const key = crypto.scryptSync(String(env.encryptionKey), 'restaurapp.enc.v1', 32);

export function encryptSecret(plain) {
  if (!plain) return undefined;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(blob) {
  if (!blob || typeof blob !== 'string') return null;
  try {
    const [ivb, tagb, encb] = blob.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivb, 'base64'));
    decipher.setAuthTag(Buffer.from(tagb, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encb, 'base64')), decipher.final()]).toString('utf8');
  } catch { return null; }
}
