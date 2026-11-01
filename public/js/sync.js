import * as api from './api.js';
import * as db from './db.js';
import { state, emit } from './state.js';
import { t } from './i18n.js';
import { makeThumbnail, toast } from './ui.js';

let syncing = false;
let retryTimer = null;

function nowIso() {
  return new Date().toISOString();
}

export function mapServerPayload(payload, existing = {}) {
  return {
    id: existing.id || payload.id,
    serverId: payload.id,
    clientScanId: existing.clientScanId || null,
    createdAt: payload.createdAt || existing.createdAt || nowIso(),
    updatedAt: payload.updatedAt || nowIso(),
    language: payload.language || existing.language || state.language,
    source: payload.source || existing.source || 'upload',
    status: payload.status || 'pending',
    category: payload.category || null,
    result: payload.result || null,
    recommendations: payload.recommendations || [],
    hasImage: Boolean(payload.hasImage),
    errorCode: payload.errorCode || null,
    errorMessage: null,
    favorite: Boolean(existing.favorite),
    notes: existing.notes || '',
    thumbnail: existing.thumbnail || null,
    syncError: null,
    syncedAt: nowIso(),
  };
}

export async function refreshQueueState() {
  let count = 0;
  try {
    count = await db.countQueue();
  } catch {
    count = 0;
  }
  state.pendingCount = count;
  emit('sync', {
    count,
    syncing: state.syncing,
    error: state.syncError,
    online: state.online,
  });
  return count;
}

export async function prepareScan({ blob, filename, language, source, thumbnail }) {
  const clientScanId = api.newClientScanId();
  const record = {
    id: clientScanId,
    serverId: null,
    clientScanId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    language,
    source,
    status: 'pending',
    category: null,
    result: null,
    recommendations: [],
    hasImage: true,
    errorCode: null,
    errorMessage: null,
    favorite: false,
    notes: '',
    thumbnail,
    blob,
    filename,
    syncError: null,
  };

  await db.putScan(record);
  await db.enqueue({ clientScanId, blob, filename, language, source });
  emit('scan-updated', record);
  await refreshQueueState();
  return record;
}

export async function pushScan(clientScanId, { onProgress } = {}) {
  const record = await db.getScan(clientScanId);
  const item = await db.getQueueItem(clientScanId);
  if (!record || !item) return record;

  if (!state.online) {
    statusToast('toast.queued', 'warning');
    return record;
  }

  try {
    const payload = await api.uploadScan({
      blob: item.blob,
      filename: item.filename,
      language: item.language,
      source: item.source,
      clientScanId,
      onProgress: (percent) => {
        emit('upload-progress', { id: clientScanId, percent });
        onProgress?.(percent);
      },
    });
    const merged = mapServerPayload(payload, record);
    await db.putScan(merged);
    await db.removeQueueItem(clientScanId);
    emit('scan-updated', merged);
    await refreshQueueState();
    return merged;
  } catch (error) {
    if (error.code === 'NETWORK_ERROR' || error.code === 'OFFLINE') {
      const pending = { ...record, syncError: 'offline', updatedAt: nowIso() };
      await db.putScan(pending);
      emit('scan-updated', pending);
      await refreshQueueState();
      scheduleRetry();
      statusToast('toast.queued', 'warning');
      return pending;
    }

    await db.removeQueueItem(clientScanId).catch(() => {});
    const failed = {
      ...record,
      status: 'failed',
      errorCode: error.code || 'SCAN_FAILED',
      errorMessage: error.message,
      serverId: error.details?.scanId || record.serverId,
      updatedAt: nowIso(),
    };
    await db.putScan(failed);
    emit('scan-updated', failed);
    await refreshQueueState();
    return failed;
  }
}

export async function submitScan(args) {
  const record = await prepareScan(args);
  return pushScan(record.id, { onProgress: args.onProgress });
}

export async function syncNow({ silent = true } = {}) {
  if (syncing) return;
  await refreshQueueState();

  if (!state.online) return;
  const queue = await db.getQueue().catch(() => []);
  if (!queue.length) return;

  syncing = true;
  state.syncing = true;
  state.syncError = false;
  emit('sync', { count: queue.length, syncing: true, online: true });
  let syncedCount = 0;

  try {
    for (const item of queue) {
      if (!state.online) break;
      const record = await db.getScan(item.clientScanId).catch(() => null);

      try {
        const payload = await api.uploadScan({
          blob: item.blob,
          filename: item.filename,
          language: item.language,
          source: item.source,
          clientScanId: item.clientScanId,
        });
        const merged = mapServerPayload(payload, record || { id: item.clientScanId, clientScanId: item.clientScanId });
        await db.putScan(merged);
        await db.removeQueueItem(item.clientScanId);
        emit('scan-updated', merged);
        syncedCount += 1;
      } catch (error) {
        if (error.code === 'NETWORK_ERROR' || error.code === 'OFFLINE') {
          state.syncError = true;
          break;
        }

        await db.removeQueueItem(item.clientScanId).catch(() => {});
        if (record) {
          const failed = {
            ...record,
            status: 'failed',
            errorCode: error.code || 'SCAN_FAILED',
            errorMessage: error.message,
            serverId: error.details?.scanId || record.serverId,
            updatedAt: nowIso(),
          };
          await db.putScan(failed);
          emit('scan-updated', failed);
        }
      }
    }
  } finally {
    syncing = false;
    state.syncing = false;
    await refreshQueueState();
    if (syncedCount > 0) {
      if (!silent) statusToast('toast.synced', 'success');
      emit('scan-synced', { count: syncedCount });
    }
    if (state.pendingCount > 0) scheduleRetry();
  }
}

