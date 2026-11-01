import config from '../config/env.js';
import { parseJsonColumn, query, withTransaction } from '../config/db.js';
import { SETTINGS_DEFAULTS } from '../config/defaults.js';
import { decryptSecret, encryptSecret } from '../utils/cryptoBox.js';
import { badRequest } from '../utils/errors.js';

const CACHE_TTL_MS = 15000;
let cache = null;
let cacheExpiresAt = 0;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(base)) return override;
  if (!isPlainObject(override)) return override;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return result;
}

export async function getEffectiveSettings({ force = false } = {}) {
  if (!force && cache && Date.now() < cacheExpiresAt) return cache;

  const rows = await query('SELECT setting_key, setting_value FROM system_settings');
  const stored = {};
  for (const row of rows) {
    const parsed = parseJsonColumn(row.setting_value, {});
    if (isPlainObject(parsed)) stored[row.setting_key] = parsed;
  }

  const merged = {};
  for (const [key, definition] of Object.entries(SETTINGS_DEFAULTS)) {
    merged[key] = deepMerge(definition.value, stored[key] || {});
  }

  cache = merged;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return merged;
}

export function invalidateSettingsCache() {
  cache = null;
  cacheExpiresAt = 0;
}

export async function getAiKey(settings = null) {
  const effective = settings || (await getEffectiveSettings());
  const storedKey = effective.ai?.apiKeyEnc ? decryptSecret(effective.ai.apiKeyEnc) : '';
  return storedKey || config.gemini.apiKey || '';
}

export async function isAiConfigured() {
  return Boolean(await getAiKey());
}

export async function isMaintenanceMode() {
  const settings = await getEffectiveSettings();
  return Boolean(settings.system?.maintenanceMode);
}

export async function getPublicConfig() {
  const settings = await getEffectiveSettings();
  const aiConfigured = Boolean(await getAiKey(settings));

  return {
    version: config.version,
    appUrl: config.appUrl,
    branding: settings.branding,
    limits: settings.limits,
    upload: settings.upload,
    languages: settings.languages,
    features: {
      ...settings.features,
      pushNotifications: Boolean(config.push.publicKey) && Boolean(settings.features.pushNotifications),
    },
    system: {
      maintenanceMode: Boolean(settings.system?.maintenanceMode),
      maintenanceMessage: settings.system?.maintenanceMessage || '',
      appVersion: settings.system?.appVersion || config.version,
    },
    privacy: settings.privacy,
    aiConfigured,
  };
}

export async function updateSettings(patch, adminId) {
  if (!isPlainObject(patch)) throw badRequest('Settings payload must be an object.');

  const entries = Object.entries(patch).filter(
    ([key, value]) => Object.hasOwn(SETTINGS_DEFAULTS, key) && isPlainObject(value),
  );
  if (entries.length === 0) throw badRequest('No recognized settings were provided.');

  const current = await getEffectiveSettings({ force: true });

  await withTransaction(async (connection) => {
    for (const [key, value] of entries) {
      const next = deepMerge(current[key], value);

      if (key === 'ai') {
        if (typeof value.apiKey === 'string' && value.apiKey.trim().length > 0) {
          next.apiKeyEnc = encryptSecret(value.apiKey.trim());
        }
        if (value.clearApiKey === true) {
          delete next.apiKeyEnc;
        }
        delete next.apiKey;
        delete next.clearApiKey;
      }

      const serialized = JSON.stringify(next);
      const isPublic = SETTINGS_DEFAULTS[key].isPublic ? 1 : 0;
      await connection.query(
        `INSERT INTO system_settings (setting_key, setting_value, is_public, updated_by)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = ?, is_public = ?, updated_by = ?`,
        [key, serialized, isPublic, adminId, serialized, isPublic, adminId],
      );
    }
  });

  invalidateSettingsCache();
  return getEffectiveSettings({ force: true });
}

export function publicSettingsRow(row) {
  return parseJsonColumn(row?.setting_value, {});
}
