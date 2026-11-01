import { state, emit } from './state.js';
import { t } from './i18n.js';
import { toast, openModal, escapeHtml } from './ui.js';

let registration = null;
let pendingWorker = null;
let refreshing = false;

export function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export function isIos() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function showUpdateBanner(worker) {
  pendingWorker = worker;
  state.updateReady = true;
  const banner = document.getElementById('updateBanner');
  if (banner) banner.hidden = false;
  emit('update', { ready: true });
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;

  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

    if (registration.waiting) showUpdateBanner(registration.waiting);

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(installing);
        }
      });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!state.updateReady || refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    window.setInterval(() => registration?.update().catch(() => {}), 60 * 60 * 1000);
    return registration;
  } catch (error) {
    console.warn('Service worker registration failed', error);
    return null;
  }
}

export function applyUpdate() {
  if (pendingWorker) {
    pendingWorker.postMessage({ type: 'SKIP_WAITING' });
    return;
  }
  window.location.reload();
}

export async function checkForUpdate() {
  if (!registration) return false;
  try {
    await registration.update();
  } catch {
    return false;
  }
  if (registration.waiting) {
    showUpdateBanner(registration.waiting);
    return true;
  }
  return false;
}

export function updateInstallButton() {
  const button = document.getElementById('installButton');
  if (!button) return;
  const available = Boolean(state.installPromptEvent) || (isIos() && !isStandalone());
  button.hidden = !available || isStandalone();
}

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPromptEvent = event;
    updateInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    state.installPromptEvent = null;
    updateInstallButton();
    toast(t('toast.installed'), { type: 'success' });
    emit('install', { installed: true });
  });

  updateInstallButton();
}

export async function promptInstall() {
  if (state.installPromptEvent) {
    const event = state.installPromptEvent;
    state.installPromptEvent = null;
    event.prompt();
    const choice = await event.userChoice.catch(() => null);
    updateInstallButton();
    return choice?.outcome === 'accepted';
  }

  if (isIos() && !isStandalone()) {
    showIosInstall();
    return false;
  }

  toast(t('settings.installBody'), { type: 'info' });
  return false;
}

export function showIosInstall() {
  openModal({
    content: `
      <div class="modal-header">
        <h2 class="modal-title fs-6 fw-bold">${escapeHtml(t('settings.iosInstallTitle'))}</h2>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${escapeHtml(t('common.close'))}"></button>
      </div>
      <div class="modal-body">
        <p class="muted">${escapeHtml(t('settings.iosInstallBody'))}</p>
        <ol class="mb-0 d-grid gap-2 ps-3">
          <li>${escapeHtml(t('settings.iosStep1'))}</li>
          <li>${escapeHtml(t('settings.iosStep2'))} <i class="bi bi-box-arrow-up" aria-hidden="true"></i></li>
          <li>${escapeHtml(t('settings.iosStep3'))}</li>
        </ol>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-brand" data-bs-dismiss="modal">${escapeHtml(t('common.done'))}</button>
      </div>`,
    dialogClass: 'modal-dialog-centered',
  });
}
