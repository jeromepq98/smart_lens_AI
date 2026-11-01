import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  throw new Error(`[config] ${message}`);
}

function optional(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    fail(`${name} is required. Copy .env.example to .env and set a value.`);
  }
  return value.trim();
}

function integer(name, fallback, { min, max } = {}) {
  const raw = optional(name, '');
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) fail(`${name} must be an integer.`);
  if (min !== undefined && value < min) fail(`${name} must be >= ${min}.`);
  if (max !== undefined && value > max) fail(`${name} must be <= ${max}.`);
  return value;
}

function boolean(name, fallback = false) {
  const raw = optional(name, '').toLowerCase();
  if (raw === '') return fallback;
  if (['true', '1', 'yes', 'on'].includes(raw)) return true;
  if (['false', '0', 'no', 'off'].includes(raw)) return false;
  fail(`${name} must be true or false.`);
}

function oneOf(name, allowed, fallback) {
  const value = optional(name, fallback);
  if (!allowed.includes(value)) fail(`${name} must be one of: ${allowed.join(', ')}.`);
  return value;
}

const nodeEnv = oneOf('NODE_ENV', ['development', 'test', 'production'], 'development');
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';
const isDev = nodeEnv === 'development';

const sessionSecret = required('SESSION_SECRET');
if (sessionSecret.length < 32) {
  fail('SESSION_SECRET must be at least 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"');
}

const dbName = optional('DB_NAME', 'smartlens_ai');
if (!/^[A-Za-z0-9_]{1,64}$/.test(dbName)) {
  fail('DB_NAME may only contain letters, numbers, and underscores.');
}

const appUrl = optional('APP_URL', 'http://localhost:3000');
try {
  const parsed = new URL(appUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) fail('APP_URL must use http or https.');
} catch (error) {
  if (error.message.startsWith('[config]')) throw error;
  fail('APP_URL must be a valid URL.');
}

const trustProxyRaw = optional('TRUST_PROXY', isProd ? '1' : 'loopback');
const trustProxy = /^\d+$/.test(trustProxyRaw) ? Number(trustProxyRaw) : trustProxyRaw;

const adminInitialPassword = optional('ADMIN_INITIAL_PASSWORD', '');
if (adminInitialPassword && adminInitialPassword.length < 12) {
  fail('ADMIN_INITIAL_PASSWORD must be at least 12 characters.');
}

const storageProvider = oneOf('STORAGE_PROVIDER', ['local', 's3'], 'local');
const maxImageSizeMb = integer('MAX_IMAGE_SIZE_MB', 10, { min: 1, max: 50 });

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

const config = Object.freeze({
  nodeEnv,
  isProd,
  isTest,
  isDev,
  version: pkg.version,
  port: integer('PORT', 3000, { min: 1, max: 65535 }),
  appUrl,
  trustProxy,
  logLevel: optional('LOG_LEVEL', isTest ? 'silent' : 'info'),
  db: Object.freeze({
    host: optional('DB_HOST', 'localhost'),
    port: integer('DB_PORT', 3306, { min: 1, max: 65535 }),
    name: dbName,
    user: optional('DB_USER', 'root'),
    password: process.env.DB_PASSWORD ?? '',
    connectionLimit: isTest ? 5 : 10,
  }),
  gemini: Object.freeze({
    apiKey: optional('GEMINI_API_KEY', ''),
    visionModel: optional('GEMINI_VISION_MODEL', 'gemini-2.5-flash'),
    textModel: optional('GEMINI_TEXT_MODEL', 'gemini-2.5-flash'),
  }),
  security: Object.freeze({
    sessionSecret,
    cookieSecure: isProd,
    anonymousSessionDays: 30,
    adminSessionHours: 8,
    bcryptRounds: 12,
  }),
  admin: Object.freeze({
    username: optional('ADMIN_USERNAME', 'admin'),
    initialPassword: adminInitialPassword,
  }),
  upload: Object.freeze({
    dir: path.join(rootDir, 'uploads'),
    maxImageSizeMb,
    maxImageSizeBytes: maxImageSizeMb * 1024 * 1024,
    maxDailyScans: integer('MAX_DAILY_SCANS', 20, { min: 1, max: 1000 }),
    maxDimension: 2048,
    allowedMimeTypes: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
  }),
  storage: Object.freeze({
    provider: storageProvider,
    bucket: optional('STORAGE_BUCKET', ''),
    region: optional('STORAGE_REGION', ''),
    endpoint: optional('STORAGE_ENDPOINT', ''),
    accessKey: optional('STORAGE_ACCESS_KEY', ''),
    secretKey: optional('STORAGE_SECRET_KEY', ''),
  }),
  push: Object.freeze({
    publicKey: optional('VAPID_PUBLIC_KEY', ''),
    privateKey: optional('VAPID_PRIVATE_KEY', ''),
    subject: optional('VAPID_SUBJECT', 'mailto:admin@example.com'),
  }),
  runAiTests: boolean('RUN_AI_TESTS', false),
});

export default config;
