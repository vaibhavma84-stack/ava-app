// The Library vault: decrypt-on-unlock, encrypt-on-write.
//
// Record metadata is small and loads into memory on unlock. Extracted PDF text
// is far larger, so it stays encrypted on disk and is pulled in only when a
// full-text search actually needs it, then kept for the rest of the session.

import * as db from './db.js';
import * as sec from './crypto.js';
import { TYPES } from './schema.js';

const state = {
  dek: null,
  items: new Map(),
  texts: null,          // id -> [{ page, text }], loaded lazily
  listeners: new Set()
};

export function isUnlocked() { return state.dek !== null; }
export function onChange(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }
const emit = () => { for (const fn of state.listeners) fn(); };

export const newId = () =>
  crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);

// ── vault ───────────────────────────────────────────────────────────────────

export async function isInitialized() { return (await db.getMeta('vaultKey')) !== undefined; }

export async function initialize(passcode) {
  if (await isInitialized()) throw new Error('A library already exists on this device');
  const { meta, dek } = await sec.createVaultKey(passcode);
  await db.setMeta('vaultKey', meta);
  state.dek = dek;
  state.items = new Map();
  state.texts = new Map();
  await db.requestPersistence();
  emit();
}

export async function unlock(passcode) {
  const meta = await db.getMeta('vaultKey');
  if (!meta) throw new Error('No library on this device');
  state.dek = await sec.unlockVaultKey(passcode, meta);
  await loadAll();
  emit();
}

export function lock() {
  state.dek = null;
  state.items = new Map();
  state.texts = null;
  emit();
}

export async function changePasscode(current, next) {
  const meta = await db.getMeta('vaultKey');
  const dek = await sec.unlockVaultKey(current, meta);
  await db.setMeta('vaultKey', await sec.rewrapVaultKey(dek, next));
}

async function loadAll() {
  const rows = await db.getAll(db.STORE_ITEMS);
  const items = new Map();
  for (const row of rows) {
    try {
      const item = await sec.decryptJSON(state.dek, row.iv, row.ct);
      items.set(item.id, item);
    } catch { console.warn('Skipping unreadable record', row.id); }
  }
  state.items = items;
  state.texts = null;
}

function requireUnlocked() {
  if (!state.dek) throw new Error('Library is locked');
}

// ── items ───────────────────────────────────────────────────────────────────

export const allItems = () => [...state.items.values()];
export const getItem = (id) => state.items.get(id);

export function itemsOfType(type) {
  const def = TYPES[type];
  return allItems()
    .filter((i) => i.type === type)
    .sort((a, b) => (def.sort ? def.sort(a.data, b.data) || 0 : b.updatedAt - a.updatedAt));
}

