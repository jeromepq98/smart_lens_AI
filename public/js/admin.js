const app = document.getElementById('adminApp');
const CSRF_KEY = 'sl.admin.csrf';
const THEME_KEY = 'sl.admin.theme';

const state = {
  admin: null,
  csrf: sessionStorage.getItem(CSRF_KEY) || '',
  route: 'dashboard',
  settings: null,
  meta: null,
  settingsTab: 'branding',
  usageDays: 30,
  audit: { items: [], before: null, action: '' },
  healthTimer: null,
  routeBound: false,
};

/* ---------- helpers ---------- */

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(value) {
  return Number(value || 0).toLocaleString();
}

function fmtCost(value) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function fmtBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDate(value, withTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function fmtDay(value) {
  const raw = String(value || '');
  const date = new Date(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function duration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function toast(message, type = 'info') {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const icons = { info: 'bi-info-circle', success: 'bi-check-circle', warning: 'bi-exclamation-triangle', error: 'bi-x-octagon' };
  const el = document.createElement('div');
  el.className = `sl-toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<i class="bi ${icons[type] || icons.info}" aria-hidden="true"></i><div>${esc(message)}</div>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('dismissing');
    setTimeout(() => el.remove(), 220);
  }, 4600);
}

function iconFor(name) {
  const icons = {
    dashboard: 'bi-speedometer2',
    usage: 'bi-graph-up',
    settings: 'bi-sliders',
    health: 'bi-heart-pulse',
    audit: 'bi-journal-text',
    password: 'bi-key',
  };
  return icons[name] || 'bi-dot';
}

/* ---------- theme ---------- */

function applyTheme(theme) {
  document.documentElement.dataset.bsTheme = theme;
  document.querySelectorAll('[data-theme-icon]').forEach((el) => {
    el.className = `bi ${theme === 'dark' ? 'bi-sun' : 'bi-moon-stars'}`;
  });
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'dark' ? 'dark' : 'light');
}

function toggleTheme() {
  const next = document.documentElement.dataset.bsTheme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

/* ---------- api ---------- */

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && state.csrf) headers['X-CSRF-Token'] = state.csrf;

  let response;
  try {
    response = await fetch(`/api/admin${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, 'NETWORK_ERROR');
  }

  if (response.status === 204) return null;

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const code = payload?.error?.code || 'INTERNAL_ERROR';
    const message = payload?.error?.message || 'The request could not be completed.';
    if (response.status === 401) {
      if (path !== '/login') {
        clearSession();
        renderLogin('Your session has ended. Please sign in again.');
      }
    } else if (code === 'PASSWORD_CHANGE_REQUIRED' && state.admin) {
      state.admin.mustChangePassword = true;
      renderShell();
    }
    throw new ApiError(message, response.status, code);
  }

  return payload?.data ?? null;
}

function clearSession() {
  state.admin = null;
  state.csrf = '';
  state.settings = null;
  state.meta = null;
  sessionStorage.removeItem(CSRF_KEY);
  stopHealthTimer();
}

function csrfFromCookie() {
  const match = document.cookie.match(/(?:^|;\s*)sl_admin_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function setSession(admin, csrf) {
  state.admin = admin;
  state.csrf = csrf;
  if (csrf) sessionStorage.setItem(CSRF_KEY, csrf);
}

/* ---------- auth views ---------- */

function themeToggleButton(cls = 'icon-button') {
  return `<button type="button" class="${cls} theme-toggle" aria-label="Switch theme" title="Switch theme">
    <i class="bi bi-moon-stars" data-theme-icon aria-hidden="true"></i>
  </button>`;
}

function renderLogin(message = '') {
  stopHealthTimer();
  document.title = 'Sign in · SmartLens AI Administrator';
  app.innerHTML = `
    <div class="admin-auth-wrap">
      <div class="admin-auth-card fade-up">
        <div class="d-flex justify-content-between align-items-start">
          <div class="admin-auth-brand">
            <img src="/assets/icons/icon.svg" alt="" />
            <div>
              <h1>SmartLens AI</h1>
              <p>Administrator console</p>
            </div>
          </div>
          ${themeToggleButton()}
        </div>
        <h2>Sign in</h2>
        <p class="admin-hint mb-4">Restricted access. All sign-in attempts are logged.</p>
        ${message ? `<div class="alert alert-warning py-2 px-3 small" role="alert">${esc(message)}</div>` : ''}
        <div id="loginError" class="alert alert-danger py-2 px-3 small d-none" role="alert"></div>
        <form id="loginForm" novalidate>
          <div class="mb-3">
            <label class="form-label small fw-semibold" for="loginUsername">Username</label>
            <input id="loginUsername" name="username" class="form-control" autocomplete="username" required maxlength="60" />
          </div>
          <div class="mb-4">
            <label class="form-label small fw-semibold" for="loginPassword">Password</label>
            <input id="loginPassword" name="password" type="password" class="form-control" autocomplete="current-password" required maxlength="200" />
          </div>
          <button class="btn btn-brand w-100" type="submit" id="loginButton">Sign in securely</button>
        </form>
        <p class="admin-hint mt-4 mb-0 text-center"><a href="/">Return to SmartLens AI</a></p>
      </div>
    </div>`;

  document.querySelectorAll('.theme-toggle').forEach((btn) => btn.addEventListener('click', toggleTheme));
  applyTheme(document.documentElement.dataset.bsTheme);
  document.getElementById('loginUsername')?.focus();

  document.getElementById('loginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = document.getElementById('loginError');
    const button = document.getElementById('loginButton');
    const username = form.username.value.trim();
    const password = form.password.value;
    errorBox.classList.add('d-none');
    if (!username || !password) {
      errorBox.textContent = 'Enter your username and password.';
      errorBox.classList.remove('d-none');
      return;
    }
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      const data = await api('/login', { method: 'POST', body: { username, password } });
      setSession(data.admin, data.csrf);
      if (data.admin.mustChangePassword) {
        renderShell();
        return;
      }
      if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '#/dashboard';
      renderShell();
      toast(`Welcome back, ${data.admin.displayName}.`, 'success');
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('d-none');
      button.disabled = false;
      button.textContent = 'Sign in securely';
    }
  });
}

/* ---------- shell ---------- */

function navItems() {
  return [
    ['dashboard', 'Dashboard'],
    ['usage', 'Usage'],
    ['settings', 'Settings'],
    ['health', 'System health'],
    ['audit', 'Audit logs'],
  ];
}

function renderShell() {
  stopHealthTimer();
  if (!state.admin) {
    renderLogin();
    return;
  }

  const forced = Boolean(state.admin.mustChangePassword);
  state.route = routeFromHash();

  if (forced) {
    renderShellChrome(true);
    renderChangePassword({ forced: true });
    return;
  }

  if (!['dashboard', 'usage', 'settings', 'health', 'audit', 'password'].includes(state.route)) {
    state.route = 'dashboard';
  }

  renderShellChrome(false);
  bindShellEvents();
  renderRoute();
}

function renderShellChrome(forced) {
  document.title = 'Administrator · SmartLens AI';
  const admin = state.admin;
  app.innerHTML = `
    <div class="admin-shell">
      <aside class="admin-sidebar">
        <a class="brand" href="#/dashboard">
          <img src="/assets/icons/icon.svg" alt="" width="40" height="40" />
          <span class="brand-text">
            <strong>SmartLens AI</strong>
            <small>Admin console</small>
          </span>
        </a>
        ${
          forced
            ? ''
            : `<nav class="admin-nav" aria-label="Administrator navigation">
                ${navItems()
                  .map(
                    ([key, label]) => `
                  <a href="#/${key}" data-nav="${key}" class="${state.route === key ? 'active' : ''}">
                    <i class="bi ${iconFor(key)}" aria-hidden="true"></i><span>${label}</span>
                  </a>`,
                  )
                  .join('')}
              </nav>`
        }
        <div class="admin-sidebar-foot">
          <div class="admin-user">
            <span class="admin-avatar">${esc((admin.displayName || admin.username || 'A').slice(0, 1).toUpperCase())}</span>
            <span class="admin-user-text">
              <strong class="d-block">${esc(admin.displayName || admin.username)}</strong>
              <small class="muted">${esc(admin.username)}</small>
            </span>
          </div>
          <div class="d-flex gap-2 flex-wrap">
            ${themeToggleButton('icon-button')}
            <a class="icon-button" href="/" title="Open public site" aria-label="Open public site" target="_blank" rel="noopener">
              <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
            </a>
            <button type="button" class="icon-button" id="logoutButton" title="Sign out" aria-label="Sign out">
              <i class="bi bi-box-arrow-right" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </aside>
      <main class="admin-main">
        <div id="adminView">
          <div class="admin-loading">
            <div class="admin-spinner" role="status" aria-label="Loading"></div>
            <p class="mb-0">Loading…</p>
          </div>
        </div>
      </main>
    </div>`;

  document.querySelectorAll('.theme-toggle').forEach((btn) => btn.addEventListener('click', toggleTheme));
  applyTheme(document.documentElement.dataset.bsTheme);

  document.getElementById('logoutButton')?.addEventListener('click', async () => {
    try {
      await api('/logout', { method: 'POST' });
    } catch {
      // sign out locally even if the request fails
    }
    clearSession();
    renderLogin('You have been signed out.');
  });
}

function bindShellEvents() {
  if (state.routeBound) return;
  state.routeBound = true;
  window.addEventListener('hashchange', () => {
    if (!state.admin) return;
    const next = routeFromHash();
    if (next === state.route) return;
    state.route = next;
    if (state.admin.mustChangePassword) {
      renderShell();
      return;
    }
    document.querySelectorAll('.admin-nav a').forEach((link) => {
      link.classList.toggle('active', link.dataset.nav === state.route);
    });
    renderRoute();
  });
}

function routeFromHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return raw || 'dashboard';
}

