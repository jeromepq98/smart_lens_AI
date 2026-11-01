import { t } from './i18n.js';
import { state } from './state.js';

const ICONS = {
  info: 'bi-info-circle',
  success: 'bi-check-circle',
  error: 'bi-exclamation-octagon',
  warning: 'bi-exclamation-triangle',
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function toast(message, { type = 'info', timeout = 4200 } = {}) {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const element = document.createElement('div');
  element.className = `sl-toast ${type}`;
  element.setAttribute('role', type === 'error' ? 'alert' : 'status');
  element.innerHTML = `<i class="bi ${ICONS[type] || ICONS.info}" aria-hidden="true"></i><div>${escapeHtml(message)}</div>`;
  stack.appendChild(element);
  const remove = () => {
    element.classList.add('dismissing');
    setTimeout(() => element.remove(), 220);
  };
  if (timeout > 0) setTimeout(remove, timeout);
  return remove;
}

export function confirmDialog({
  title,
  body,
  confirmLabel = t('common.confirm'),
  cancelLabel = t('common.cancel'),
  danger = true,
}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modalRoot');
    const id = `confirm-${Math.random().toString(36).slice(2)}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'modal fade';
    wrapper.tabIndex = -1;
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title fs-6 fw-bold">${escapeHtml(title)}</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${escapeHtml(t('common.close'))}"></button>
          </div>
          <div class="modal-body">
            <p class="mb-0" id="${id}-body">${escapeHtml(body)}</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-muted" data-bs-dismiss="modal" id="${id}-cancel">${escapeHtml(cancelLabel)}</button>
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-brand'}" id="${id}-ok">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      </div>`;
    root.appendChild(wrapper);
    const modal = new window.bootstrap.Modal(wrapper, { backdrop: 'static' });
    let answered = false;
    wrapper.querySelector(`#${id}-ok`).addEventListener('click', () => {
      answered = true;
      modal.hide();
      resolve(true);
    });
    wrapper.addEventListener('hidden.bs.modal', () => {
      modal.dispose();
      wrapper.remove();
      if (!answered) resolve(false);
    });
    modal.show();
  });
}

export function openModal({ content, className = '', dialogClass = '', staticBackdrop = false, onShown, onHidden }) {
  const root = document.getElementById('modalRoot');
  const wrapper = document.createElement('div');
  wrapper.className = `modal fade ${className}`;
  wrapper.tabIndex = -1;
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.innerHTML = `<div class="modal-dialog ${dialogClass}"><div class="modal-content">${content}</div></div>`;
  root.appendChild(wrapper);
  const modal = new window.bootstrap.Modal(wrapper, {
    backdrop: staticBackdrop ? 'static' : true,
    keyboard: !staticBackdrop,
  });
  wrapper.addEventListener('shown.bs.modal', () => onShown?.(wrapper));
  wrapper.addEventListener('hidden.bs.modal', () => {
    onHidden?.(wrapper);
    modal.dispose();
    wrapper.remove();
  });
  modal.show();
  return { modal, element: wrapper, hide: () => modal.hide() };
}

export function formatDate(value, language = 'en') {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : language === 'ceb' ? 'en-PH' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatRelative(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);

  if (Math.abs(seconds) < 60) return t('common.justNow');
  if (Math.abs(minutes) < 60) return t('common.minutesAgo', { count: Math.abs(minutes) });
  if (Math.abs(hours) < 24) return t('common.hoursAgo', { count: Math.abs(hours) });
  if (Math.abs(days) < 7) return t('common.daysAgo', { count: Math.abs(days) });
  return formatDate(date);
}

export function statusPill(status) {
  const map = {
    completed: { key: 'common.completed', icon: 'bi-check-circle' },
    processing: { key: 'common.processing', icon: 'bi-arrow-repeat' },
    pending: { key: 'common.pending', icon: 'bi-cloud-arrow-up' },
    failed: { key: 'common.failed', icon: 'bi-exclamation-triangle' },
  };
  const item = map[status] || map.pending;
  return `<span class="status-pill status-${escapeHtml(status)}"><i class="bi ${item.icon}" aria-hidden="true"></i>${escapeHtml(t(item.key))}</span>`;
}

export function categoryMeta(category) {
  if (!category) return { name: '', icon: 'bi-collection' };
  const match = state.categories?.find((item) => item.slug === category.slug);
  return {
    name: match?.name || category.name || category.slug || '',
    icon: match?.icon || category.icon || 'bi-collection',
  };
}