export async function saveItem({ id, type, data }) {
  requireUnlocked();
  const now = Date.now();
  const existing = id ? state.items.get(id) : null;
  const item = {
    id: id || newId(),
    type: type || existing?.type,
    data: { ...(existing?.data || {}), ...data },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  const { iv, ct } = await sec.encryptJSON(state.dek, item);
  await db.put(db.STORE_ITEMS, { id: item.id, updatedAt: item.updatedAt, iv, ct });
  state.items.set(item.id, item);
  emit();
  return item;
}

export async function deleteItem(id) {
  requireUnlocked();
  const item = state.items.get(id);
  for (const att of item?.data?.attachments || []) {
    await db.del(db.STORE_BLOBS, att.id).catch(() => {});
    await db.del(db.STORE_TEXTS, att.id).catch(() => {});
    state.texts?.delete(att.id);
  }
  await db.del(db.STORE_ITEMS, id);
  state.items.delete(id);
  emit();
}

// ── attachments ─────────────────────────────────────────────────────────────

export async function storeFile(file) {
  requireUnlocked();
  const buffer = await file.arrayBuffer();
  const { iv, ct } = await sec.encryptBytes(state.dek, buffer);
  const id = newId();
  await db.put(db.STORE_BLOBS, { id, size: buffer.byteLength, iv, ct });
  return {
    id,
    name: file.name || 'file',
    type: file.type || 'application/octet-stream',
    size: buffer.byteLength,
    addedAt: Date.now()
  };
}

/** Store the text pulled out of a PDF, encrypted like everything else. */
export async function storeText(attachmentId, pages) {
  requireUnlocked();
  const { iv, ct } = await sec.encryptJSON(state.dek, pages);
  await db.put(db.STORE_TEXTS, { id: attachmentId, iv, ct });
  state.texts?.set(attachmentId, pages);
}

export async function readFile(att) {
  requireUnlocked();
  const row = await db.get(db.STORE_BLOBS, att.id);
  if (!row) throw new Error('File data is missing from this device');
  const plain = await sec.decryptBytes(state.dek, row.iv, row.ct);
  return new Blob([plain], { type: att.type || 'application/octet-stream' });
}

export async function removeFile(att) {
  requireUnlocked();
  await db.del(db.STORE_BLOBS, att.id);
  await db.del(db.STORE_TEXTS, att.id).catch(() => {});
  state.texts?.delete(att.id);
}

export function attachmentBytes() {
  let total = 0;
  for (const item of state.items.values()) {
    for (const att of item.data?.attachments || []) total += att.size || 0;
  }
  return total;
}

/** Decrypt every stored page of text once, then keep it for the session. */
export async function loadTexts() {
  requireUnlocked();
  if (state.texts) return state.texts;
  const rows = await db.getAll(db.STORE_TEXTS);
  const map = new Map();
  for (const row of rows) {
    try { map.set(row.id, await sec.decryptJSON(state.dek, row.iv, row.ct)); }
    catch { console.warn('Unreadable text index for', row.id); }
  }
  state.texts = map;
  return map;
}

export const textsLoaded = () => state.texts !== null;

export function counts() {
  const out = {};
  for (const key of Object.keys(TYPES)) out[key] = 0;
  for (const item of state.items.values()) out[item.type] = (out[item.type] || 0) + 1;
  return out;
}

/** How many attachments carry searchable text, and how many do not. */
export function textStats() {
  let searchable = 0, unsearchable = 0, failed = 0;
  for (const item of state.items.values()) {
    for (const att of item.data?.attachments || []) {
      const status = att.textStatus || (att.textPages > 0 ? 'indexed' : att.scanned ? 'no-text' : null);
      if (status === 'indexed') searchable++;
      else if (status === 'no-text') unsearchable++;
      else if (status === 'failed' || status === 'encrypted') failed++;
    }
  }
  return { searchable, unsearchable, failed };
}

// ── backup ──────────────────────────────────────────────────────────────────

export async function exportEncrypted() {
  const meta = await db.getMeta('vaultKey');
  const [items, blobs, texts] = await Promise.all([
    db.getAll(db.STORE_ITEMS), db.getAll(db.STORE_BLOBS), db.getAll(db.STORE_TEXTS)
  ]);
  const enc = (r) => ({ ...r, iv: sec.toBase64(r.iv), ct: sec.toBase64(r.ct) });
  return {
    format: 'ava-library-encrypted',
    version: 1,
    exportedAt: new Date().toISOString(),
    vaultKey: meta,
    items: items.map(enc),
    blobs: blobs.map(enc),
    texts: texts.map(enc)
  };
}

export async function importEncrypted(payload, passcode) {
  if (payload?.format !== 'ava-library-encrypted') throw new Error('Not a Library backup');
  const dek = await sec.unlockVaultKey(passcode, payload.vaultKey);
  const dec = (r) => ({ ...r, iv: sec.fromBase64(r.iv), ct: sec.fromBase64(r.ct).buffer });

  for (const store of [db.STORE_ITEMS, db.STORE_BLOBS, db.STORE_TEXTS]) await db.clearStore(store);
  await db.setMeta('vaultKey', payload.vaultKey);
  await db.putMany(db.STORE_ITEMS, (payload.items || []).map(dec));
  await db.putMany(db.STORE_BLOBS, (payload.blobs || []).map(dec));
  await db.putMany(db.STORE_TEXTS, (payload.texts || []).map(dec));

  state.dek = dek;
  await loadAll();
  emit();
  return state.items.size;
}

/** Bring records across from AVA's plain export of its manuals and publications. */
export async function importFromAva(payload) {
  requireUnlocked();
  if (payload?.format !== 'ava-library-handover') throw new Error('Not an AVA handover file');
  let n = 0;
  for (const record of payload.items || []) {
    if (!TYPES[record.type]) continue;
    // Attachments cannot travel in a plain handover; the metadata still can.
    const data = { ...record.data, attachments: [] };
    await saveItem({ type: record.type, data });
    n++;
  }
  return n;
}

export async function eraseVault() {
  await db.destroyEverything();
  state.dek = null;
  state.items = new Map();
  state.texts = null;
  emit();
}
