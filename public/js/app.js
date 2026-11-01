import { state, STORAGE_KEYS, adoptConfig, on } from './state.js';
import { t, setLanguage, onLanguageChange, normalizeLanguage } from './i18n.js';
import { applyTheme, resolveTheme, applyBranding, toast } from './ui.js';
import * as api from './api.js';
import { initSync, syncNow, reconcilePending, refreshQueueState } from './sync.js';
import { startRouter, renderCurrent } from './router.js';
import {
  registerServiceWorker,
  initInstallPrompt,
  promptInstall,
  updateInstallButton,
  applyUpdate,
} from './pwa.js';
import { renderScanner } from './views/scanner.js';
import { renderHistoryPage, renderFavoritesPage } from './views/history.js';
import { renderLearningPage } from './views/learning.js';
import { renderSettings } from './views/settings.js';
import { renderResult } from './views/result.js';

let rawCategories = [];

function detectLanguage() {
  const language = String(navigator.language || 'en').toLowerCase();
  if (language.startsWith('fil') || language === 'tl') return 'fil';
  if (language.startsWith('ceb')) return 'ceb';
  return 'en';
}

function readCachedConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.configCache);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function cacheConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEYS.configCache, JSON.stringify(config));
  } catch {
    // The cache is optional; the app still works without storage access.
  }
}

function readCachedCategories() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.categoriesCache);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cacheCategories(categories) {
  try {
    localStorage.setItem(STORAGE_KEYS.categoriesCache, JSON.stringify(categories));
  } catch {
    // The cache is optional.
  }
}

function syncCategoryNames() {
  state.categories = rawCategories.map((category) => ({
    ...category,
    name:
      typeof category.name === 'string'
        ? category.name
        : category.name?.[state.language] || category.name?.en || category.slug,
  }));
}

function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
}

function setControlLabels() {
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.setAttribute('aria-label', t('theme.switch'));
    themeToggle.title = t('theme.switch');
  }
  const installButton = document.getElementById('installButton');
  if (installButton) {
    installButton.setAttribute('aria-label', t('common.install'));
    installButton.title = t('common.install');
  }
  const languageSelect = document.getElementById('languageSelect');
  if (languageSelect) languageSelect.setAttribute('aria-label', t('settings.language'));
  updateSyncBadge({ count: state.pendingCount, syncing: state.syncing, error: state.syncError });
}

function updateSyncBadge({ count, syncing, error } = {}) {
  const badge = document.getElementById('syncBadge');
  const countLabel = document.getElementById('syncBadgeCount');
  if (!badge || !countLabel) return;
  const pending = Number.isFinite(count) ? count : state.pendingCount;
  countLabel.textContent = String(pending);
  const visible = pending > 0 || Boolean(syncing);
  badge.hidden = !visible;
  badge.classList.toggle('syncing', Boolean(syncing));
  badge.classList.toggle('failed', Boolean(error));
  badge.title = syncing
    ? t('sync.syncing', { count: pending })
    : error
      ? t('sync.error')
      : t('sync.pendingLabel');
}

function updateConnectivity() {
  const banner = document.getElementById('offlineBanner');
  if (banner) banner.hidden = state.online;
  const bannerText = banner?.querySelector('[data-i18n]');
  if (bannerText) bannerText.textContent = t('offline.banner');
}

async function primeConfig() {
  try {
    const [config, categories] = await Promise.all([api.getConfig(), api.getCategories()]);
    adoptConfig(config);
    applyBranding(config);
    cacheConfig(config);
    rawCategories = Array.isArray(categories) ? categories : [];
    cacheCategories(rawCategories);
    syncCategoryNames();
    updateConnectivity();
    updateSyncBadge({ count: state.pendingCount, syncing: state.syncing, error: state.syncError });
  } catch (error) {
    console.warn('Could not load the app configuration', error);
  }
}