function view() {
  return document.getElementById('adminView');
}

function setPageTitle(title, subtitle = '') {
  const shellMain = document.querySelector('.admin-main');
  if (!shellMain) return;
  let bar = shellMain.querySelector('.admin-topbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'admin-topbar';
    shellMain.prepend(bar);
  }
  bar.innerHTML = `<div><h1>${esc(title)}</h1>${subtitle ? `<div class="admin-hint">${esc(subtitle)}</div>` : ''}</div>
    <span class="spacer"></span>
    <span class="admin-pill"><i class="bi bi-cpu" aria-hidden="true"></i>v${esc(state.meta?.version || '')}</span>`;
}

function loadingView() {
  const el = view();
  if (el) {
    el.innerHTML = `<div class="admin-loading"><div class="admin-spinner" role="status" aria-label="Loading"></div><p class="mb-0">Loading…</p></div>`;
  }
}

function errorView(error) {
  const el = view();
  if (el) {
    el.innerHTML = `<div class="admin-card"><div class="admin-empty">
      <i class="bi bi-exclamation-triangle d-block fs-3 mb-2" aria-hidden="true"></i>
      ${esc(error.message || 'Something went wrong.')}
      <div class="mt-3"><button class="btn btn-brand-soft btn-sm" type="button" id="retryView">Try again</button></div>
    </div></div>`;
    el.querySelector('#retryView')?.addEventListener('click', renderRoute);
  }
}

function renderRoute() {
  if (!state.admin) return;
  if (state.admin.mustChangePassword) {
    renderChangePassword({ forced: true });
    return;
  }
  stopHealthTimer();
  switch (state.route) {
    case 'usage':
      renderUsage();
      break;
    case 'settings':
      renderSettings();
      break;
    case 'health':
      renderHealth();
      break;
    case 'audit':
      renderAudit();
      break;
    case 'password':
      renderChangePassword({ forced: false });
      break;
    default:
      renderDashboard();
  }
}

/* ---------- dashboard ---------- */

function statCard(icon, label, value, hint) {
  return `<div class="stat-card">
    <div class="stat-label"><i class="bi ${icon}" aria-hidden="true"></i>${esc(label)}</div>
    <strong>${esc(value)}</strong>
    ${hint ? `<small>${esc(hint)}</small>` : ''}
  </div>`;
}

function barChart(series, { valueKey = 'count', label = 'scans' } = {}) {
  const values = series.map((item) => Number(item[valueKey] || 0));
  const max = Math.max(1, ...values);
  return `<div class="admin-bars" role="img" aria-label="${esc(label)} chart">
    ${series
      .map((item) => {
        const value = Number(item[valueKey] || 0);
        const height = Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100));
        return `<div class="admin-bar" title="${esc(fmtDay(item.day))}: ${esc(value)} ${esc(label)}">
          <span class="bar-value">${value ? esc(value) : ''}</span>
          <div class="bar-track"><div class="bar-fill" style="height:${height}%"></div></div>
          <small>${esc(fmtDay(item.day))}</small>
        </div>`;
      })
      .join('')}
  </div>`;
}

