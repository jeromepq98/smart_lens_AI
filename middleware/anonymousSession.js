import crypto from 'node:crypto';
import config from '../config/env.js';

export const ANONYMOUS_COOKIE = 'sl_sid';
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

function issueSessionId() {
  return crypto.randomBytes(32).toString('base64url');
}

export function anonymousSession(req, res, next) {
  const existing = req.signedCookies?.[ANONYMOUS_COOKIE];
  let sessionId = typeof existing === 'string' && SESSION_ID_PATTERN.test(existing) ? existing : null;

  if (!sessionId) {
    sessionId = issueSessionId();
    res.cookie(ANONYMOUS_COOKIE, sessionId, {
      httpOnly: true,
      secure: config.security.cookieSecure,
      sameSite: 'lax',
      signed: true,
      maxAge: config.security.anonymousSessionDays * 24 * 60 * 60 * 1000,
      path: '/',
    });
    req.anonymousSessionIsNew = true;
  }

  req.anonymousSessionId = sessionId;
  next();
}

export default anonymousSession;