export function confidenceMeta(confidence) {
  if (confidence === 'high') return { label: t('result.confidenceHigh'), className: 'confidence-high' };
  if (confidence === 'moderate') return { label: t('result.confidenceModerate'), className: 'confidence-moderate' };
  return { label: t('result.confidenceLow'), className: 'confidence-low' };
}

export function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme) {
  const resolved = resolveTheme(theme);
  document.documentElement.setAttribute('data-bs-theme', resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#08110e' : '#0f9d76');
  const icon = document.querySelector('#themeToggle i');
  if (icon) icon.className = `bi ${resolved === 'dark' ? 'bi-sun' : 'bi-moon-stars'}`;
  return resolved;
}

export function applyBranding(config) {
  if (!config?.branding) return;
  const { title, tagline, logoUrl, faviconUrl, theme } = config.branding;
  if (title) {
    document.title = title;
    const brandTitle = document.getElementById('brandTitle');
    if (brandTitle) brandTitle.textContent = title;
  }
  if (tagline) {
    const brandTagline = document.getElementById('brandTagline');
    if (brandTagline) brandTagline.textContent = tagline;
  }
  if (logoUrl) {
    const logo = document.getElementById('brandLogo');
    if (logo) logo.src = logoUrl;
  }
  if (faviconUrl) {
    let link = document.querySelector('link[rel="icon"][sizes="32x32"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/png';
      link.sizes = '32x32';
      document.head.appendChild(link);
    }
    link.href = faviconUrl;
  }
  if (theme?.primary) {
    document.documentElement.style.setProperty('--sl-primary', theme.primary);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && document.documentElement.getAttribute('data-bs-theme') !== 'dark') {
      meta.setAttribute('content', theme.primary);
    }
  }
  if (theme?.accent) {
    document.documentElement.style.setProperty('--sl-accent', theme.accent);
  }
  const version = document.getElementById('appVersion');
  if (version && config.version) version.textContent = config.version;
}

export function setNavActive(route) {
  const normalized = route === 'result' || route === 'admin' ? '' : route;
  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.classList.toggle('active', link.dataset.nav === normalized);
    if (link.dataset.nav === normalized) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

const ERROR_KEYS = {
  NETWORK_ERROR: 'error.network',
  OFFLINE: 'error.offline',
  DAILY_LIMIT_REACHED: 'error.dailyLimit',
  RATE_LIMITED: 'error.rateLimit',
  TOO_MANY_REQUESTS: 'error.rateLimit',
  AI_NOT_CONFIGURED: 'error.aiNotConfigured',
  AI_AUTH_ERROR: 'error.aiAuth',
  AI_QUOTA_EXHAUSTED: 'error.aiQuota',
  AI_UNAVAILABLE: 'error.aiUnavailable',
  AI_RATE_LIMITED: 'error.aiBusy',
  AI_TIMEOUT: 'error.aiTimeout',
  AI_REFUSED: 'error.aiRefused',
  AI_EMPTY_RESPONSE: 'error.aiUnavailable',
  AI_INVALID_JSON: 'error.aiUnavailable',
  AI_INVALID_RESPONSE: 'error.aiUnavailable',
  UNSUPPORTED_MEDIA_TYPE: 'error.invalidImage',
  INVALID_IMAGE: 'error.invalidImage',
  PAYLOAD_TOO_LARGE: 'error.tooLarge',
  NOT_FOUND: 'error.notFound',
  VALIDATION_ERROR: 'error.validation',
  BAD_REQUEST: 'error.validation',
  STORAGE_NOT_CONFIGURED: 'error.storage',
  STORAGE_ERROR: 'error.storage',
  IMAGE_MISSING: 'error.storage',
  SCAN_FAILED: 'error.scanFailed',
  REANALYZE_FAILED: 'error.scanFailed',
};

export function errorMessageForCode(code) {
  if (code && ERROR_KEYS[code]) return t(ERROR_KEYS[code]);
  return null;
}

export function errorMessage(error) {
  if (!error) return t('error.generic');
  const mapped = errorMessageForCode(error.code);
  if (mapped) return mapped;
  if (error.name === 'TypeError' || error.code === 'NETWORK_ERROR') return t('error.network');
  return t('error.generic');
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('FILE_READ_ERROR'));
    reader.readAsDataURL(file);
  });
}

export function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('IMAGE_LOAD_ERROR'));
    image.src = source;
  });
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('CANVAS_ENCODE_ERROR'))),
      type,
      quality,
    );
  });
}

export async function makeThumbnail(blob, maxSize = 900, type = 'image/jpeg', quality = 0.82) {
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL(type, quality);
    return { dataUrl, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