async function renderDashboard() {
  setPageTitle('Dashboard', 'Latest activity across the public SmartLens AI app.');
  loadingView();
  let data;
  try {
    data = await api('/dashboard');
  } catch (error) {
    errorView(error);
    return;
  }
  state.meta = { version: data.version };
  setPageTitle('Dashboard', 'Latest activity across the public SmartLens AI app.');

  const system = data.system;
  const catMax = Math.max(1, ...data.topCategories.map((item) => item.count));
  const errorsRows = [
    ...data.recentUsageErrors.map((row) => ({
      time: row.created_at,
      source: 'AI usage',
      detail: `${row.kind}${row.model ? ` · ${row.model}` : ''}`,
      code: row.error_code || 'ERROR',
    })),
    ...data.recentErrors.map((row) => ({
      time: row.created_at,
      source: 'Server',
      detail: row.path || '',
      code: row.code || 'ERROR',
    })),
  ]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 8);

  view().innerHTML = `
    <div class="admin-grid stats">
      ${statCard('bi-camera', 'Scans today', fmtNum(data.scans.today), `${fmtNum(data.scans.total)} total`)}
      ${statCard('bi-check2-circle', 'Completed', fmtNum(data.scans.completed), `${fmtNum(data.scans.failed)} failed`)}
      ${statCard('bi-hourglass-split', 'In progress', fmtNum(data.scans.active), `${fmtNum(system.stuckScans)} stuck over 10 min`)}
      ${statCard('bi-currency-dollar', 'AI cost today', fmtCost(data.usage.today.cost), `${fmtNum(data.usage.today.requests)} AI calls`)}
      ${statCard('bi-key', 'Gemini', system.aiConfigured ? 'Configured' : 'Not configured', system.aiConfigured ? `Source: ${system.aiSource}` : 'Scans will fail until a key is added')}
      ${statCard('bi-hdd', 'Stored images', fmtNum(system.storedImages), fmtBytes(system.storageBytes))}
      ${statCard('bi-people', 'Admin sessions', fmtNum(system.activeSessions), 'Active in the last 8 hours')}
      ${statCard('bi-bug', 'Server errors', fmtNum(system.errors24h), 'Last 24 hours')}
    </div>

    <div class="admin-grid two mt-3">
      <section class="admin-card">
        <h2><i class="bi bi-bar-chart-line" aria-hidden="true"></i>Scans (14 days)</h2>
        ${barChart(data.scanSeries)}
      </section>
      <section class="admin-card">
        <h2><i class="bi bi-cash-stack" aria-hidden="true"></i>AI requests (7 days)</h2>
        ${barChart(data.usage.series, { valueKey: 'requests', label: 'requests' })}
      </section>
    </div>

    <div class="admin-grid two mt-3">
      <section class="admin-card">
        <h2><i class="bi bi-collection" aria-hidden="true"></i>Top categories</h2>
        ${
          data.topCategories.length
            ? `<div class="admin-list">${data.topCategories
                .map(
                  (item) => `
              <div class="admin-list-row">
                <span class="name"><i class="bi ${esc(item.icon || 'bi-collection')}" aria-hidden="true"></i>${esc(item.name_en)}</span>
                <span class="track"><span style="width:${Math.round((item.count / catMax) * 100)}%"></span></span>
                <span class="count">${fmtNum(item.count)}</span>
              </div>`,
                )
                .join('')}</div>`
            : '<div class="admin-empty">No categorized scans yet.</div>'
        }
      </section>
      <section class="admin-card">
        <h2><i class="bi bi-activity" aria-hidden="true"></i>System status</h2>
        <div class="admin-list">
          <div class="admin-list-row"><span class="name"><i class="bi bi-database" aria-hidden="true"></i>AI analysis</span>
            <span class="admin-pill ${system.aiConfigured ? 'ok' : 'bad'}">${system.aiConfigured ? 'Ready' : 'Not configured'}</span></div>
          <div class="admin-list-row"><span class="name"><i class="bi bi-tools" aria-hidden="true"></i>Maintenance</span>
            <span class="admin-pill ${system.maintenanceMode ? 'warn' : 'ok'}">${system.maintenanceMode ? 'Enabled' : 'Off'}</span></div>
          <div class="admin-list-row"><span class="name"><i class="bi bi-tag" aria-hidden="true"></i>App version</span>
            <span class="admin-pill">${esc(system.appVersion)}</span></div>
          <div class="admin-list-row"><span class="name"><i class="bi bi-shield-check" aria-hidden="true"></i>Uptime checks</span>
            <span class="admin-pill ${system.stuckScans ? 'warn' : 'ok'}">${system.stuckScans ? `${system.stuckScans} stalled scan(s)` : 'Healthy'}</span></div>
        </div>
        <div class="admin-actions">
          <a class="btn btn-brand-soft btn-sm" href="#/health">Open system health</a>
          <a class="btn btn-brand-soft btn-sm" href="#/settings">Manage settings</a>
        </div>
      </section>
    </div>

    <section class="admin-card mt-3">
      <h2><i class="bi bi-exclamation-octagon" aria-hidden="true"></i>Recent errors</h2>
      ${
        errorsRows.length
          ? `<div class="admin-table-wrap"><table class="admin-table">
              <thead><tr><th>When</th><th>Source</th><th>Detail</th><th>Code</th></tr></thead>
              <tbody>${errorsRows
                .map(
                  (row) => `<tr>
                    <td class="mono">${esc(fmtDate(row.time))}</td>
                    <td>${esc(row.source)}</td>
                    <td>${esc(row.detail)}</td>
                    <td><span class="admin-pill bad">${esc(row.code)}</span></td>
                  </tr>`,
                )
                .join('')}</tbody>
            </table></div>`
          : '<div class="admin-empty">No recent errors. Good sign.</div>'
      }
    </section>`;
}

/* ---------- usage ---------- */