function bindHeader() {
  const languageSelect = document.getElementById('languageSelect');
  if (languageSelect) {
    languageSelect.value = state.language;
    languageSelect.addEventListener('change', (event) => {
      const language = normalizeLanguage(event.target.value);
      state.language = language;
      try {
        localStorage.setItem(STORAGE_KEYS.language, language);
      } catch {
        // Persisting the preference is optional.
      }
      setLanguage(language);
      if (languageSelect.value !== language) languageSelect.value = language;
    });
  }

  const themeToggle = document.getElementById('themeToggle');
  themeToggle?.addEventListener('click', () => {
    const next = resolveTheme(state.theme) === 'dark' ? 'light' : 'dark';
    state.theme = next;
    try {
      localStorage.setItem(STORAGE_KEYS.theme, next);
    } catch {
      // Persisting the preference is optional.
    }
    applyTheme(next);
  });

  const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  systemTheme?.addEventListener?.('change', () => {
    if (state.theme === 'system') applyTheme('system');
  });

  document.getElementById('installButton')?.addEventListener('click', () => {
    promptInstall().catch(() => {});
  });

  document.getElementById('syncBadge')?.addEventListener('click', () => {
    if (!state.online) {
      toast(t('toast.offline'), { type: 'warning' });
      return;
    }
    syncNow({ silent: false }).catch(() => {});
  });

  document.getElementById('updateButton')?.addEventListener('click', () => {
    applyUpdate();
  });
}

function applyLanguageChange(language) {
  state.language = language;
  const languageSelect = document.getElementById('languageSelect');
  if (languageSelect && languageSelect.value !== language) languageSelect.value = language;
  syncCategoryNames();
  applyStaticI18n();
  setControlLabels();
  renderCurrent({ force: true });
}

function bindEvents() {
  on('sync', ({ count, syncing, error }) => {
    if (Number.isFinite(count)) state.pendingCount = count;
    state.syncing = Boolean(syncing);
    if (typeof error === 'boolean') state.syncError = error;
    updateSyncBadge({ count: state.pendingCount, syncing: state.syncing, error: state.syncError });
  });

  on('online', () => {
    updateConnectivity();
    updateSyncBadge({ count: state.pendingCount, syncing: state.syncing, error: state.syncError });
  });

  on('offline', () => {
    updateConnectivity();
    updateSyncBadge({ count: state.pendingCount, syncing: state.syncing, error: state.syncError });
  });

  on('install', () => updateInstallButton());

  on('update', ({ ready }) => {
    const banner = document.getElementById('updateBanner');
    if (banner) banner.hidden = !ready;
  });

  onLanguageChange((language) => applyLanguageChange(language));
}

function initPreferences() {
  const savedLanguage = localStorage.getItem(STORAGE_KEYS.language);
  state.language = normalizeLanguage(savedLanguage || detectLanguage());
  setLanguage(state.language);
  document.documentElement.lang = state.language;

  state.theme = localStorage.getItem(STORAGE_KEYS.theme) || 'system';
  applyTheme(state.theme);

  rawCategories = readCachedCategories();
  syncCategoryNames();
  applyStaticI18n();
  setControlLabels();
}

async function boot() {
  initPreferences();
  bindHeader();
  bindEvents();

  const cachedConfig = readCachedConfig();
  if (cachedConfig) {
    adoptConfig(cachedConfig);
    applyBranding(cachedConfig);
  }

  initSync();
  initInstallPrompt();
  updateInstallButton();
  updateConnectivity();
  updateSyncBadge({ count: 0, syncing: false, error: false });

  registerServiceWorker();
  reconcilePending().catch(() => {});
  refreshQueueState()
    .then(() => {
      if (state.online) syncNow({ silent: true }).catch(() => {});
    })
    .catch(() => {});

  if (!cachedConfig) await primeConfig();

  startRouter(document.getElementById('app'), {
    scan: (container) => renderScanner(container),
    history: (container) => renderHistoryPage(container),
    favorites: (container) => renderFavoritesPage(container),
    learning: (container) => renderLearningPage(container),
    settings: (container) => renderSettings(container),
    result: (container, params, query) => renderResult(container, params, query),
  });

  if (cachedConfig) {
    primeConfig();
  }
}

boot().catch((error) => {
  console.error('SmartLens AI failed to start', error);
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = `
      <section class="section-card">
        <div class="empty-state">
          <div class="empty-icon"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i></div>
          <h2>SmartLens AI</h2>
          <p>${t('error.generic')}</p>
          <button type="button" class="btn btn-brand" id="bootRetry">${t('common.retry')}</button>
        </div>
      </section>`;
    app.querySelector('#bootRetry')?.addEventListener('click', () => window.location.reload());
  }
});
