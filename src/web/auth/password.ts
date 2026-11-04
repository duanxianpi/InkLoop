import { PASSWORD_KDF, type PasswordCredential, type PasswordParams } from '../../shared/auth';

// The password never leaves the browser: it is stretched here with PBKDF2-SHA256 and only the
// 32-byte result is sent (see src/server/auth/owner.ts). Each new password gets a new random salt.

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromBase64url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function stretch(password: string, { salt, iterations }: PasswordParams) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64url(salt), iterations },
    key,
    256,
  );
  return base64url(new Uint8Array(bits));
}

export async function newCredential(password: string): Promise<PasswordCredential> {
  const params = {
    salt: base64url(crypto.getRandomValues(new Uint8Array(16))),
    iterations: PASSWORD_KDF.iterations,
  };
  return { ...params, derived: await stretch(password, params) };
}
