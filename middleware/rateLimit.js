import rateLimit from 'express-rate-limit';
import { getEffectiveSettings } from '../services/settingsService.js';
import { tooManyRequests } from '../utils/errors.js';

const standardOptions = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
};

function reject(message) {
  return (req, res, next) => next(tooManyRequests(message));
}

async function limitFromSettings(key, fallback) {
  try {
    const settings = await getEffectiveSettings();
    const value = Number(settings.limits?.[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function sessionKey(prefix) {
  return (req) => `${prefix}:${req.anonymousSessionId || req.ip}`;
}

export const globalApiLimiter = rateLimit({
  ...standardOptions,
  windowMs: 15 * 60 * 1000,
  limit: 300,
  handler: reject('Too many requests. Please slow down and try again shortly.'),
});

export const scanLimiter = rateLimit({
  ...standardOptions,
  windowMs: 60 * 1000,
  limit: () => limitFromSettings('scanPerMinute', 5),
  keyGenerator: sessionKey('scan'),
  handler: reject('Too many scans in a short period. Please wait a moment and try again.'),
});

export const chatLimiter = rateLimit({
  ...standardOptions,
  windowMs: 60 * 1000,
  limit: () => limitFromSettings('chatPerMinute', 12),
  keyGenerator: sessionKey('chat'),
  handler: reject('Too many messages in a short period. Please wait a moment and try again.'),
});

export const reanalyzeLimiter = rateLimit({
  ...standardOptions,
  windowMs: 60 * 1000,
  limit: () => limitFromSettings('reanalyzePerMinute', 3),
  keyGenerator: sessionKey('reanalyze'),
  handler: reject('Too many reanalysis requests. Please wait a moment and try again.'),
});

export const adminLoginLimiter = rateLimit({
  ...standardOptions,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  handler: reject('Too many sign-in attempts. Please wait 15 minutes and try again.'),
});
