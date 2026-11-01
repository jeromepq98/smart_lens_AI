import config from '../config/env.js';
import * as adminAuthService from '../services/adminAuthService.js';

const { ADMIN_COOKIE, ADMIN_CSRF_COOKIE } = adminAuthService;

function cookieBase() {
  return {
    secure: config.security.cookieSecure,
    sameSite: 'strict',
    path: '/',
  };
}

export async function login(req, res) {
  const result = await adminAuthService.login({
    username: req.body.username,
    password: req.body.password,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  const maxAge = Math.max(0, new Date(result.expiresAt).getTime() - Date.now());
  res.cookie(ADMIN_COOKIE, result.token, {
    ...cookieBase(),
    httpOnly: true,
    signed: true,
    maxAge,
  });
  res.cookie(ADMIN_CSRF_COOKIE, result.csrf, {
    ...cookieBase(),
    httpOnly: false,
    maxAge,
  });

  res.json({
    data: {
      admin: result.admin,
      csrf: result.csrf,
      expiresAt: result.expiresAt,
    },
  });
}

export async function me(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({
    data: {
      admin: req.admin,
      csrf: req.adminSession.csrfSecret,
      expiresAt: req.adminSession.expiresAt,
    },
  });
}

export async function logout(req, res) {
  await adminAuthService.logout(req.adminSession, req.admin, req.ip);
  res.clearCookie(ADMIN_COOKIE, { ...cookieBase(), httpOnly: true, signed: true });
  res.clearCookie(ADMIN_CSRF_COOKIE, { ...cookieBase(), httpOnly: false });
  res.status(204).end();
}

export async function changePassword(req, res) {
  await adminAuthService.changePassword({
    admin: req.admin,
    session: req.adminSession,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword,
    ip: req.ip,
  });
  res.status(204).end();
}