async function renderUsage() {
  setPageTitle('AI usage', 'Token usage and estimated cost. Figures come from recorded API calls.');
  loadingView();
  let data;
  try {
    data = await api(`/usage?days=${state.usageDays}`);
  } catch (error) {
    errorView(error);
    return;
  }

  const chartMax = Math.max(1, ...data.series.map((row) => Number(row.cost || 0)));
  view().innerHTML = `
    <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
      <label class="small muted" for="usageDays">Period</label>
      <select id="usageDays" class="form-select form-select-sm" style="max-width:160px">
        ${[7, 30, 90, 365].map((days) => `<option value="${days}" ${days === state.usageDays ? 'selected' : ''}>Last ${days} days</option>`).join('')}
      </select>
    </div>

    <div class="admin-grid stats">
      ${statCard('bi-stars', 'AI requests', fmtNum(data.totals.requests), `${fmtNum(data.totals.errors)} errors`)}
      ${statCard('bi-box-arrow-in-down', 'Input tokens', fmtNum(data.totals.tokensIn), 'Sent to the model')}
      ${statCard('bi-box-arrow-up', 'Output tokens', fmtNum(data.totals.tokensOut), 'Generated by the model')}
      ${statCard('bi-currency-dollar', 'Estimated cost', fmtCost(data.totals.cost), 'Based on configured rates')}
    </div>

    <section class="admin-card mt-3">
      <h2><i class="bi bi-graph-up" aria-hidden="true"></i>Daily cost</h2>
      <div class="admin-bars" role="img" aria-label="Daily cost chart">
        ${data.series
          .map((row) => {
            const height = Math.round((Number(row.cost || 0) / chartMax) * 100);
            return `<div class="admin-bar" title="${esc(fmtDay(row.day))}: ${esc(fmtCost(row.cost))}">
              <div class="bar-track"><div class="bar-fill" style="height:${Math.max(Number(row.cost) > 0 ? 3 : 0, height)}%"></div></div>
              <small>${esc(fmtDay(row.day))}</small>
            </div>`;
          })
          .join('')}
      </div>
    </section>

    <div class="admin-grid two mt-3">
      <section class="admin-card">
        <h2><i class="bi bi-pie-chart" aria-hidden="true"></i>By feature</h2>
        ${
          data.byKind.length
            ? `<div class="admin-table-wrap"><table class="admin-table">
                <thead><tr><th>Feature</th><th>Requests</th><th>Input</th><th>Output</th><th>Cost</th><th>Errors</th></tr></thead>
                <tbody>${data.byKind
                  .map(
                    (row) => `<tr>
                      <td class="text-capitalize">${esc(row.kind)}</td>
                      <td class="mono">${fmtNum(row.requests)}</td>
                      <td class="mono">${fmtNum(row.tokensIn)}</td>
                      <td class="mono">${fmtNum(row.tokensOut)}</td>
                      <td class="mono">${fmtCost(row.cost)}</td>
                      <td class="mono">${fmtNum(row.errors)}</td>
                    </tr>`,
                  )
                  .join('')}</tbody>
              </table></div>`
            : '<div class="admin-empty">No AI usage recorded for this period.</div>'
        }
      </section>
      <section class="admin-card">
        <h2><i class="bi bi-cpu" aria-hidden="true"></i>By model</h2>
        ${
          data.byModel.length
            ? `<div class="admin-table-wrap"><table class="admin-table">
                <thead><tr><th>Model</th><th>Requests</th><th>Cost</th></tr></thead>
                <tbody>${data.byModel
                  .map(
                    (row) => `<tr>
                      <td class="mono">${esc(row.model)}</td>
                      <td class="mono">${fmtNum(row.requests)}</td>
                      <td class="mono">${fmtCost(row.cost)}</td>
                    </tr>`,
                  )
                  .join('')}</tbody>
              </table></div>`
            : '<div class="admin-empty">No model usage recorded for this period.</div>'
        }
      </section>
    </div>

    <section class="admin-card mt-3">
      <h2><i class="bi bi-exclamation-triangle" aria-hidden="true"></i>Failed AI calls</h2>
      ${
        data.errors.length
          ? `<div class="admin-table-wrap"><table class="admin-table">
              <thead><tr><th>When</th><th>Kind</th><th>Model</th><th>Code</th><th>Latency</th></tr></thead>
              <tbody>${data.errors
                .map(
                  (row) => `<tr>
                    <td class="mono">${esc(fmtDate(row.created_at))}</td>
                    <td>${esc(row.kind)}</td>
                    <td class="mono">${esc(row.model || '—')}</td>
                    <td><span class="admin-pill bad">${esc(row.error_code || 'ERROR')}</span></td>
                    <td class="mono">${row.latency_ms ? `${fmtNum(row.latency_ms)} ms` : '—'}</td>
                  </tr>`,
                )
                .join('')}</tbody>
            </table></div>`
          : '<div class="admin-empty">No failed AI calls recorded.</div>'
      }
    </section>`;

  document.getElementById('usageDays')?.addEventListener('change', (event) => {
    state.usageDays = Number(event.target.value) || 30;
    renderUsage();
  });
}

/* ---------- settings ---------- */

const SETTINGS_TABS = [
  ['branding', 'Branding'],
  ['ai', 'AI'],
  ['limits', 'Limits & upload'],
  ['features', 'Features & privacy'],
  ['system', 'System & retention'],
  ['cost', 'Cost rates'],
];

function inputField({ id, label, value, type = 'text', hint = '', attrs = '' }) {
  return `<div>
    <label class="form-label small fw-semibold" for="${id}">${esc(label)}</label>
    <input id="${id}" name="${id}" type="${type}" class="form-control form-control-sm" value="${esc(value)}" ${attrs} />
    ${hint ? `<div class="admin-hint">${esc(hint)}</div>` : ''}
  </div>`;
}

function numberField({ id, label, value, min, max, hint = '' }) {
  return inputField({ id, label, value, type: 'number', hint, attrs: `min="${min}" max="${max}" step="1"` });
}

function checkField({ id, label, checked, hint = '' }) {
  return `<div class="form-check mt-2">
    <input class="form-check-input" type="checkbox" id="${id}" name="${id}" ${checked ? 'checked' : ''} />
    <label class="form-check-label small" for="${id}">${esc(label)}</label>
    ${hint ? `<div class="admin-hint">${esc(hint)}</div>` : ''}
  </div>`;
}

