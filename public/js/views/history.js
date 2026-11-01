import { state, on } from '../state.js';
import { t } from '../i18n.js';
import {
  escapeHtml,
  toast,
  errorMessage,
  formatRelative,
  statusPill,
  confirmDialog,
  categoryMeta,
} from '../ui.js';
import * as db from '../db.js';
import * as api from '../api.js';
import { deleteLocalScan, importServerHistoryIfEmpty, refreshQueueState } from '../sync.js';
import { navigate } from '../router.js';

const filters = { q: '', category: '', sort: 'newest' };
let active = null;
let reloadTimer = null;
let controller = null;

function scanMatches(record, favoritesOnly) {
  if (favoritesOnly && !record.favorite) return false;
  if (filters.category && record.category?.slug !== filters.category) return false;

  const query = filters.q.trim().toLowerCase();
  if (!query) return true;

  const haystack = [
    record.result?.mainIdentification,
    record.result?.scientificName,
    record.result?.description,
    record.notes,
    record.category?.name,
    record.errorCode,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function sortRecords(records) {
  const sorted = [...records];
  if (filters.sort === 'oldest') {
    sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  } else if (filters.sort === 'title') {
    sorted.sort((a, b) =>
      String(a.result?.mainIdentification || '').localeCompare(String(b.result?.mainIdentification || '')),
    );
  } else {
    sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  return sorted;
}

function cardHtml(record) {
  const title =
    record.result?.mainIdentification ||
    (record.status === 'pending' || record.status === 'processing'
      ? t('common.analyzing')
      : t('common.failed'));
  const category = categoryMeta(record.category);
  const thumb = record.thumbnail
    ? `<img src="${escapeHtml(record.thumbnail)}" alt="${escapeHtml(title)}" loading="lazy" />`
    : `<i class="bi ${escapeHtml(category.icon)} placeholder-icon" aria-hidden="true"></i>`;

  return `
    <article class="scan-card" data-id="${escapeHtml(record.id)}" tabindex="0" role="button" aria-label="${escapeHtml(title)}">
      <div class="scan-card-image">${thumb}</div>
      <div class="scan-card-fav-wrap">
        <button type="button" class="scan-card-fav ${record.favorite ? 'active' : ''}" data-action="favorite" data-id="${escapeHtml(record.id)}"
          aria-label="${escapeHtml(record.favorite ? t('result.favoriteRemove') : t('result.favoriteAdd'))}" aria-pressed="${record.favorite ? 'true' : 'false'}">
          <i class="bi ${record.favorite ? 'bi-heart-fill' : 'bi-heart'}" aria-hidden="true"></i>
        </button>
        <button type="button" class="scan-card-del" data-action="delete" data-id="${escapeHtml(record.id)}"
          aria-label="${escapeHtml(t('result.delete'))}">
          <i class="bi bi-trash" aria-hidden="true"></i>
        </button>
      </div>
      <div class="scan-card-body">
        <div class="scan-card-title">${escapeHtml(title)}</div>
        <div class="scan-card-meta">
          ${category.name ? `<span class="chip chip-neutral">${escapeHtml(category.name)}</span>` : ''}
          ${record.status !== 'completed' ? statusPill(record.status) : ''}
          ${record.notes ? '<span class="chip chip-neutral"><i class="bi bi-journal-text" aria-hidden="true"></i></span>' : ''}
        </div>
        <div class="scan-card-meta">
          <i class="bi bi-clock" aria-hidden="true"></i>
          <span>${escapeHtml(formatRelative(record.createdAt))}</span>
        </div>
      </div>
    </article>`;
}

function emptyHtml(favoritesOnly, hasFilters) {
  if (hasFilters) {
    return `
      <div class="empty-state">
        <div class="empty-icon"><i class="bi bi-search" aria-hidden="true"></i></div>
        <h2>${escapeHtml(t('history.noMatches'))}</h2>
        <p>${escapeHtml(t('history.noMatchesBody'))}</p>
      </div>`;
  }
  if (favoritesOnly) {
    return `
      <div class="empty-state">
        <div class="empty-icon"><i class="bi bi-heart" aria-hidden="true"></i></div>
        <h2>${escapeHtml(t('history.favoritesEmptyTitle'))}</h2>
        <p>${escapeHtml(t('history.favoritesEmptyBody'))}</p>
        <a class="btn btn-brand" href="#/scan">${escapeHtml(t('history.scanNow'))}</a>
      </div>`;
  }
  return `
    <div class="empty-state">
      <div class="empty-icon"><i class="bi bi-camera" aria-hidden="true"></i></div>
      <h2>${escapeHtml(t('history.emptyTitle'))}</h2>
      <p>${escapeHtml(t('history.emptyBody'))}</p>
      <a class="btn btn-brand" href="#/scan">${escapeHtml(t('history.scanNow'))}</a>
    </div>`;
}

async function loadAndRenderList() {
  if (!active?.list?.isConnected) return;
  const favoritesOnly = active.favoritesOnly;

  let records = [];
  try {
    records = await db.getAllScans();
  } catch (error) {
    active.list.innerHTML = `<p class="small text-danger">${escapeHtml(errorMessage(error))}</p>`;
    return;
  }

  const filtered = sortRecords(records.filter((record) => scanMatches(record, favoritesOnly)));
  const hasFilters = Boolean(filters.q.trim() || filters.category);
  const summary = active.container.querySelector('#historySummary');
  if (summary) {
    const pending = records.filter((record) => record.status === 'pending').length;
    summary.innerHTML = `${escapeHtml(t('history.resultCount', { count: filtered.length }))}${
      pending ? ` · <span class="text-warning-emphasis">${escapeHtml(t('history.pendingSync', { count: pending }))}</span>` : ''
    }`;
  }

  if (!filtered.length) {
    active.list.innerHTML = emptyHtml(favoritesOnly, hasFilters);
    return;
  }

  active.list.innerHTML = `<div class="scan-grid">${filtered.map(cardHtml).join('')}</div>`;
}

function scheduleReload(delay = 80) {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    loadAndRenderList();
  }, delay);
}

function bindToolbar(container) {
  const search = container.querySelector('#historySearch');
  const category = container.querySelector('#historyCategory');
  const sort = container.querySelector('#historySort');

  let searchTimer = null;
  search?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.q = search.value;
      scheduleReload(0);
    }, 120);
  });

  category?.addEventListener('change', () => {
    filters.category = category.value;
    scheduleReload(0);
  });

  sort?.addEventListener('change', () => {
    filters.sort = sort.value;
    scheduleReload(0);
  });

  container.querySelector('#historyClear')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: t('history.clearConfirmTitle'),
      body: t('history.clearConfirmBody'),
      confirmLabel: t('common.clearAll'),
    });
    if (!confirmed) return;

    let records = [];
    try {
      records = await db.getAllScans();
    } catch {
      records = [];
    }

    if (state.online) {
      await Promise.allSettled(
        records.filter((record) => record.serverId).map((record) => api.deleteScan(record.serverId)),
      );
    }

    try {
      await db.clearAllLocal();
      await refreshQueueState();
      toast(t('history.cleared'), { type: 'success' });
      scheduleReload(0);
    } catch (error) {
      toast(errorMessage(error), { type: 'error' });
    }
  });
}

