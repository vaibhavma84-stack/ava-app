// Unlock with Face ID (or Touch ID), through a passkey.
//
// A passkey kept by the phone can hand back a secret only after Face ID
// succeeds -- the WebAuthn "PRF" extension, in Safari from iOS 18. That secret
// is stretched into a key which wraps a second copy of the vault key. The
// passcode's copy is untouched, so the passcode always still works, and
// nothing that could open the vault is stored in the clear.

import { randomBytes, toBase64, fromBase64 } from './crypto.js';

const INFO = new TextEncoder().encode('AVA vault unlock v1');

export class FaceIdError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** Whether this phone has Face ID or Touch ID a web app can use. */
export async function available() {
  try {
    return Boolean(window.PublicKeyCredential
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

async function wrappingKey(secret) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Ask the passkey for its secret for this salt. Prompts for Face ID. */
async function evaluate(credentialId, salt) {
  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: 'public-key', id: credentialId }],
        userVerification: 'required',
        timeout: 60000,
        extensions: { prf: { eval: { first: salt } } }
      }
    });
  } catch (ex) {
    throw cancelled(ex);
  }
  const secret = assertion?.getClientExtensionResults?.().prf?.results?.first;
  if (!secret) throw new FaceIdError('This iPhone cannot unlock AVA with Face ID yet. It needs iOS 18 or later.', 'UNSUPPORTED');
  return new Uint8Array(secret);
}

function cancelled(ex) {
  if (ex instanceof FaceIdError) return ex;
  if (ex?.name === 'NotAllowedError' || ex?.name === 'AbortError') return new FaceIdError('Face ID was cancelled', 'CANCELLED');
  return new FaceIdError(ex?.message || 'Face ID did not work', 'FAILED');
}

/**
 * Make a passkey for this vault and wrap the vault key under its secret.
 * Returns the record to keep in the vault's metadata.
 */
export async function enroll(dek) {
  const salt = randomBytes(32);
  let credential;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'AVA' },
        user: { id: randomBytes(16), name: 'AVA vault', displayName: 'AVA vault on this iPhone' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000,
        extensions: { prf: { eval: { first: salt } } }
      }
    });
  } catch (ex) {
    throw cancelled(ex);
  }
  const ext = credential.getClientExtensionResults?.() || {};
  if (ext.prf?.enabled === false) {
    throw new FaceIdError('This iPhone cannot unlock AVA with Face ID yet. It needs iOS 18 or later.', 'UNSUPPORTED');
  }
  const credentialId = new Uint8Array(credential.rawId);
  // Some platforms return the secret at creation; others only when it is used.
  const first = ext.prf?.results?.first;
  const secret = first ? new Uint8Array(first) : await evaluate(credentialId, salt);

  const key = await wrappingKey(secret);
  const iv = randomBytes(12);
  const raw = await crypto.subtle.exportKey('raw', dek);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw);
  return {
    v: 1,
    credentialId: toBase64(credentialId),
    salt: toBase64(salt),
    wrapIv: toBase64(iv),
    wrappedDek: toBase64(wrapped),
    createdAt: Date.now()
  };
}

/** Face ID, then the vault key. Throws a FaceIdError when it cannot. */
export async function unlock(record) {
  const secret = await evaluate(fromBase64(record.credentialId), fromBase64(record.salt));
  const key = await wrappingKey(secret);
  let raw;
  try {
    raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(record.wrapIv) }, key, fromBase64(record.wrappedDek));
  } catch {
    throw new FaceIdError('Face ID no longer matches this vault. Use your passcode, then turn Face ID on again.', 'STALE');
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}