function renderSettings() {
  setPageTitle('Settings', 'Configuration changes are applied immediately and recorded in the audit log.');
  if (!state.settings) {
    loadingView();
    api('/settings')
      .then(async (data) => {
        state.settings = data.settings;
        state.meta = data.meta;
        renderSettings();
        if (!state.meta?.version) {
          try {
            const dash = await api('/dashboard');
            state.meta = { ...(state.meta || {}), version: dash.version };
            setPageTitle('Settings', 'Configuration changes are applied immediately and recorded in the audit log.');
          } catch {
            // non-critical
          }
        }
      })
      .catch(errorView);
    return;
  }

  const settings = state.settings;
  const { branding, ai, limits, upload, features, privacy, system, retention, cost } = settings;

  view().innerHTML = `
    <div class="admin-tabs" role="tablist">
      ${SETTINGS_TABS.map(
        ([key, label]) =>
          `<button type="button" role="tab" data-settings-tab="${key}" class="${state.settingsTab === key ? 'active' : ''}">${esc(label)}</button>`,
      ).join('')}
    </div>
    <div id="settingsPane"></div>`;

  const pane = document.getElementById('settingsPane');

  const paint = () => {
    pane.innerHTML =
      state.settingsTab === 'branding'
        ? `<form class="admin-card" id="brandingForm" novalidate>
            ${sectionNote('Publicly visible in the app header, footer and share cards.')}
            <div class="admin-form-grid">
              ${inputField({ id: 'brandTitle', label: 'App title', value: branding.title, attrs: 'maxlength="80" required' })}
              ${inputField({ id: 'brandTagline', label: 'Tagline', value: branding.tagline, attrs: 'maxlength="160"' })}
              ${inputField({ id: 'brandOrganization', label: 'Organization', value: branding.organization, attrs: 'maxlength="120"' })}
              ${inputField({ id: 'brandEmail', label: 'Contact email', value: branding.contactEmail, type: 'email', attrs: 'maxlength="160"' })}
              ${inputField({ id: 'brandPhone', label: 'Contact phone', value: branding.contactPhone, attrs: 'maxlength="40"' })}
              ${inputField({ id: 'brandPrimary', label: 'Primary color', value: branding.theme?.primary, type: 'text', attrs: 'pattern="#[0-9a-fA-F]{6}" maxlength="7" placeholder="#0f9d76"' })}
              ${inputField({ id: 'brandAccent', label: 'Accent color', value: branding.theme?.accent, attrs: 'pattern="#[0-9a-fA-F]{6}" maxlength="7" placeholder="#0f766e"' })}
              ${inputField({ id: 'brandLogo', label: 'Logo URL', value: branding.logoUrl, hint: 'Optional. Use an https:// or root-relative URL.', attrs: 'maxlength="500"' })}
              ${inputField({ id: 'brandFavicon', label: 'Favicon URL', value: branding.faviconUrl, hint: 'Optional. Use an https:// or root-relative URL.', attrs: 'maxlength="500"' })}
            </div>
            <div class="admin-actions"><button type="submit" class="btn btn-brand btn-sm">Save branding</button></div>
          </form>`
        : state.settingsTab === 'ai'
          ? `<form class="admin-card" id="aiForm" novalidate>
              ${sectionNote(
                ai.hasApiKey
                  ? `A Gemini API key is configured (source: ${ai.apiKeySource}). The key itself is never displayed. Leave the field blank to keep it.`
                  : 'No Gemini API key is configured. Image analysis and follow-up chat will fail until one is saved here or set in the server environment.',
              )}
              <div class="admin-form-grid">
                ${inputField({ id: 'aiVisionModel', label: 'Vision model', value: ai.visionModel, hint: 'Gemini model ID, for example gemini-2.5-flash or gemini-2.5-pro.', attrs: 'maxlength="80" required' })}
                ${inputField({ id: 'aiTextModel', label: 'Text model', value: ai.textModel, hint: 'Gemini model ID used for chat and learning mode.', attrs: 'maxlength="80" required' })}
                ${numberField({ id: 'aiMaxTokens', label: 'Max output tokens', value: ai.maxOutputTokens, min: 100, max: 8000 })}
                ${numberField({ id: 'aiVisionTimeout', label: 'Vision timeout (ms)', value: ai.visionTimeoutMs, min: 5000, max: 120000 })}
                ${numberField({ id: 'aiChatTimeout', label: 'Chat timeout (ms)', value: ai.chatTimeoutMs, min: 5000, max: 120000 })}
                ${numberField({ id: 'aiLearningTimeout', label: 'Learning timeout (ms)', value: ai.learningTimeoutMs, min: 5000, max: 120000 })}
                <div class="full">
                  <label class="form-label small fw-semibold" for="aiApiKey">Replace Gemini API key</label>
                  <input id="aiApiKey" name="aiApiKey" type="password" class="form-control form-control-sm" autocomplete="new-password" placeholder="AIza… (leave blank to keep the current key)" maxlength="400" />
                  <div class="admin-hint">Keys are encrypted at rest and never sent back to the browser.</div>
                </div>
              </div>
              ${checkField({ id: 'aiClearKey', label: 'Remove the stored API key', hint: 'The environment key, if any, will still be used.' })}
              <div class="admin-actions"><button type="submit" class="btn btn-brand btn-sm">Save AI settings</button></div>
            </form>`
        : state.settingsTab === 'limits'
          ? `<div class="admin-grid">
              <form class="admin-card" id="limitsForm" novalidate>
                <h2><i class="bi bi-speedometer" aria-hidden="true"></i>Rate limits</h2>
                <div class="admin-form-grid">
                  ${numberField({ id: 'limitDailyScans', label: 'Scans per day per session', value: limits.dailyScans, min: 1, max: 1000 })}
                  ${numberField({ id: 'limitScanPerMinute', label: 'Scans per minute', value: limits.scanPerMinute, min: 1, max: 120 })}
                  ${numberField({ id: 'limitChatPerMinute', label: 'Chat messages per minute', value: limits.chatPerMinute, min: 1, max: 240 })}
                  ${numberField({ id: 'limitReanalyze', label: 'Reanalysis per minute', value: limits.reanalyzePerMinute, min: 1, max: 60 })}
                </div>
                <div class="admin-actions"><button type="submit" class="btn btn-brand btn-sm">Save limits</button></div>
              </form>
              <form class="admin-card" id="uploadForm" novalidate>
                <h2><i class="bi bi-cloud-arrow-up" aria-hidden="true"></i>Upload rules</h2>
                <div class="admin-form-grid">
                  ${numberField({ id: 'uploadMaxSize', label: 'Maximum file size (MB)', value: upload.maxSizeMb, min: 1, max: 50 })}
                  ${numberField({ id: 'uploadMaxDimension', label: 'Maximum dimension (px)', value: upload.maxDimension, min: 256, max: 4096 })}
                </div>
                <div class="mt-3">
                  <span class="form-label small fw-semibold d-block">Allowed image types</span>
                  ${['image/jpeg', 'image/png', 'image/webp']
                    .map(
                      (mime) => `<div class="form-check form-check-inline">
                        <input class="form-check-input" type="checkbox" id="type${mime.replace(/\W/g, '')}" data-upload-type="${mime}" ${(upload.allowedTypes || []).includes(mime) ? 'checked' : ''} />
                        <label class="form-check-label small" for="type${mime.replace(/\W/g, '')}">${mime.replace('image/', '').toUpperCase()}</label>
                      </div>`,
                    )
                    .join('')}
                </div>
                <div class="admin-actions"><button type="submit" class="btn btn-brand btn-sm">Save upload rules</button></div>
              </form>
            </div>`
        : state.settingsTab === 'features'
          ? `<div class="admin-grid">
              <form class="admin-card" id="featuresForm" novalidate>
                <h2><i class="bi bi-toggles" aria-hidden="true"></i>Features</h2>
                ${checkField({ id: 'featureLearning', label: 'Learning mode', checked: features.learningMode })}
                ${checkField({ id: 'featurePdf', label: 'PDF export', checked: features.pdfExport })}
                ${checkField({
                  id: 'featurePush',
                  label: 'Push notifications',
                  checked: features.pushNotifications,
                  hint: 'Requires VAPID keys on the server.',
                })}
                <div class="admin-actions"><button type="submit" class="btn btn-brand btn-sm">Save features</button></div>
              </form>
              <form class="admin-card" id="privacyForm" novalidate>
                <h2><i class="bi bi-shield-lock" aria-hidden="true"></i>Privacy disclosure</h2>
                <div class="mb-3">
                  <label class="form-label small fw-semibold" for="privacyDisclosure">Disclosure shown to visitors</label>
                  <textarea id="privacyDisclosure" class="form-control form-control-sm" rows="6" maxlength="2000">${esc(privacy.disclosure)}</textarea>
                </div>
                ${numberField({ id: 'privacyRetention', label: 'Displayed retention window (days)', value: privacy.retentionDays, min: 1, max: 3650 })}
                <div class="admin-actions"><button type="submit" class="btn btn-brand btn-sm">Save privacy</button></div>
              </form>
            </div>`
        : state.settingsTab === 'system'
          ? `<div class="admin-grid">
              <form class="admin-card" id="systemForm" novalidate>
                <h2><i class="bi bi-tools" aria-hidden="true"></i>Maintenance</h2>
                ${checkField({ id: 'maintenanceMode', label: 'Enable maintenance mode', checked: system.maintenanceMode, hint: 'Public scan, chat and learning endpoints return a maintenance notice. The admin console stays available.' })}
                <div class="mt-3">
                  <label class="form-label small fw-semibold" for="maintenanceMessage">Maintenance message</label>
                  <textarea id="maintenanceMessage" class="form-control form-control-sm" rows="3" maxlength="300">${esc(system.maintenanceMessage)}</textarea>
                </div>
                ${inputField({ id: 'appVersion', label: 'Displayed app version', value: system.appVersion, attrs: 'maxlength="20"' })}
                <div class="admin-actions"><button type="submit" class="btn btn-brand btn-sm">Save system</button></div>
              </form>
              <form class="admin-card" id="retentionForm" novalidate>
                <h2><i class="bi bi-calendar-x" aria-hidden="true"></i>Retention</h2>
                <div class="admin-hint mb-2">Retention values are used by the scheduled cleanup task.</div>
                <div class="admin-form-grid">
                  ${numberField({ id: 'retentionScans', label: 'Scan retention (days)', value: retention.scanDays, min: 1, max: 3650 })}
                  ${numberField({ id: 'retentionUsage', label: 'Usage logs (days)', value: retention.usageLogDays, min: 1, max: 3650 })}
                  ${numberField({ id: 'retentionErrors', label: 'Error logs (days)', value: retention.errorLogDays, min: 1, max: 3650 })}
                </div>
                <div class="admin-actions"><button type="submit" class="btn btn-brand btn-sm">Save retention</button></div>
              </form>
            </div>`
        : `<form class="admin-card" id="costForm" novalidate>
            ${sectionNote('Used to estimate spend from token counts. These are not billing statements.')}
            <div class="admin-form-grid">
              ${inputField({ id: 'costVisionIn', label: 'Vision input per 1M tokens', value: cost.visionInputPer1M, type: 'number', attrs: 'min="0" max="1000" step="0.01"' })}
              ${inputField({ id: 'costVisionOut', label: 'Vision output per 1M tokens', value: cost.visionOutputPer1M, type: 'number', attrs: 'min="0" max="1000" step="0.01"' })}
              ${inputField({ id: 'costTextIn', label: 'Text input per 1M tokens', value: cost.textInputPer1M, type: 'number', attrs: 'min="0" max="1000" step="0.01"' })}
              ${inputField({ id: 'costTextOut', label: 'Text output per 1M tokens', value: cost.textOutputPer1M, type: 'number', attrs: 'min="0" max="1000" step="0.01"' })}
              ${inputField({ id: 'costCurrency', label: 'Currency code', value: cost.currency, attrs: 'maxlength="3"' })}
            </div>
            <div class="admin-actions"><button type="submit" class="btn btn-brand btn-sm">Save cost rates</button></div>
          </form>`;

    bindSettingsForms();
  };

  const sectionNote = (text) => `<div class="admin-section-note">${esc(text)}</div>`;

  document.querySelectorAll('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.settingsTab = button.dataset.settingsTab;
      document.querySelectorAll('[data-settings-tab]').forEach((b) => b.classList.toggle('active', b === button));
      paint();
    });
  });

  paint();
}

