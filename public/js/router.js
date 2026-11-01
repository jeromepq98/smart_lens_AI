import { setNavActive, errorMessage, escapeHtml } from './ui.js';
import { t } from './i18n.js';

let routes = {};
let container = null;
let token = 0;

export function parseRoute(hash = window.location.hash) {
  const raw = hash.replace(/^#/, '') || '/scan';
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart || '');

  if (segments.length === 0) return { name: 'scan', params: {}, query };

  const [first, second] = segments;
  if (first === 'result' && second) {
    return { name: 'result', params: { id: decodeURIComponent(second) }, query };
  }

  const known = ['scan', 'history', 'favorites', 'learning', 'settings'];
  if (known.includes(first)) return { name: first, params: {}, query };
  return { name: 'scan', params: {}, query };
}

export function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (window.location.hash === target) {
    renderCurrent({ force: true });
    return;
  }
  if (replace) {
    history.replaceState(null, '', target);
    renderCurrent({ force: true });
    return;
  }
  window.location.hash = target;
}

export async function renderCurrent({ force = false } = {}) {
  if (!container) return;
  const route = parseRoute();
  const handler = routes[route.name] || routes.scan;
  if (!handler) return;

  const currentToken = ++token;
  setNavActive(route.name);
  document.body.dataset.route = route.name;

  if (!force) window.scrollTo({ top: 0, behavior: 'auto' });

  try {
    await handler(container, route.params, route.query);
  } catch (error) {
    if (currentToken !== token) return;
    console.error('Route render failed', error);
    container.innerHTML = `
      <section class="section-card">
        <div class="empty-state">
          <div class="empty-icon"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i></div>
          <h2>${escapeHtml(t('error.generic'))}</h2>
          <p>${escapeHtml(errorMessage(error))}</p>
          <button type="button" class="btn btn-brand" id="routeRetry">${escapeHtml(t('common.retry'))}</button>
        </div>
      </section>`;
    container.querySelector('#routeRetry')?.addEventListener('click', () => renderCurrent({ force: true }));
  }
}

export function startRouter(appContainer, routeMap) {
  container = appContainer;
  routes = routeMap;
  window.addEventListener('hashchange', () => renderCurrent());
  if (!window.location.hash) history.replaceState(null, '', '#/scan');
  renderCurrent();
  return { rerender: renderCurrent };
}
