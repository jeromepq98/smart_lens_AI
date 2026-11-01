import { ADMIN_COOKIE, csrfMatches, verifySession } from '../services/adminAuthService.js';
import { AppError, forbidden, unauthorized } from '../utils/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function requireAdmin(req, res, next) {
  try {
    const token = req.signedCookies?.[ADMIN_COOKIE];
    const context = await verifySession(token);
    if (!context) {
      req.admin = null;
      req.adminSession = null;
      throw unauthorized('Administrator sign-in required.');
    }

    req.admin = context.admin;
    req.adminSession = context.session;

    if (!SAFE_METHODS.has(req.method)) {
      const header = req.get('x-csrf-token');
      if (!csrfMatches(header, context.session.csrfSecret)) {
        throw forbidden('Your security token is missing or expired. Please sign in again.');
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePasswordChanged(req, res, next) {
  if (req.admin?.mustChangePassword) {
    return next(
      new AppError('Change the initial administrator password to continue.', {
        statusCode: 403,
        code: 'PASSWORD_CHANGE_REQUIRED',
      }),
    );
  }
  next();
}

export default requireAdmin;