function bindSettingsForms() {
  document.getElementById('brandingForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings('branding', {
      branding: {
        title: valueOf('brandTitle'),
        tagline: valueOf('brandTagline'),
        organization: valueOf('brandOrganization'),
        contactEmail: valueOf('brandEmail'),
        contactPhone: valueOf('brandPhone'),
        theme: { primary: valueOf('brandPrimary'), accent: valueOf('brandAccent') },
        logoUrl: valueOf('brandLogo'),
        faviconUrl: valueOf('brandFavicon'),
      },
    });
  });

  document.getElementById('aiForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const patch = {
      visionModel: valueOf('aiVisionModel'),
      textModel: valueOf('aiTextModel'),
      maxOutputTokens: numberOf('aiMaxTokens'),
      visionTimeoutMs: numberOf('aiVisionTimeout'),
      chatTimeoutMs: numberOf('aiChatTimeout'),
      learningTimeoutMs: numberOf('aiLearningTimeout'),
    };
    const key = valueOf('aiApiKey');
    if (key) patch.apiKey = key;
    if (document.getElementById('aiClearKey')?.checked) patch.clearApiKey = true;
    saveSettings('ai', { ai: patch });
  });

  document.getElementById('limitsForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings('limits', {
      limits: {
        dailyScans: numberOf('limitDailyScans'),
        scanPerMinute: numberOf('limitScanPerMinute'),
        chatPerMinute: numberOf('limitChatPerMinute'),
        reanalyzePerMinute: numberOf('limitReanalyze'),
      },
    });
  });

  document.getElementById('uploadForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const allowedTypes = [...document.querySelectorAll('[data-upload-type]:checked')].map((el) => el.dataset.uploadType);
    saveSettings('upload', {
      upload: {
        maxSizeMb: numberOf('uploadMaxSize'),
        maxDimension: numberOf('uploadMaxDimension'),
        allowedTypes,
      },
    });
  });

  document.getElementById('featuresForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings('features', {
      features: {
        learningMode: checkedOf('featureLearning'),
        pdfExport: checkedOf('featurePdf'),
        pushNotifications: checkedOf('featurePush'),
      },
    });
  });

  document.getElementById('privacyForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings('privacy', {
      privacy: {
        disclosure: document.getElementById('privacyDisclosure')?.value.trim(),
        retentionDays: numberOf('privacyRetention'),
      },
    });
  });

  document.getElementById('systemForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings('system', {
      system: {
        maintenanceMode: checkedOf('maintenanceMode'),
        maintenanceMessage: document.getElementById('maintenanceMessage')?.value.trim(),
        appVersion: valueOf('appVersion'),
      },
    });
  });

  document.getElementById('retentionForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings('retention', {
      retention: {
        scanDays: numberOf('retentionScans'),
        usageLogDays: numberOf('retentionUsage'),
        errorLogDays: numberOf('retentionErrors'),
      },
    });
  });

  document.getElementById('costForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings('cost', {
      cost: {
        visionInputPer1M: numberOf('costVisionIn'),
        visionOutputPer1M: numberOf('costVisionOut'),
        textInputPer1M: numberOf('costTextIn'),
        textOutputPer1M: numberOf('costTextOut'),
        currency: valueOf('costCurrency').toUpperCase(),
      },
    });
  });
}

