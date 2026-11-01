import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import config from '../config/env.js';
import * as adminUserModel from '../models/adminUser.js';
import * as adminSessionModel from '../models/adminSession.js';
import * as auditLogModel from '../models/auditLog.js';
import { hashIp, hashToken, randomToken } from '../utils/hash.js';
import { newId } from '../utils/uuid.js';
import { AppError, badRequest, unauthorized } from '../utils/errors.js';

export const ADMIN_COOKIE = 'sl_admin';
export const ADMIN_CSRF_COOKIE = 'sl_admin_csrf';

const DUMMY_HASH = bcrypt.hashSync('smartlens-invalid-password-placeholder', 10);
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const MAX_PASSWORD_LENGTH = 200;

function sessionExpiry() {
  return new Date(Date.now() + config.security.adminSessionHours * 60 * 60 * 1000);
}

function adminPayload(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    mustChangePassword: Boolean(user.must_change_password),
  };
}

export async function login({ username, password, ip, userAgent }) {
  const user = await adminUserModel.findByUsername(username);
  const ipHash = hashIp(ip);

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    await auditLogModel.add({ action: 'login_failed', metadata: { reason: 'unknown_user' }, ipHash });
    throw unauthorized('Incorrect username or password.');
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    await auditLogModel.add({
      adminId: user.id,
      action: 'login_locked',
      ipHash,
    });
    throw new AppError('Too many failed attempts. This account is temporarily locked.', {
      statusCode: 403,
      code: 'ACCOUNT_LOCKED',
    });
  }

  if (!user.is_active) {
    await auditLogModel.add({ adminId: user.id, action: 'login_inactive', ipHash });
    throw unauthorized('Incorrect username or password.');
  }

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    const state = await adminUserModel.recordFailedLogin(user.id, {
      maxAttempts: MAX_FAILED_ATTEMPTS,
      lockMinutes: LOCK_MINUTES,
    });
    await auditLogModel.add({
      adminId: user.id,
      action: 'login_failed',
      metadata: { attempts: state?.failed_attempts ?? null },
      ipHash,
    });
    throw unauthorized('Incorrect username or password.');
  }

  await adminSessionModel.removeExpired();
  await adminUserModel.recordSuccessfulLogin(user.id);

  const token = randomToken(32);
  const csrf = crypto.randomBytes(32).toString('hex');
  const expiresAt = sessionExpiry();
  await adminSessionModel.create({
    id: newId(),
    tokenHash: hashToken(token),
    adminId: user.id,
    csrfSecret: csrf,
    ipHash,
    userAgent,
    expiresAt,
  });
  await auditLogModel.add({ adminId: user.id, action: 'login', ipHash });

  return {
    token,
    csrf,
    expiresAt,
    admin: adminPayload(user),
  };
}

export async function verifySession(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const row = await adminSessionModel.findValidByTokenHash(hashToken(token));
  if (!row || !row.is_active) return null;
  await adminSessionModel.touch(row.id);
  return {
    session: { id: row.id, csrfSecret: row.csrf_secret, expiresAt: row.expires_at },
    admin: {
      id: row.admin_id,
      username: row.username,
      displayName: row.display_name || row.username,
      mustChangePassword: Boolean(row.must_change_password),
    },
  };
}

export function csrfMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function logout(session, admin, ip) {
  await adminSessionModel.removeById(session.id);
  await auditLogModel.add({ adminId: admin.id, action: 'logout', ipHash: hashIp(ip) });
}

export async function changePassword({ admin, session, currentPassword, newPassword, ip }) {
  if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > MAX_PASSWORD_LENGTH) {
    throw badRequest(`The new password must be between 12 and ${MAX_PASSWORD_LENGTH} characters.`);
  }
  if (currentPassword === newPassword) {
    throw badRequest('The new password must be different from the current password.');
  }

  const user = await adminUserModel.findById(admin.id);
  if (!user || !user.is_active) throw unauthorized();
  const matches = await bcrypt.compare(currentPassword, user.password_hash);
  if (!matches) throw unauthorized('The current password is incorrect.');

  const passwordHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);
  await adminUserModel.updatePassword(user.id, passwordHash);
  await adminSessionModel.removeForAdmin(user.id, session.id);
  await auditLogModel.add({
    adminId: user.id,
    action: 'password_changed',
    ipHash: hashIp(ip),
  });
}
