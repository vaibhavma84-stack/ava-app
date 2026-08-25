// The Library store.
//
// Library holds ship documents — manuals, publications, company documents,
// circulars. None of it is secret, so it is stored in the clear and opens
// straight away: the iPhone's own lock is the gate that matters, and a passcode
// on top only added friction to looking something up in the engine room.
//
// AVA is the opposite case and keeps its encryption: certificates, sea time and
// personal records are worth protecting.
//
// A library created before this change is still encrypted. It is migrated once,
// on the next launch, after asking for that passcode a final time.

import * as db from './db.js';
import * as sec from './crypto.js';
import { TYPES } from './schema.js';

const state = {
  open: false,
  items: new Map(),
  texts: null,        // id -> [{ page, text }], loaded on first search
  listeners: new Set()
};

export function isOpen() { return state.open; }
export function onChange(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }
const emit = () => { for (const fn of state.listeners) fn(); };

export const newId = () =>
  crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);

// ── opening ─────────────────────────────────────────────────────────────────

/** True when this device still holds a passcode-encrypted library. */
export async function needsMigration() {
  return (await db.getMeta('vaultKey')) !== undefined;
}

export async function open() {
  const rows = await db.getAll(db.STORE_ITEMS);
  const items = new Map();
  for (const row of rows) {
    if (!row.data) continue;   // an encrypted row left behind; migration handles it
    items.set(row.data.id, row.data);
  }
  state.items = items;
  state.texts = null;
  state.open = true;
  await db.requestPersistence();
  emit();
}

/**
 * Decrypt an older library once and rewrite it in the clear, then drop the key.
 * Everything is read before anything is written, so a failure part-way through
 * cannot leave the library half-converted.
 */
export async function migrate(passcode) {
  const meta = await db.getMeta('vaultKey');
  if (!meta) return 0;
  const dek = await sec.unlockVaultKey(passcode, meta);

  const [itemRows, blobRows, textRows] = await Promise.all([
    db.getAll(db.STORE_ITEMS), db.getAll(db.STORE_BLOBS), db.getAll(db.STORE_TEXTS)
  ]);

  const items = [];
  for (const row of itemRows) {
    if (row.data) { items.push(row); continue; }          // already plain
    const item = await sec.decryptJSON(dek, row.iv, row.ct);
    items.push({ id: item.id, updatedAt: item.updatedAt, data: item });
  }

  const blobs = [];
  for (const row of blobRows) {
    if (row.blob) { blobs.push(row); continue; }
    const bytes = await sec.decryptBytes(dek, row.iv, row.ct);
    blobs.push({ id: row.id, size: row.size, type: row.type || 'application/octet-stream',
                 blob: new Blob([bytes], { type: row.type || 'application/octet-stream' }) });
  }

  const texts = [];
  for (const row of textRows) {
    if (row.pages) { texts.push(row); continue; }
    texts.push({ id: row.id, pages: await sec.decryptJSON(dek, row.iv, row.ct) });
  }

  await db.putMany(db.STORE_ITEMS, items);
  await db.putMany(db.STORE_BLOBS, blobs);
  await db.putMany(db.STORE_TEXTS, texts);
  await db.del(db.STORE_META, 'vaultKey');
  await db.del(db.STORE_META, 'passcodeStyle').catch(() => {});

  await open();
  return items.length;
}

// ── items ───────────────────────────────────────────────────────────────────

export const allItems = () => [...state.items.values()];
export const getItem = (id) => state.items.get(id);

export function itemsOfType(type) {
  const def = TYPES[type];
  return allItems()
    .filter((i) => i.type === type)
    .sort((a, b) => (def?.sort ? def.sort(a.data, b.data) || 0 : b.updatedAt - a.updatedAt));
}

export async function saveItem({ id, type, data }) {
  const now = Date.now();
  const existing = id ? state.items.get(id) : null;
  const item = {
    id: id || newId(),
    type: type || existing?.type,
    data: { ...(existing?.data || {}), ...data },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  await db.put(db.STORE_ITEMS, { id: item.id, updatedAt: item.updatedAt, data: item });
  state.items.set(item.id, item);
  emit();
  return item;
}

export async function deleteItem(id) {
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

/**
 * Files are kept as Blobs rather than byte arrays: IndexedDB stores them
 * without holding the whole document in memory, which matters for a manual of
 * a few hundred megabytes.
 */
export async function storeFile(file) {
  const id = newId();
  const type = file.type || 'application/octet-stream';
  await db.put(db.STORE_BLOBS, { id, size: file.size, type, blob: file.slice(0, file.size, type) });
  return { id, name: file.name || 'file', type, size: file.size, addedAt: Date.now() };
}

export async function storeText(attachmentId, pages) {
  await db.put(db.STORE_TEXTS, { id: attachmentId, pages });
  state.texts?.set(attachmentId, pages);
}

export async function readFile(att) {
  const row = await db.get(db.STORE_BLOBS, att.id);
  if (!row) throw new Error('File data is missing from this device');
  if (row.blob) return row.blob;
  // A row left by the encrypted era, before migration completed.
  throw new Error('This file has not been converted yet');
}

export async function removeFile(att) {
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

/** Document text is pulled in on the first search, not at startup. */
export async function loadTexts() {
  if (state.texts) return state.texts;
  const rows = await db.getAll(db.STORE_TEXTS);
  const map = new Map();
  for (const row of rows) if (row.pages) map.set(row.id, row.pages);
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

/**
 * Records and the text index, without the files themselves. Attachments are
 * left out deliberately: a library of PDFs turns into a backup far too large to
 * hand to the share sheet, and the PDFs exist elsewhere anyway.
 */
export async function exportRecords() {
  return {
    format: 'ava-library-records',
    version: 2,
    exportedAt: new Date().toISOString(),
    note: 'Records only. Attached files are not included; re-attach them after restoring.',
    items: allItems().map((i) => ({
      ...i,
      data: { ...i.data, attachments: (i.data.attachments || []).map((a) => ({ ...a, id: undefined })) }
    }))
  };
}

export async function importRecords(payload) {
  const accepted = ['ava-library-records', 'ava-library-handover'];
  if (!accepted.includes(payload?.format)) throw new Error('Not a Library records file');
  let n = 0;
  for (const record of payload.items || []) {
    if (!TYPES[record.type]) continue;
    // Files cannot travel in a records file, so start each entry without them.
    await saveItem({ type: record.type, data: { ...record.data, attachments: [] } });
    n++;
  }
  return n;
}

export async function eraseVault() {
  await db.destroyEverything();
  state.items = new Map();
  state.texts = null;
  state.open = false;
  emit();
}