function valueOf(id) {
  return document.getElementById(id)?.value.trim() ?? '';
}

function numberOf(id) {
  const value = Number(document.getElementById(id)?.value);
  return Number.isFinite(value) ? value : undefined;
}

function checkedOf(id) {
  return Boolean(document.getElementById(id)?.checked);
}

async function saveSettings(section, payload) {
  const form = document.querySelector(`#settingsPane form`);
  const button = form?.querySelector('button[type=submit]');
  if (button) button.disabled = true;
  try {
    const data = await api('/settings', { method: 'PUT', body: payload });
    state.settings = data;
    toast('Settings saved.', 'success');
    renderSettings();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

/* ---------- health ---------- */

function healthPill(ok, okText = 'OK', badText = 'Attention') {
  return `<span class="admin-pill ${ok ? 'ok' : 'bad'}">${ok ? okText : badText}</span>`;
}

async function renderHealth({ background = false } = {}) {
  if (!background) {
    setPageTitle('System health', 'Live checks for database, storage, AI configuration and process health.');
    loadingView();
  }
  let data;
  try {
    data = await api('/system-health');
  } catch (error) {
    if (!background) errorView(error);
    return;
  }
  if (state.route !== 'health') return;

  view().innerHTML = `
    <div class="admin-grid stats">
      ${statCard('bi-plug', 'Database', data.database.ok ? 'Online' : 'Offline', data.database.latencyMs != null ? `${data.database.latencyMs} ms round trip` : 'No response')}
      ${statCard('bi-hdd-stack', 'Storage', data.storage.ok ? 'Writable' : 'Unavailable', `Provider: ${data.storage.provider}`)}
      ${statCard('bi-stars', 'AI service', data.ai.configured ? 'Configured' : 'Missing key', `Source: ${data.ai.source}`)}
      ${statCard('bi-clock-history', 'Uptime', duration(data.process.uptimeSeconds), `Node ${data.process.nodeVersion}`)}
      ${statCard('bi-memory', 'Memory', `${fmtNum(data.process.memoryRssMb)} MB`, `${fmtNum(data.process.memoryHeapMb)} MB heap`)}
      ${statCard('bi-exclamation-triangle', 'Errors (24h)', fmtNum(data.errors24h), `${fmtNum(data.stuckScans)} stalled scan(s)`)}
    </div>

    <div class="admin-grid two mt-3">
      <section class="admin-card">
        <h2><i class="bi bi-clipboard-check" aria-hidden="true"></i>Checks</h2>
        <div class="admin-list">
          <div class="admin-list-row"><span class="name"><i class="bi bi-database" aria-hidden="true"></i>Database</span>${healthPill(data.checks.database)}</div>
          <div class="admin-list-row"><span class="name"><i class="bi bi-folder" aria-hidden="true"></i>Storage</span>${healthPill(data.checks.storage)}</div>
          <div class="admin-list-row"><span class="name"><i class="bi bi-robot" aria-hidden="true"></i>Gemini key</span>${healthPill(data.checks.ai, 'Ready', 'Not configured')}</div>
          <div class="admin-list-row"><span class="name"><i class="bi bi-tools" aria-hidden="true"></i>Maintenance off</span>${healthPill(data.checks.maintenanceOff, 'Normal', 'Maintenance mode')}</div>
          <div class="admin-list-row"><span class="name"><i class="bi bi-hourglass" aria-hidden="true"></i>No stalled scans</span>${healthPill(data.stuckScans === 0, 'Clear', `${data.stuckScans} stalled`)}</div>
        </div>
        <div class="admin-actions"><button class="btn btn-brand-soft btn-sm" type="button" id="refreshHealth">Refresh now</button></div>
      </section>
      <section class="admin-card">
        <h2><i class="bi bi-info-circle" aria-hidden="true"></i>Environment</h2>
        <div class="admin-table-wrap"><table class="admin-table">
          <tbody>
            <tr><th scope="row">Overall</th><td><span class="admin-pill ${data.status === 'ok' ? 'ok' : 'warn'}">${esc(data.status)}</span></td></tr>
            <tr><th scope="row">Environment</th><td>${esc(data.environment)}</td></tr>
            <tr><th scope="row">Version</th><td>${esc(data.version)}</td></tr>
            <tr><th scope="row">Platform</th><td>${esc(data.process.platform)}</td></tr>
            <tr><th scope="row">Active admin sessions</th><td class="mono">${fmtNum(data.activeSessions)}</td></tr>
            <tr><th scope="row">Scans stored</th><td class="mono">${fmtNum(data.scans.total)}</td></tr>
            <tr><th scope="row">Images stored</th><td class="mono">${fmtNum(data.storageTotals.images)} · ${esc(fmtBytes(data.storageTotals.bytes))}</td></tr>
            <tr><th scope="row">Maintenance</th><td>${data.maintenance.enabled ? `Enabled — ${esc(data.maintenance.message)}` : 'Off'}</td></tr>
            <tr><th scope="row">Checked at</th><td class="mono">${esc(fmtDate(data.checkedAt))}</td></tr>
          </tbody>
        </table></div>
      </section>
    </div>
    <p class="admin-hint mt-2">Refreshes automatically every 30 seconds while this page is open.</p>`;

  document.getElementById('refreshHealth')?.addEventListener('click', () => renderHealth());
  stopHealthTimer();
  state.healthTimer = setInterval(() => {
    if (state.route !== 'health') {
      stopHealthTimer();
      return;
    }
    renderHealth({ background: true });
  }, 30000);
}

function stopHealthTimer() {
  if (state.healthTimer) {
    clearInterval(state.healthTimer);
    state.healthTimer = null;
  }
}

/* ---------- audit ---------- */

async function renderAudit({ append = false } = {}) {
  if (!append) {
    setPageTitle('Audit logs', 'Administrator actions recorded by the server.');
    loadingView();
    state.audit = { items: [], before: null, action: state.audit.action || '' };
  }
  let data;
  try {
    const params = new URLSearchParams({ limit: '50' });
    if (state.audit.action) params.set('action', state.audit.action);
    if (append && state.audit.before) params.set('before', state.audit.before);
    data = await api(`/audit-logs?${params.toString()}`);
  } catch (error) {
    errorView(error);
    return;
  }
  if (state.route !== 'audit') return;

  if (append) state.audit.items = [...state.audit.items, ...data.items];
  else state.audit.items = data.items;
  state.audit.before = data.nextBefore;
  state.audit.actions = data.actions;

  if (append) {
    const tbody = document.getElementById('auditBody');
    if (tbody) tbody.insertAdjacentHTML('beforeend', state.audit.items.slice(-data.items.length).map(auditRow).join(''));
    const loadMore = document.getElementById('auditMore');
    if (loadMore) loadMore.disabled = !state.audit.before;
    return;
  }

  view().innerHTML = `
    <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
      <label class="small muted" for="auditAction">Action</label>
      <select id="auditAction" class="form-select form-select-sm" style="max-width:230px">
        <option value="">All actions</option>
        ${(data.actions || [])
          .map((action) => `<option value="${esc(action)}" ${action === state.audit.action ? 'selected' : ''}>${esc(action)}</option>`)
          .join('')}
      </select>
      <span class="spacer flex-grow-1"></span>
      <span class="admin-pill">${fmtNum(state.audit.items.length)} shown</span>
    </div>
    <section class="admin-card">
      <div class="admin-table-wrap"><table class="admin-table">
        <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Entity</th><th>Metadata</th></tr></thead>
        <tbody id="auditBody">${state.audit.items.map(auditRow).join('')}</tbody>
      </table></div>
      ${state.audit.items.length === 0 ? '<div class="admin-empty">No audit entries yet.</div>' : ''}
      <div class="admin-actions">
        <button class="btn btn-brand-soft btn-sm" type="button" id="auditMore" ${state.audit.before ? '' : 'disabled'}>Load older</button>
      </div>
    </section>`;

  document.getElementById('auditAction')?.addEventListener('change', (event) => {
    state.audit.action = event.target.value;
    state.audit.before = null;
    renderAudit();
  });
  document.getElementById('auditMore')?.addEventListener('click', (event) => {
    event.currentTarget.disabled = true;
    renderAudit({ append: true });
  });
}

function auditRow(row) {
  let metadata = '';
  if (row.metadata) {
    try {
      const parsed = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      metadata = JSON.stringify(parsed);
    } catch {
      metadata = String(row.metadata);
    }
  }
  return `<tr>
    <td class="mono">${esc(fmtDate(row.created_at))}</td>
    <td>${esc(row.username || '—')}</td>
    <td><span class="admin-pill">${esc(row.action)}</span></td>
    <td>${row.entity ? `${esc(row.entity)}${row.entity_id ? `<br><span class="muted small mono">${esc(row.entity_id)}</span>` : ''}` : '—'}</td>
    <td class="mono" style="max-width:320px;overflow-wrap:anywhere">${esc(metadata || '—')}</td>
  </tr>`;
}

/* ---------- password ---------- */

function renderChangePassword({ forced = false } = {}) {
  stopHealthTimer();
  document.title = forced ? 'Set a new password · SmartLens AI Administrator' : 'Change password · SmartLens AI';
  view().innerHTML = `
    <section class="admin-card" style="max-width:560px">
      <h2><i class="bi bi-key" aria-hidden="true"></i>${forced ? 'Set a new password' : 'Change password'}</h2>
      ${
        forced
          ? '<div class="admin-section-note">The initial administrator password must be replaced before the console can be used.</div>'
          : ''
      }
      <div id="passwordError" class="alert alert-danger py-2 px-3 small d-none" role="alert"></div>
      <form id="passwordForm" novalidate>
        <div class="mb-3">
          <label class="form-label small fw-semibold" for="currentPassword">Current password</label>
          <input id="currentPassword" type="password" class="form-control form-control-sm" autocomplete="current-password" required maxlength="200" />
        </div>
        <div class="mb-3">
          <label class="form-label small fw-semibold" for="newPassword">New password</label>
          <input id="newPassword" type="password" class="form-control form-control-sm" autocomplete="new-password" required minlength="12" maxlength="200" />
          <div class="admin-hint">At least 12 characters. Use a unique passphrase.</div>
        </div>
        <div class="mb-4">
          <label class="form-label small fw-semibold" for="confirmPassword">Confirm new password</label>
          <input id="confirmPassword" type="password" class="form-control form-control-sm" autocomplete="new-password" required minlength="12" maxlength="200" />
        </div>
        <div class="admin-actions">
          ${forced ? '' : '<a class="btn btn-outline-secondary btn-sm" href="#/dashboard">Cancel</a>'}
          <button type="submit" class="btn btn-brand btn-sm" id="passwordButton">Update password</button>
        </div>
      </form>
    </section>`;

  document.getElementById('passwordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = document.getElementById('passwordError');
    const button = document.getElementById('passwordButton');
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    errorBox.classList.add('d-none');
    if (newPassword.length < 12) {
      errorBox.textContent = 'The new password must be at least 12 characters.';
      errorBox.classList.remove('d-none');
      return;
    }
    if (newPassword !== confirmPassword) {
      errorBox.textContent = 'The new passwords do not match.';
      errorBox.classList.remove('d-none');
      return;
    }
    button.disabled = true;
    try {
      await api('/password', { method: 'POST', body: { currentPassword, newPassword } });
      state.admin.mustChangePassword = false;
      toast('Password updated. Other admin sessions were signed out.', 'success');
      if (forced) {
        renderShell();
      } else {
        location.hash = '#/dashboard';
        renderShell();
      }
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('d-none');
      button.disabled = false;
    }
  });
}

/* ---------- boot ---------- */

async function boot() {
  initTheme();
  if (!state.csrf) state.csrf = csrfFromCookie();
  if (!state.csrf) {
    renderLogin();
    return;
  }
  try {
    const data = await api('/me');
    setSession(data.admin, data.csrf);
    renderShell();
  } catch (error) {
    if (error.status !== 401) {
      renderLogin('Could not reach the administrator service. Please try again.');
      return;
    }
    // api() already rendered the login view for 401 responses
  }
}

boot();
