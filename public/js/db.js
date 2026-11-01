const DB_NAME = 'smartlens';
const DB_VERSION = 1;

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('scans')) {
        const scans = db.createObjectStore('scans', { keyPath: 'id' });
        scans.createIndex('updatedAt', 'updatedAt');
        scans.createIndex('createdAt', 'createdAt');
        scans.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains('queue')) {
        const queue = db.createObjectStore('queue', { keyPath: 'clientScanId' });
        queue.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Could not open local database.'));
    request.onblocked = () => reject(new Error('Local database is blocked by another tab.'));
  });
  return dbPromise;
}

function toPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function done(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
  });
}

async function store(name, mode = 'readonly') {
  const db = await openDatabase();
  const transaction = db.transaction(name, mode);
  return { transaction, objectStore: transaction.objectStore(name) };
}

export async function putScan(record) {
  const { transaction, objectStore } = await store('scans', 'readwrite');
  objectStore.put(record);
  await done(transaction);
  return record;
}

export async function getScan(id) {
  const { objectStore } = await store('scans');
  return (await toPromise(objectStore.get(id))) || null;
}

export async function getAllScans() {
  const { objectStore } = await store('scans');
  const rows = await toPromise(objectStore.getAll());
  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function countScans() {
  const { objectStore } = await store('scans');
  return toPromise(objectStore.count());
}

export async function deleteScanRecord(id) {
  const { transaction, objectStore } = await store('scans', 'readwrite');
  objectStore.delete(id);
  await done(transaction);
}

export async function clearScanRecords() {
  const { transaction, objectStore } = await store('scans', 'readwrite');
  objectStore.clear();
  await done(transaction);
}

export async function updateScan(id, patch) {
  const { transaction, objectStore } = await store('scans', 'readwrite');
  const existing = await toPromise(objectStore.get(id));
  if (!existing) {
    await done(transaction);
    return null;
  }
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  objectStore.put(updated);
  await done(transaction);
  return updated;
}

export async function toggleFavorite(id) {
  const { transaction, objectStore } = await store('scans', 'readwrite');
  const existing = await toPromise(objectStore.get(id));
  if (!existing) {
    await done(transaction);
    return null;
  }
  const updated = {
    ...existing,
    favorite: !existing.favorite,
    updatedAt: new Date().toISOString(),
  };
  objectStore.put(updated);
  await done(transaction);
  return updated;
}

export async function enqueue(item) {
  const { transaction, objectStore } = await store('queue', 'readwrite');
  objectStore.put({ createdAt: new Date().toISOString(), ...item });
  await done(transaction);
}

export async function getQueue() {
  const { objectStore } = await store('queue');
  const rows = await toPromise(objectStore.getAll());
  return rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function getQueueItem(clientScanId) {
  const { objectStore } = await store('queue');
  return (await toPromise(objectStore.get(clientScanId))) || null;
}

export async function removeQueueItem(clientScanId) {
  const { transaction, objectStore } = await store('queue', 'readwrite');
  objectStore.delete(clientScanId);
  await done(transaction);
}

export async function clearQueue() {
  const { transaction, objectStore } = await store('queue', 'readwrite');
  objectStore.clear();
  await done(transaction);
}

export async function countQueue() {
  const { objectStore } = await store('queue');
  return toPromise(objectStore.count());
}

export async function getMeta(key, fallback = null) {
  const { objectStore } = await store('meta');
  const row = await toPromise(objectStore.get(key));
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  const { transaction, objectStore } = await store('meta', 'readwrite');
  objectStore.put({ key, value, updatedAt: new Date().toISOString() });
  await done(transaction);
}

export async function clearAllLocal() {
  const { transaction, objectStore } = await store('scans', 'readwrite');
  objectStore.clear();
  await done(transaction);
  await clearQueue();
}