function statusToast(key, type) {
  if (document.visibilityState === 'visible') toast(t(key), { type });
}

export function scheduleRetry(delay = 30000) {
  if (retryTimer) return;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    if (!state.online) return;
    await syncNow({ silent: true }).catch(() => {});
  }, delay);
}

export async function retryRecord(id) {
  const record = await db.getScan(id);
  if (!record) return null;

  const queueItem = await db.getQueueItem(id).catch(() => null);
  if (queueItem) {
    await syncNow({ silent: false });
    return db.getScan(id);
  }

  if (record.serverId) {
    return reanalyzeRecord(id, record.language);
  }

  if (!record.blob) {
    toast(t('result.retryUnavailable'), { type: 'warning' });
    return record;
  }

  const pending = { ...record, status: 'pending', errorCode: null, errorMessage: null, updatedAt: nowIso() };
  await db.putScan(pending);
  emit('scan-updated', pending);
  await db.enqueue({
    clientScanId: id,
    blob: record.blob,
    filename: record.filename || 'scan.jpg',
    language: record.language,
    source: record.source || 'upload',
  });
  await refreshQueueState();
  await syncNow({ silent: false });
  return db.getScan(id);
}

export async function reanalyzeRecord(id, language) {
  const record = await db.getScan(id);
  if (!record?.serverId) throw new Error('This scan has no server copy to re-analyze.');

  const processing = { ...record, status: 'processing', errorCode: null, updatedAt: nowIso() };
  await db.putScan(processing);
  emit('scan-updated', processing);

  try {
    const payload = await api.reanalyzeScan(record.serverId, language || record.language);
    const merged = mapServerPayload(payload, { ...record, status: 'completed' });
    await db.putScan(merged);
    emit('scan-updated', merged);
    return merged;
  } catch (error) {
    const failed = {
      ...record,
      status: 'failed',
      errorCode: error.code || 'REANALYZE_FAILED',
      errorMessage: error.message,
      updatedAt: nowIso(),
    };
    await db.putScan(failed);
    emit('scan-updated', failed);
    throw error;
  }
}

export async function deleteLocalScan(id) {
  await db.deleteScanRecord(id).catch(() => {});
  await db.removeQueueItem(id).catch(() => {});
  emit('scan-deleted', { id });
  if (state.pendingCount > 0) await refreshQueueState();
}

export async function fetchThumbnail(record) {
  if (record.thumbnail) return record.thumbnail;
  if (!record.serverId || !state.online) return null;

  try {
    const blob = await api.fetchScanImage(record.serverId);
    const { dataUrl } = await makeThumbnail(blob, 900);
    const updated = { ...record, thumbnail: dataUrl, updatedAt: nowIso() };
    await db.putScan(updated);
    emit('scan-updated', updated);
    return dataUrl;
  } catch {
    return null;
  }
}

export async function importServerHistoryIfEmpty() {
  if (!state.online) return 0;

  const count = await db.countScans().catch(() => 0);
  if (count > 0) return 0;

  const importedAt = await db.getMeta('serverImportedAt').catch(() => null);
  if (importedAt && Date.now() - new Date(importedAt).getTime() < 6 * 60 * 60 * 1000) return 0;

  let imported = 0;
  try {
    const list = await api.listScans({ limit: 20 });
    const items = list?.items || [];
    for (const summary of items) {
      try {
        const payload = await api.getScan(summary.id);
        const record = mapServerPayload(payload, { id: payload.id, clientScanId: null });
        if (!record.category && summary.category) record.category = summary.category;
        await db.putScan(record);
        await fetchThumbnail(record);
        imported += 1;
      } catch {
        // Skip records that cannot be fetched; they can still be found via a new scan.
      }
    }
    await db.setMeta('serverImportedAt', new Date().toISOString());
  } catch {
    return imported;
  }

  if (imported > 0) emit('data-changed', { source: 'server-import' });
  return imported;
}

export async function reconcilePending() {
  const records = await db.getAllScans().catch(() => []);
  for (const record of records) {
    if (record.status !== 'pending') continue;
    const queued = await db.getQueueItem(record.id).catch(() => null);
    if (!queued && !record.serverId) {
      await db.updateScan(record.id, {
        status: 'failed',
        errorCode: 'QUEUE_LOST',
        errorMessage: 'The queued image was lost before upload.',
      });
    }
  }
  await refreshQueueState();
}

export function initSync() {
  window.addEventListener('online', () => {
    state.online = true;
    emit('online', { online: true });
    statusToast('toast.online', 'success');
    syncNow({ silent: false }).catch(() => {});
  });

  window.addEventListener('offline', () => {
    state.online = false;
    state.syncError = false;
    emit('offline', { online: false });
    statusToast('toast.offline', 'warning');
    refreshQueueState().catch(() => {});
  });

  window.setInterval(() => {
    if (state.online && state.pendingCount > 0) syncNow({ silent: true }).catch(() => {});
  }, 30000);
}
