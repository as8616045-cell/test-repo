// js/storage.js — IndexedDB-backed history store
// Stores generated images / prompts / parameters for later reuse.

const DB_NAME = 'ai-studio';
const DB_VER  = 1;
const STORE   = 'history';

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
        s.createIndex('kind', 'kind');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

/**
 * Add a record.
 * record = {
 *   id, kind: 'reverse'|'consistent'|'change-product'|'change-bg'|'video',
 *   createdAt: number,
 *   prompt: string, model: string, provider: string,
 *   inputs: [{name, dataURL}], outputs: [{name, dataURL, mime}],
 *   params: {...}, note: ''
 * }
 */
export async function addHistory(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

export async function listHistory({ kind = null, limit = 200 } = {}) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('createdAt');
    const out = [];
    idx.openCursor(null, 'prev').onsuccess = e => {
      const cur = e.target.result;
      if (!cur || out.length >= limit) return resolve(out);
      if (!kind || cur.value.kind === kind) out.push(cur.value);
      cur.continue();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getHistory(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(id);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

export async function removeHistory(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearHistory() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