async function handleListClick(event) {
  const action = event.target.closest('[data-action="favorite"]');
  if (action) {
    event.stopPropagation();
    const updated = await db.toggleFavorite(action.dataset.id).catch(() => null);
    if (updated) {
      toast(t(updated.favorite ? 'history.favoriteAdded' : 'history.favoriteRemoved'), {
        type: 'success',
        timeout: 1800,
      });
      scheduleReload(0);
    }
    return;
  }

  const remove = event.target.closest('[data-action="delete"]');
  if (remove) {
    event.stopPropagation();
    const record = await db.getScan(remove.dataset.id).catch(() => null);
    if (!record) return;

    const confirmed = await confirmDialog({
      title: t('result.deleteConfirmTitle'),
      body: t('result.deleteConfirmBody'),
      confirmLabel: t('common.delete'),
    });
    if (!confirmed) return;

    if (record.serverId && !state.online) {
      toast(t('error.offline'), { type: 'warning' });
      return;
    }

    if (record.serverId) {
      try {
        await api.deleteScan(record.serverId);
      } catch (error) {
        if (error.code !== 'NOT_FOUND') {
          toast(errorMessage(error), { type: 'error' });
          return;
        }
      }
    }

    await deleteLocalScan(record.id);
    toast(t('result.deleted'), { type: 'success' });
    scheduleReload(0);
    return;
  }

  const card = event.target.closest('.scan-card');
  if (card) navigate(`/result/${card.dataset.id}`);
}

