import crypto from 'node:crypto';
import config from '../config/env.js';

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(value) {
  return crypto
    .createHmac('sha256', config.security.sessionSecret)
    .update(String(value))
    .digest('hex');
}

export function hashIp(ip) {
  return hmacSha256(ip || 'unknown');
}

export function hashToken(token) {
  return sha256(token);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
