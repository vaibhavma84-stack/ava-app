// The vault: decrypt-on-unlock, encrypt-on-write.
//
// Records are small, so on unlock every item is decrypted into memory. Search and
// filtering are then instant, and nothing on disk is readable without the
// passcode -- there are no plaintext index columns to leak.

import * as db from './db.js';
import * as sec from './crypto.js';
import { TYPES } from './schema.js';

const state = {
  dek: null,
  items: new Map(),
  listeners: new Set()
};

export function isUnlocked() { return state.dek !== null; }

export function onChange(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

function emit() { for (const fn of state.listeners) fn(); }

export function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

// ── vault lifecycle ─────────────────────────────────────────────────────────

export async function isInitialized() {
  return (await db.getMeta('vaultKey')) !== undefined;
}

export async function initialize(passcode) {
  if (await isInitialized()) throw new Error('A vault already exists on this device');
  const { meta, dek } = await sec.createVaultKey(passcode);
  await db.setMeta('vaultKey', meta);
  state.dek = dek;
  state.items = new Map();
  await db.requestPersistence();
  emit();
}

export async function unlock(passcode) {
  const meta = await db.getMeta('vaultKey');
  if (!meta) throw new Error('No vault on this device');
  state.dek = await sec.unlockVaultKey(passcode, meta);
  await loadAll();
  emit();
}

export function lock() {
  state.dek = null;
  state.items = new Map();
  emit();
}

export async function changePasscode(currentPasscode, newPasscode) {
  const meta = await db.getMeta('vaultKey');
  // Re-derive from the current passcode so a wrong entry cannot rewrap the vault.
  const dek = await sec.unlockVaultKey(currentPasscode, meta);
  await db.setMeta('vaultKey', await sec.rewrapVaultKey(dek, newPasscode));
}

async function loadAll() {
  const rows = await db.getAll(db.STORE_ITEMS);
  const items = new Map();
  for (const row of rows) {
    try {
      const item = await sec.decryptJSON(state.dek, row.iv, row.ct);
      items.set(item.id, item);
    } catch {
      console.warn('Skipping unreadable record', row.id);
    }
  }
  state.items = items;
}

// ── items ───────────────────────────────────────────────────────────────────

function requireUnlocked() {
  if (!state.dek) throw new Error('Vault is locked');
}

export function allItems() { return [...state.items.values()]; }
export function getItem(id) { return state.items.get(id); }

/** Items of one type, sorted by that type's own rule (pinned first where supported). */
export function itemsOfType(type) {
  const def = TYPES[type];
  const list = allItems().filter((i) => i.type === type);
  list.sort((a, b) => {
    if (def.pinnable && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return def.sort ? def.sort(a.data, b.data) || 0 : b.updatedAt - a.updatedAt;
  });
  return list;
}

export async function saveItem({ id, type, data, pinned }) {
  requireUnlocked();
  const now = Date.now();
  const existing = id ? state.items.get(id) : null;
  const item = {
    id: id || newId(),
    type: type || existing?.type,
    data: { ...(existing?.data || {}), ...data },
    pinned: pinned ?? existing?.pinned ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  // updatedAt is exposed on the row so sorting a restore does not need the key.
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
  }
  await db.del(db.STORE_ITEMS, id);
  state.items.delete(id);
  emit();
}

// -- attachments -------------------------------------------------------------

/**
 * Encrypt a picked file and store its bytes. Returns the descriptor to put on
 * the item. Bytes never touch disk unencrypted.
 */
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

/** Decrypt a stored attachment back into a Blob for viewing or sharing out. */
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
}

/** Total bytes held in encrypted attachments. */
export function attachmentBytes() {
  let total = 0;
  for (const item of state.items.values()) {
    for (const att of item.data?.attachments || []) total += att.size || 0;
  }
  return total;
}

export async function togglePin(id) {
  const item = state.items.get(id);
  if (item) await saveItem({ id, pinned: !item.pinned });
}

// ── search ──────────────────────────────────────────────────────────────────

/** Free-text search across a type, or across everything when type is null. */
export function search(query, type) {
  const q = query.trim().toLowerCase();
  let list = type ? itemsOfType(type) : allItems();
  if (!q) return list;
  const terms = q.split(/\s+/);
  return list.filter((item) => {
    const hay = haystack(item);
    return terms.every((t) => hay.includes(t));
  });
}

function haystack(item) {
  const parts = [];
  for (const [key, value] of Object.entries(item.data || {})) {
    if (key === 'contracts' && Array.isArray(value)) {
      for (const c of value) parts.push(Object.values(c).join(' '));
    } else if (value !== null && value !== undefined) {
      parts.push(String(value));
    }
  }
  parts.push(TYPES[item.type]?.label || '');
  return parts.join(' ').toLowerCase();
}

export function counts() {
  const out = {};
  for (const key of Object.keys(TYPES)) out[key] = 0;
  for (const item of state.items.values()) out[item.type] = (out[item.type] || 0) + 1;
  return out;
}

// ── backup ──────────────────────────────────────────────────────────────────

/** Encrypted backup: ciphertext plus key-wrapping material. Restores only with that passcode. */
export async function exportEncrypted() {
  const meta = await db.getMeta('vaultKey');
  const items = await db.getAll(db.STORE_ITEMS);
  const blobs = await db.getAll(db.STORE_BLOBS);
  return {
    format: 'ava-vault-encrypted',
    version: 1,
    exportedAt: new Date().toISOString(),
    vaultKey: meta,
    items: items.map((r) => ({
      id: r.id, updatedAt: r.updatedAt,
      iv: sec.toBase64(r.iv), ct: sec.toBase64(r.ct)
    })),
    blobs: blobs.map((r) => ({
      id: r.id, size: r.size,
      iv: sec.toBase64(r.iv), ct: sec.toBase64(r.ct)
    }))
  };
}

/** Plaintext export -- readable anywhere, protected by nothing. */
export async function exportPlain() {
  requireUnlocked();
  return {
    format: 'ava-vault-plaintext',
    version: 1,
    exportedAt: new Date().toISOString(),
    warning: 'This file is NOT encrypted. Anyone who opens it can read everything.',
    items: allItems()
  };
}

/** Restore an encrypted backup, replacing the current vault. */
export async function importEncrypted(payload, passcode) {
  if (payload?.format !== 'ava-vault-encrypted') throw new Error('Not an AVA encrypted backup');
  // Verify the passcode against the backup's own key material before touching anything.
  const dek = await sec.unlockVaultKey(passcode, payload.vaultKey);

  await db.clearStore(db.STORE_ITEMS);
  await db.clearStore(db.STORE_BLOBS);
  await db.setMeta('vaultKey', payload.vaultKey);
  await db.putMany(db.STORE_ITEMS, payload.items.map((r) => ({
    id: r.id,
    updatedAt: r.updatedAt,
    iv: sec.fromBase64(r.iv),
    ct: sec.fromBase64(r.ct).buffer
  })));
  await db.putMany(db.STORE_BLOBS, (payload.blobs || []).map((r) => ({
    id: r.id,
    size: r.size,
    iv: sec.fromBase64(r.iv),
    ct: sec.fromBase64(r.ct).buffer
  })));

  state.dek = dek;
  await loadAll();
  emit();
  return state.items.size;
}

export async function eraseVault() {
  await db.destroyEverything();
  state.dek = null;
  state.items = new Map();
  emit();
}
