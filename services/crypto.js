import crypto from 'node:crypto';
import { config } from '../config/index.js';

// AES-256-GCM for integration credentials at rest.
function key() {
  const material = config.encryptionKey || config.sessionSecret;
  if (!material) throw new Error('ENCRYPTION_KEY or SESSION_SECRET must be set');
  return crypto.createHash('sha256').update(material).digest();
}

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload) {
  const [iv, tag, enc] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
