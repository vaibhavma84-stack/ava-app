// A lock on the app: Face ID (or Touch ID, or the phone's passcode), and a
// PIN for when that cannot be used.
//
// Face ID is reached through a passkey made for this site on this phone. The
// phone asks for the face before it will use the passkey, so a passkey used
// is a face seen. There is no server here to check its signature against,
// and none is needed: what is being asked is whether the person holding the
// phone is its owner, and the phone has just said so.
//
// What this is not: encryption. The library is kept in the browser's storage
// as it always was. The lock keeps the app from opening to anyone who picks
// up an unlocked phone; it does not stop someone with the phone, its
// passcode and a computer.

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

/** Whether this phone can lock with Face ID, Touch ID or its passcode. */
export async function faceAvailable() {
  try {
    return Boolean(window.PublicKeyCredential
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.());
  } catch {
    return false;
  }
}

/** Make the passkey. The phone asks for the face as it is made. */
export async function enrolFace() {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: 'Library', id: location.hostname },
      user: { id: random(16), name: 'Library lock', displayName: 'Library lock' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
      attestation: 'none'
    }
  });
  if (!credential) throw new Error('No passkey was made');
  return b64(credential.rawId);
}

/** Ask for the face. True only if the phone says the owner was checked. */
export async function checkFace(credentialId) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: unb64(credentialId), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000
    }
  });
  if (!assertion) return false;
  // The flags byte of the authenticator data: bit 2 is "user verified".
  const data = new Uint8Array(assertion.response.authenticatorData);
  return data.length > 32 && (data[32] & 0x04) !== 0;
}

/** A PIN, kept only as a slow hash of itself. */
export async function hashPin(pin, salt = b64(random(16))) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(salt), iterations: 150000, hash: 'SHA-256' }, key, 256);
  return { salt, hash: b64(bits) };
}

export async function checkPin(pin, { salt, hash }) {
  return (await hashPin(pin, salt)).hash === hash;
}

/** How long the app may be away before it locks again. */
export const AWAY_CHOICES = [
  { minutes: 0, label: 'At once' },
  { minutes: 1, label: 'After 1 minute' },
  { minutes: 5, label: 'After 5 minutes' },
  { minutes: 15, label: 'After 15 minutes' }
];
