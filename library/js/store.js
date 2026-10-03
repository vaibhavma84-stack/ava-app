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

/**
 * Write an entry, merging what is given over what is already there.
 *
 * `drop` names fields to take off the record. Leaving a key out of `data` does
 * not remove it -- the merge spreads the stored data first, so an omitted key
 * keeps its old value. Without this there is no way to take a field off an
 * entry at all, and a delete written as `delete data.thing` quietly does
 * nothing.
 */
export async function saveItem({ id, type, data, drop = [] }) {
  const now = Date.now();
  const existing = id ? state.items.get(id) : null;
  const merged = { ...(existing?.data || {}), ...data };
  for (const key of drop) delete merged[key];
  const item = {
    id: id || newId(),
    type: type || existing?.type,
    data: merged,
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

// ── lists kept beside the entries ───────────────────────────────────────────
//
// Saved answers, checklists, pinned pages: things that belong to the library
// as a whole rather than to one entry. Each is one list under its own name,
// and every one of them travels in a full backup.

export const LISTS = ['savedAnswers', 'checklists', 'pins', 'recent', 'askQueue', 'kits', 'tiles'];
const lists = new Map();

export async function getList(name) {
  if (!lists.has(name)) lists.set(name, (await db.getMeta(`list:${name}`)) || []);
  return lists.get(name);
}

export async function setList(name, rows) {
  lists.set(name, rows);
  await db.setMeta(`list:${name}`, rows);
  emit();
}

/** What a list holds right now, without waiting: [] until it is first read. */
export const peekList = (name) => lists.get(name) || [];

// ── full backup ─────────────────────────────────────────────────────────────
//
// Everything: the entries as they are, with their own ids, the text read out
// of every file, and the files themselves. For moving to a new phone, where
// re-attaching a few hundred manuals by hand is not a real option.
//
// The caller packs it into zips. This side only says what goes in, and puts
// it back.

export const FULL_FORMAT = 'ava-library-full';

const safeName = (name) => String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120);

/**
 * What a full backup holds: { manifest, texts, files: [{ path, blob, size }] }.
 * The manifest names the path of every file, so a restore can tell a file it
 * was not given from one that never existed.
 */
export async function fullBackup() {
  const texts = await loadTexts();
  const items = allItems();
  const files = [];
  const textOut = {};
  const paths = {};
  for (const item of items) {
    for (const att of item.data?.attachments || []) {
      if (texts.has(att.id)) textOut[att.id] = texts.get(att.id);
      const row = await db.get(db.STORE_BLOBS, att.id);
      if (!row?.blob) continue;
      const path = `files/${att.id}/${safeName(att.name)}`;
      paths[att.id] = path;
      files.push({ path, blob: row.blob, size: row.blob.size, type: row.type });
    }
  }
  const manifest = {
    format: FULL_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    counts: { items: items.length, files: files.length },
    files: paths,
    items,
    lists: Object.fromEntries(await Promise.all(LISTS.map(async (n) => [n, await getList(n)])))
  };
  return { manifest, texts: textOut, files };
}

/**
 * Put a full backup back.
 *
 * `blobFor(path)` returns the file stored at that path in whichever part it
 * was given, or null. Entries come back under their own ids, so restoring
 * onto a phone that already has some of them replaces them rather than
 * doubling them. A file that was not among the parts given is left off its
 * entry, and counted, rather than leaving an entry pointing at nothing --
 * unless this phone already holds it.
 */
/**
 * The bytes of a blob, copied out into a blob of their own.
 *
 * A file in a backup is a slice from the middle of the zip that was picked.
 * Safari on the iPhone keeps such a slice in the database as the picked file
 * and loses where in it the slice began, so a PDF came back starting at the
 * zip's first byte rather than its own -- "Invalid Root reference" when it
 * was opened. Copied out, a slice is only its own bytes. Read a piece at a
 * time, so a large manual is not one great block of memory.
 */
async function ownBytes(blob, type) {
  const STEP = 8 * 1024 * 1024;
  const parts = [];
  for (let at = 0; at < blob.size; at += STEP) {
    parts.push(await blob.slice(at, Math.min(blob.size, at + STEP)).arrayBuffer());
  }
  return new Blob(parts, { type });
}

export async function restoreFull(manifest, texts, blobFor) {
  if (manifest?.format !== FULL_FORMAT) throw new Error('Not a Library full backup');
  let items = 0, files = 0, missing = 0, keptEdits = 0;
  for (const saved of manifest.items || []) {
    if (!TYPES[saved.type]) continue;
    // A question answered on this phone is not written over by a newer copy
    // of the same question from a pack; the phone's own backup still restores it.
    const here = state.items.get(saved.id);
    if (TYPES[saved.type].keepEdits && here?.data?.editedOnPhone && !saved.data?.editedOnPhone) {
      keptEdits++;
      continue;
    }
    const kept = [];
    for (const att of saved.data?.attachments || []) {
      const path = manifest.files?.[att.id];
      const blob = path ? await blobFor(path) : null;
      if (blob) {
        const type = att.type || blob.type || 'application/octet-stream';
        await db.put(db.STORE_BLOBS, { id: att.id, size: blob.size, type, blob: await ownBytes(blob, type) });
        files++;
      } else if (!(await db.get(db.STORE_BLOBS, att.id))?.blob) {
        if (path) missing++;
        continue;
      }
      if (texts?.[att.id]) await db.put(db.STORE_TEXTS, { id: att.id, pages: texts[att.id] });
      kept.push(att);
    }
    const item = { ...saved, data: { ...saved.data, attachments: kept } };
    await db.put(db.STORE_ITEMS, { id: item.id, updatedAt: item.updatedAt || Date.now(), data: item });
    state.items.set(item.id, item);
    items++;
  }
  // A list comes back merged with what is here, by id, so restoring onto a
  // phone in use keeps what was saved on it since.
  for (const name of LISTS) {
    const saved = manifest.lists?.[name];
    if (!Array.isArray(saved)) continue;
    const here = await getList(name);
    const ids = new Set(here.map((r) => r.id));
    await setList(name, [...here, ...saved.filter((r) => !ids.has(r.id))]);
  }
  state.texts = null;
  emit();
  return { items, files, missing, keptEdits };
}

export async function eraseVault() {
  lists.clear();
  await db.destroyEverything();
  state.items = new Map();
  state.texts = null;
  state.open = false;
  emit();
}