function handleListKey(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest('.scan-card');
  if (!card) return;
  if (event.target.closest('button')) return;
  event.preventDefault();
  navigate(`/result/${card.dataset.id}`);
}

export async function renderHistoryPage(container, { favoritesOnly = false } = {}) {
  controller?.abort();
  controller = new AbortController();

  const title = favoritesOnly ? t('history.favoritesTitle') : t('history.title');
  const subtitle = favoritesOnly ? t('history.favoritesSubtitle') : t('history.subtitle');

  const categoryOptions = state.categories
    .map(
      (category) =>
        `<option value="${escapeHtml(category.slug)}" ${filters.category === category.slug ? 'selected' : ''}>${escapeHtml(category.name)}</option>`,
    )
    .join('');

  container.innerHTML = `
    <div class="d-flex flex-wrap align-items-start justify-content-between gap-2">
      <div>
        <h1 class="page-title">${escapeHtml(title)}</h1>
        <p class="page-subtitle">${escapeHtml(subtitle)}</p>
      </div>
      ${!favoritesOnly ? `<button type="button" class="btn btn-outline-muted btn-sm" id="historyClear">${escapeHtml(t('history.clearAll'))}</button>` : ''}
    </div>
    <div class="history-toolbar">
      <div class="search-wrap">
        <i class="bi bi-search" aria-hidden="true"></i>
        <input type="search" class="form-control" id="historySearch" value="${escapeHtml(filters.q)}"
          placeholder="${escapeHtml(t('history.searchPlaceholder'))}" aria-label="${escapeHtml(t('common.search'))}" />
      </div>
      <select class="form-select" id="historyCategory" aria-label="${escapeHtml(t('common.filter'))}">
        <option value="">${escapeHtml(t('common.allCategories'))}</option>
        ${categoryOptions}
      </select>
      <select class="form-select" id="historySort" aria-label="${escapeHtml(t('common.sort'))}">
        <option value="newest" ${filters.sort === 'newest' ? 'selected' : ''}>${escapeHtml(t('history.sortNewest'))}</option>
        <option value="oldest" ${filters.sort === 'oldest' ? 'selected' : ''}>${escapeHtml(t('history.sortOldest'))}</option>
        <option value="title" ${filters.sort === 'title' ? 'selected' : ''}>${escapeHtml(t('history.sortTitle'))}</option>
      </select>
    </div>
    <p class="small muted" id="historySummary"></p>
    <div id="scanList">
      <div class="scan-grid">
        ${Array.from({ length: 4 })
          .map(
            () => `
          <div class="surface-card p-2">
            <div class="skeleton skeleton-block mb-2"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line short"></div>
          </div>`,
          )
          .join('')}
      </div>
    </div>`;

  active = {
    container,
    list: container.querySelector('#scanList'),
    favoritesOnly,
  };

  bindToolbar(container);
  active.list.addEventListener('click', handleListClick);
  active.list.addEventListener('keydown', handleListKey);

  await loadAndRenderList();

  if (!favoritesOnly) {
    importServerHistoryIfEmpty().catch(() => {});
  }
}

export async function renderFavoritesPage(container) {
  return renderHistoryPage(container, { favoritesOnly: true });
}

on('scan-updated', () => scheduleReload());
on('scan-deleted', () => scheduleReload());
on('data-changed', () => scheduleReload());
on('sync', () => {
  if (active?.container?.isConnected) scheduleReload(200);
});
