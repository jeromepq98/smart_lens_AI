export class ApiError extends Error {
  constructor(message, { status = 0, code = 'API_ERROR', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function request(path, { method = 'GET', body = null, timeout = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ApiError('The request timed out.', { code: 'NETWORK_ERROR' });
    }
    throw new ApiError('The server could not be reached.', {
      code: navigator.onLine ? 'NETWORK_ERROR' : 'OFFLINE',
    });
  } finally {
    clearTimeout(timer);
  }

  const payload = await parseBody(response);
  if (!response.ok) {
    const envelope = payload?.error || {};
    throw new ApiError(envelope.message || `Request failed (${response.status})`, {
      status: response.status,
      code: envelope.code || `HTTP_${response.status}`,
      details: envelope.details || null,
    });
  }
  return payload?.data ?? null;
}

export function uploadScan({ blob, filename, language, source, clientScanId, onProgress, timeout = 150000 }) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('image', blob, filename);
    form.append('language', language);
    form.append('source', source);
    form.append('client_scan_id', clientScanId);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/scans');
    xhr.responseType = 'json';
    xhr.timeout = timeout;
    xhr.withCredentials = true;

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    });

    xhr.addEventListener('load', () => {
      const payload = typeof xhr.response === 'object' ? xhr.response : null;
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload?.data ?? null);
        return;
      }
      const envelope = payload?.error || {};
      reject(
        new ApiError(envelope.message || `Request failed (${xhr.status})`, {
          status: xhr.status,
          code: envelope.code || `HTTP_${xhr.status}`,
          details: envelope.details || null,
        }),
      );
    });

    xhr.addEventListener('error', () => {
      reject(
        new ApiError('The server could not be reached.', {
          code: navigator.onLine ? 'NETWORK_ERROR' : 'OFFLINE',
        }),
      );
    });

    xhr.addEventListener('timeout', () => {
      reject(new ApiError('The upload timed out.', { code: 'NETWORK_ERROR' }));
    });

    xhr.addEventListener('abort', () => {
      reject(new ApiError('The upload was cancelled.', { code: 'NETWORK_ERROR' }));
    });

    xhr.send(form);
  });
}

export function getConfig() {
  return request('/api/config', { timeout: 15000 });
}

export function getCategories() {
  return request('/api/categories', { timeout: 15000 });
}

export function listScans({ limit = 20, before, category, q, from, to } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (before) params.set('before', before);
  if (category) params.set('category', category);
  if (q) params.set('q', q);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return request(`/api/scans?${params.toString()}`, { timeout: 20000 });
}

export function getScan(id) {
  return request(`/api/scans/${encodeURIComponent(id)}`, { timeout: 20000 });
}

export function deleteScan(id) {
  return request(`/api/scans/${encodeURIComponent(id)}`, { method: 'DELETE', timeout: 20000 });
}

export function reanalyzeScan(id, language) {
  return request(`/api/scans/${encodeURIComponent(id)}/reanalyze`, {
    method: 'POST',
    body: { language },
    timeout: 150000,
  });
}

export function scanImageUrl(id) {
  return `/api/scans/${encodeURIComponent(id)}/image`;
}

export async function fetchScanImage(id) {
  const response = await fetch(scanImageUrl(id), { credentials: 'same-origin' });
  if (!response.ok) {
    throw new ApiError('The image could not be loaded.', { status: response.status, code: 'IMAGE_MISSING' });
  }
  return response.blob();
}

export function getChat(scanId) {
  return request(`/api/chat/${encodeURIComponent(scanId)}`, { timeout: 20000 });
}

export function sendChatMessage(scanId, content, language) {
  return request(`/api/chat/${encodeURIComponent(scanId)}/messages`, {
    method: 'POST',
    body: { content, language },
    timeout: 90000,
  });
}

export function regenerateChat(scanId, language) {
  return request(`/api/chat/${encodeURIComponent(scanId)}/regenerate`, {
    method: 'POST',
    body: { language },
    timeout: 90000,
  });
}

export function clearChat(scanId) {
  return request(`/api/chat/${encodeURIComponent(scanId)}`, { method: 'DELETE', timeout: 20000 });
}

export function generateLearning(scanId, level, language) {
  return request(`/api/scans/${encodeURIComponent(scanId)}/learning`, {
    method: 'POST',
    body: { level, language },
    timeout: 90000,
  });
}

export function newClientScanId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
