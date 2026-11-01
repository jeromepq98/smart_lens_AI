import { state, STORAGE_KEYS } from '../state.js';
import { t, setLanguage, LANGUAGE_NAMES } from '../i18n.js';
import {
  escapeHtml,
  toast,
  errorMessage,
  formatBytes,
  applyTheme,
  confirmDialog,
} from '../ui.js';
import * as db from '../db.js';
import { refreshQueueState, syncNow } from '../sync.js';
import { isStandalone, promptInstall, checkForUpdate } from '../pwa.js';

function statusChip(configured) {
  if (configured === true) {
    return `<span class="chip"><i class="bi bi-check-circle" aria-hidden="true"></i>${escapeHtml(t('settings.aiConfiguredLabel'))}</span>`;
  }
  if (configured === false) {
    return `<span class="status-pill status-failed"><i class="bi bi-exclamation-circle" aria-hidden="true"></i>${escapeHtml(t('settings.aiMissingLabel'))}</span>`;
  }
  return '<span class="chip chip-neutral">—</span>';
}

export async function renderSettings(container) {
  let scanCount = 0;
  let queueCount = 0;
  let estimate = null;

  try {
    scanCount = await db.countScans();
    queueCount = await db.countQueue();
  } catch {
    scanCount = 0;
    queueCount = 0;
  }
  try {
    estimate = (await navigator.storage?.estimate?.()) || null;
  } catch {
    estimate = null;
  }

  const usage = estimate?.usage || 0;
  const quota = estimate?.quota || 0;
  const percent = quota ? Math.min(100, Math.max(1, Math.round((usage / quota) * 100))) : 0;
  const installed = isStandalone();
  const version = state.config?.version || state.config?.system?.appVersion || '1.0.0';
  const aiConfigured = state.config?.aiConfigured;
  const queued = state.pendingCount || queueCount;

  container.innerHTML = `
    <h1 class="page-title">${escapeHtml(t('settings.title'))}</h1>
    <p class="page-subtitle">${escapeHtml(t('settings.subtitle'))}</p>

    <section class="section-card">
      <h2><i class="bi bi-palette" aria-hidden="true"></i>${escapeHtml(t('settings.appearanceTitle'))}</h2>
      <div class="settings-row">
        <div>
          <div class="label">${escapeHtml(t('settings.theme'))}</div>
        </div>
        <div class="control">
          <div class="level-switch" id="themeSwitch" role="group" aria-label="${escapeHtml(t('settings.theme'))}">
            <button type="button" data-theme="system" class="${state.theme === 'system' ? 'active' : ''}">${escapeHtml(t('settings.themeSystem'))}</button>
            <button type="button" data-theme="light" class="${state.theme === 'light' ? 'active' : ''}">${escapeHtml(t('settings.themeLight'))}</button>
            <button type="button" data-theme="dark" class="${state.theme === 'dark' ? 'active' : ''}">${escapeHtml(t('settings.themeDark'))}</button>
          </div>
        </div>
      </div>
      <div class="settings-row">
        <div>
          <div class="label">${escapeHtml(t('settings.language'))}</div>
          <div class="hint">${escapeHtml(t('settings.languageHint'))}</div>
        </div>
        <div class="control">
          <select class="form-select" id="settingsLanguage" aria-label="${escapeHtml(t('settings.language'))}">
            ${Object.entries(LANGUAGE_NAMES)
              .map(
                ([code, name]) =>
                  `<option value="${code}" ${state.language === code ? 'selected' : ''}>${escapeHtml(name)}</option>`,
              )
              .join('')}
          </select>
        </div>
      </div>
    </section>

    <section class="section-card">
      <h2><i class="bi bi-hdd" aria-hidden="true"></i>${escapeHtml(t('settings.dataTitle'))}</h2>
      <div class="settings-row">
        <div>
          <div class="label">${escapeHtml(t('settings.storageUsed'))}</div>
          <div class="hint">${escapeHtml(t('settings.storageHint'))}</div>
        </div>
        <div class="control text-end">
          <strong>${formatBytes(usage)}</strong>
          <div class="small muted">${quota ? `/ ${formatBytes(quota)}` : ''}</div>
        </div>
      </div>
      ${quota ? `<div class="storage-bar" aria-hidden="true"><span style="width: ${percent}%"></span></div>` : ''}
      <div class="info-grid mt-3">
        <div class="info-tile">${escapeHtml(t('settings.localScans'))}<strong>${scanCount}</strong></div>
        <div class="info-tile">${escapeHtml(t('settings.pendingScans'))}<strong>${queued}</strong></div>
        <div class="info-tile">${escapeHtml(t('settings.connection'))}<strong>${escapeHtml(t(state.online ? 'common.online' : 'common.offline'))}</strong></div>
      </div>
      <div class="d-flex flex-wrap gap-2 mt-3">
        ${
          queued > 0
            ? `<button type="button" class="btn btn-brand-soft" id="settingsSync"><i class="bi bi-arrow-repeat me-1" aria-hidden="true"></i>${escapeHtml(t('settings.syncNow'))}</button>`
            : ''
        }
        <button type="button" class="btn btn-outline-danger" id="settingsClear">
          <i class="bi bi-trash me-1" aria-hidden="true"></i>${escapeHtml(t('settings.clearLocal'))}
        </button>
      </div>
    </section>

    <section class="section-card">
      <h2><i class="bi bi-download" aria-hidden="true"></i>${escapeHtml(t('settings.installTitle'))}</h2>
      <p class="muted small mb-3">${escapeHtml(t('settings.installBody'))}</p>
      ${
        installed
          ? `<p class="mb-0 small"><i class="bi bi-check-circle-fill me-1" style="color: var(--sl-primary)" aria-hidden="true"></i>${escapeHtml(t('settings.installed'))}</p>`
          : `<button type="button" class="btn btn-brand" id="settingsInstall"><i class="bi bi-download me-1" aria-hidden="true"></i>${escapeHtml(t('settings.installButton'))}</button>`
      }
    </section>

    <section class="section-card">
      <h2><i class="bi bi-cloud-slash" aria-hidden="true"></i>${escapeHtml(t('settings.offlineTitle'))}</h2>
      <p class="muted small mb-0">${escapeHtml(t('settings.offlineBody'))}</p>
    </section>

    <section class="section-card">
      <h2><i class="bi bi-stars" aria-hidden="true"></i>${escapeHtml(t('settings.aiTitle'))}</h2>
      <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
        ${statusChip(aiConfigured)}
        <span class="small muted">${escapeHtml(aiConfigured === true ? t('settings.aiConfigured') : t('settings.aiNotConfigured'))}</span>
      </div>
      <p class="small muted mb-0">${escapeHtml(t('settings.aiHint'))}</p>
    </section>

    <section class="section-card">
      <h2><i class="bi bi-shield-lock" aria-hidden="true"></i>${escapeHtml(t('settings.privacyTitle'))}</h2>
      <p class="small muted mb-0">${escapeHtml(
        state.language === 'en' ? state.config?.privacy?.disclosure || t('settings.privacy') : t('settings.privacy'),
      )}</p>
    </section>

    <section class="section-card">
      <h2><i class="bi bi-info-circle" aria-hidden="true"></i>${escapeHtml(t('settings.aboutTitle'))}</h2>
      <p class="small muted">${escapeHtml(t('settings.aboutBody'))}</p>
      <div class="settings-row">
        <div class="label">${escapeHtml(t('settings.version'))}</div>
        <div class="control"><span class="chip chip-neutral">${escapeHtml(version)}</span></div>
      </div>
      <div class="settings-row">
        <div class="label">${escapeHtml(t('settings.updateSection'))}</div>
        <div class="control"><button type="button" class="btn btn-sm btn-outline-muted" id="settingsUpdate">${escapeHtml(t('settings.checkUpdate'))}</button></div>
      </div>
      <div class="settings-row">
        <div>
          <div class="label">${escapeHtml(t('settings.admin'))}</div>
          <div class="hint">${escapeHtml(t('settings.adminHint'))}</div>
        </div>
        <div class="control">
          <a class="btn btn-sm btn-outline-muted" href="/admin"><i class="bi bi-person-lock me-1" aria-hidden="true"></i>${escapeHtml(t('settings.admin'))}</a>
        </div>
      </div>
    </section>
  `;

  container.querySelectorAll('[data-theme]').forEach((button) => {
    button.addEventListener('click', () => {
      const theme = button.dataset.theme;
      state.theme = theme;
      localStorage.setItem(STORAGE_KEYS.theme, theme);
      applyTheme(theme);
      container.querySelectorAll('[data-theme]').forEach((item) => {
        item.classList.toggle('active', item.dataset.theme === theme);
      });
    });
  });

  container.querySelector('#settingsLanguage')?.addEventListener('change', (event) => {
    const language = event.target.value;
    state.language = language;
    localStorage.setItem(STORAGE_KEYS.language, language);
    setLanguage(language);
  });

  container.querySelector('#settingsSync')?.addEventListener('click', async () => {
    await syncNow({ silent: false }).catch(() => {});
    await refreshQueueState().catch(() => {});
    renderSettings(container);
  });

  container.querySelector('#settingsClear')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: t('settings.clearLocalConfirmTitle'),
      body: t('settings.clearLocalConfirmBody'),
      confirmLabel: t('common.delete'),
    });
    if (!confirmed) return;
    try {
      await db.clearAllLocal();
      await refreshQueueState();
      toast(t('settings.clearedLocal'), { type: 'success' });
      renderSettings(container);
    } catch (error) {
      toast(errorMessage(error), { type: 'error' });
    }
  });

  container.querySelector('#settingsInstall')?.addEventListener('click', async () => {
    await promptInstall();
  });

  container.querySelector('#settingsUpdate')?.addEventListener('click', async () => {
    const available = await checkForUpdate();
    toast(available ? t('settings.updateAvailable') : t('settings.upToDate'), {
      type: available ? 'info' : 'success',
    });
  });
}
