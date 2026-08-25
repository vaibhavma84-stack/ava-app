// Shared with AVA (../../js/). Kept as a copy so the two apps stay
// independent; any fix here must be applied there as well.
// Encryption at rest.
//
// Passcode -> PBKDF2(SHA-256) -> KEK. A random 256-bit DEK is generated once and
// stored only in KEK-wrapped form. Changing the passcode rewraps the DEK, so it
// never requires re-encrypting the whole vault.
//
// Every item payload and every file blob is encrypted with the DEK using AES-GCM
// with a fresh 96-bit IV. The GCM auth tag doubles as the passcode verifier:
// a wrong passcode fails to unwrap the DEK, so there is no separate hash to attack.

const PBKDF2_ITERATIONS = 310000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function toBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

async function deriveKEK(passcode, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Build the key material for a brand new vault. Returns the meta record to persist. */
export async function createVaultKey(passcode) {
  const salt = randomBytes(SALT_BYTES);
  const kek = await deriveKEK(passcode, salt, PBKDF2_ITERATIONS);
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const rawDek = await crypto.subtle.exportKey('raw', dek);
  const iv = randomBytes(IV_BYTES);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, rawDek);
  return {
    meta: {
      v: 1,
      salt: toBase64(salt),
      iterations: PBKDF2_ITERATIONS,
      wrapIv: toBase64(iv),
      wrappedDek: toBase64(wrapped),
      createdAt: Date.now()
    },
    dek
  };
}

/** Unwrap the DEK with a passcode. Throws if the passcode is wrong. */
export async function unlockVaultKey(passcode, meta) {
  const kek = await deriveKEK(passcode, fromBase64(meta.salt), meta.iterations);
  let rawDek;
  try {
    rawDek = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(meta.wrapIv) },
      kek,
      fromBase64(meta.wrappedDek)
    );
  } catch {
    const err = new Error('Incorrect passcode');
    err.code = 'BAD_PASSCODE';
    throw err;
  }
  return crypto.subtle.importKey('raw', rawDek, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

/** Rewrap an already-unlocked DEK under a new passcode. Data is untouched. */
export async function rewrapVaultKey(dek, newPasscode) {
  const salt = randomBytes(SALT_BYTES);
  const kek = await deriveKEK(newPasscode, salt, PBKDF2_ITERATIONS);
  const rawDek = await crypto.subtle.exportKey('raw', dek);
  const iv = randomBytes(IV_BYTES);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, rawDek);
  return {
    v: 1,
    salt: toBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    wrapIv: toBase64(iv),
    wrappedDek: toBase64(wrapped),
    createdAt: Date.now()
  };
}

export async function encryptBytes(dek, buffer) {
  const iv = randomBytes(IV_BYTES);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, buffer);
  return { iv, ct };
}

export async function decryptBytes(dek, iv, ct) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dek, ct);
}

export async function encryptJSON(dek, obj) {
  return encryptBytes(dek, enc.encode(JSON.stringify(obj)));
}

export async function decryptJSON(dek, iv, ct) {
  return JSON.parse(dec.decode(await decryptBytes(dek, iv, ct)));
}

/** Rough strength signal for the passcode setup screen. */
export function passcodeStrength(pc) {
  if (!pc) return { score: 0, label: 'Enter a passcode' };
  let score = 0;
  if (pc.length >= 6) score++;
  if (pc.length >= 10) score++;
  if (pc.length >= 14) score++;
  if (/[a-z]/.test(pc) && /[A-Z]/.test(pc)) score++;
  if (/\d/.test(pc)) score++;
  if (/[^A-Za-z0-9]/.test(pc)) score++;
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong', 'Very strong'];
  return { score: Math.min(score, 5), label: labels[Math.min(score, 6)] };
}
