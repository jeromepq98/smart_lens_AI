import crypto from 'node:crypto';
import config from '../config/env.js';

const encryptionKey = crypto.scryptSync(
  config.security.sessionSecret,
  'smartlens-ai/settings-encryption',
  32,
);

export function encryptSecret(plainText) {
  if (typeof plainText !== 'string' || plainText.length === 0) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptSecret(payload) {
  if (typeof payload !== 'string' || !payload.startsWith('v1:')) return '';
  try {
    const [version, ivPart, tagPart, dataPart] = payload.split(':');
    if (version !== 'v1') return '';
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey,
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}
