import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import config from '../config/env.js';
import { ping } from '../config/db.js';
import {
  getEffectiveSettings,
  getAiKey,
  invalidateSettingsCache,
  updateSettings,
} from './settingsService.js';
import * as stats from '../models/adminStats.js';
import * as adminSessionModel from '../models/adminSession.js';
import * as errorLogModel from '../models/errorLog.js';
import * as auditLogModel from '../models/auditLog.js';

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function fillDays(rows, days, mapper, empty) {
  const byDay = new Map(rows.map((row) => [dayKey(row.day), row]));
  const output = [];
  const today = new Date(`${dayKey(new Date())}T00:00:00Z`);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today.getTime() - offset * 24 * 60 * 60 * 1000);
    const key = dayKey(day);
    const row = byDay.get(key);
    output.push(mapper(row, key) || empty(key));
  }
  return output;
}

export async function getAdminSettings() {
  const settings = await getEffectiveSettings({ force: true });
  const envKey = Boolean(config.gemini.apiKey);
  const storedKey = Boolean(settings.ai?.apiKeyEnc);

  const { apiKeyEnc, ...aiSafe } = settings.ai || {};
  return {
    settings: {
      ...settings,
      ai: {
        ...aiSafe,
        hasApiKey: storedKey || envKey,
        apiKeySource: storedKey ? 'settings' : envKey ? 'environment' : 'none',
      },
    },
    meta: {
      version: config.version,
      nodeVersion: process.version,
      environment: config.nodeEnv,
      storageProvider: config.storage.provider,
      pushConfigured: Boolean(config.push.publicKey && config.push.privateKey),
      cookieSecure: config.security.cookieSecure,
      sessionHours: config.security.adminSessionHours,
    },
  };
}

export async function saveSettings(patch, adminId) {
  const updated = await updateSettings(patch, adminId);
  invalidateSettingsCache();
  const { apiKeyEnc, ...aiSafe } = updated.ai || {};
  return {
    ...updated,
    ai: {
      ...aiSafe,
      hasApiKey: Boolean(apiKeyEnc || config.gemini.apiKey),
      apiKeySource: apiKeyEnc ? 'settings' : config.gemini.apiKey ? 'environment' : 'none',
    },
  };
}

export async function getDashboard() {
  const [
    scans,
    scanSeries,
    categories,
    usageToday,
    usageSeries,
    activeSessions,
    storage,
    errors24h,
    recentUsageErrors,
    recentErrors,
    aiKey,
    stuckScans,
  ] = await Promise.all([
    stats.scanSummary(),
    stats.scansPerDay(14),
    stats.topCategories(6),
    stats.usageSummary({ sinceToday: true }),
    stats.usagePerDay(7),
    adminSessionModel.countActive(),
    stats.storageSummary(),
    errorLogModel.countSince(24),
    stats.usageErrors(5),
    errorLogModel.recent(5),
    getAiKey(),
    stats.activeScansOlderThan(10),
  ]);

  const settings = await getEffectiveSettings();

  return {
    version: config.version,
    scans,
    scanSeries: fillDays(
      scanSeries,
      14,
      (row, day) => (row ? { day, count: row.count } : null),
      (day) => ({ day, count: 0 }),
    ),
    usage: {
      today: usageToday,
      series: fillDays(
        usageSeries,
        7,
        (row, day) => (row ? { day, requests: row.requests, cost: row.cost } : null),
        (day) => ({ day, requests: 0, cost: 0 }),
      ),
    },
    topCategories: categories,
    system: {
      aiConfigured: Boolean(aiKey),
      aiSource: settings.ai?.apiKeyEnc ? 'settings' : config.gemini.apiKey ? 'environment' : 'none',
      maintenanceMode: Boolean(settings.system?.maintenanceMode),
      appVersion: settings.system?.appVersion || config.version,
      activeSessions,
      storageBytes: storage.bytes,
      storedImages: storage.images,
      errors24h,
      stuckScans,
    },
    recentUsageErrors,
    recentErrors,
  };
}

export async function getUsage(days = 30) {
  const [totals, series, byKind, byModel, errors] = await Promise.all([
    stats.usageSummary({ days }),
    stats.usagePerDay(Math.min(days, 30)),
    stats.usageByKind(days),
    stats.usageByModel(days),
    stats.usageErrors(10),
  ]);
  return { days, totals, series, byKind, byModel, errors };
}

export async function getSystemHealth() {
  const startedAt = Date.now();
  let db = { ok: false, latencyMs: null };
  try {
    await ping();
    db = { ok: true, latencyMs: Date.now() - startedAt };
  } catch {
    db = { ok: false, latencyMs: null };
  }

  let storage = { ok: false, provider: config.storage.provider };
  if (config.storage.provider === 'local') {
    try {
      await fs.access(config.upload.dir, fsConstants.W_OK);
      storage.ok = true;
    } catch {
      storage.ok = false;
    }
  } else {
    storage.ok = Boolean(config.storage.bucket && config.storage.accessKey);
  }

  const [aiKey, errors24h, stuckScans, activeSessions, scanTotals, storageTotals] = await Promise.all([
    getAiKey(),
    errorLogModel.countSince(24),
    stats.activeScansOlderThan(10),
    adminSessionModel.countActive(),
    stats.scanSummary(),
    stats.storageSummary(),
  ]);
  const settings = await getEffectiveSettings();

  const memory = process.memoryUsage();
  const checks = {
    database: db.ok,
    storage: storage.ok,
    ai: Boolean(aiKey),
    maintenanceOff: !settings.system?.maintenanceMode,
  };

  return {
    status: Object.values(checks).every(Boolean) && stuckScans === 0 ? 'ok' : 'degraded',
    checks,
    database: db,
    storage,
    ai: { configured: Boolean(aiKey), source: settings.ai?.apiKeyEnc ? 'settings' : config.gemini.apiKey ? 'environment' : 'none' },
    maintenance: { enabled: Boolean(settings.system?.maintenanceMode), message: settings.system?.maintenanceMessage || '' },
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      platform: `${os.type()} ${os.release()}`,
      memoryRssMb: Math.round(memory.rss / 1024 / 1024),
      memoryHeapMb: Math.round(memory.heapUsed / 1024 / 1024),
    },
    version: config.version,
    environment: config.nodeEnv,
    activeSessions,
    scans: scanTotals,
    stuckScans,
    errors24h,
    storageTotals,
    checkedAt: new Date().toISOString(),
  };
}

export async function getAuditLogs({ limit = 50, before, action } = {}) {
  const [rows, actions] = await Promise.all([
    auditLogModel.list({ limit, before, action }),
    auditLogModel.listActions(),
  ]);
  return {
    items: rows,
    actions,
    nextBefore: rows.length === limit ? rows[rows.length - 1].created_at : null,
  };
}
