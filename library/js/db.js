// IndexedDB for Library. Stores ciphertext only; it knows nothing about keys.
// Separate database from AVA, so the two apps never touch each other's data.

const DB_NAME = 'ava-library';
const DB_VERSION = 1;

export const STORE_ITEMS = 'items';   // { id, updatedAt, iv, ct }
export const STORE_BLOBS = 'blobs';   // { id, size, iv, ct }  encrypted file bytes
export const STORE_TEXTS = 'texts';   // { id, iv, ct }        extracted PDF text
export const STORE_META = 'meta';     // { key, value }

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        db.createObjectStore(STORE_ITEMS, { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      }
      for (const name of [STORE_BLOBS, STORE_TEXTS]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database upgrade blocked by another open tab'));
  });
  return dbPromise;
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const os = async (store, mode) => (await openDB()).transaction(store, mode).objectStore(store);

export async function put(store, value) { return wrap((await os(store, 'readwrite')).put(value)); }
export async function get(store, key) { return wrap((await os(store, 'readonly')).get(key)); }
export async function del(store, key) { return wrap((await os(store, 'readwrite')).delete(key)); }
export async function getAll(store) { return wrap((await os(store, 'readonly')).getAll()); }
export async function clearStore(store) { return wrap((await os(store, 'readwrite')).clear()); }

export async function putMany(store, values) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const v of values) s.put(v);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function getMeta(key) {
  const row = await get(STORE_META, key);
  return row ? row.value : undefined;
}
export async function setMeta(key, value) { return put(STORE_META, { key, value }); }

export async function storageEstimate() {
  try { return await navigator.storage?.estimate?.() ?? null; } catch { return null; }
}

export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}

export async function destroyEverything() {
  const db = await openDB();
  db.close();
  dbPromise = null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
