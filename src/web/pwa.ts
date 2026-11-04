import { CACHES } from '../shared/offline';
import { savedCanvases } from './sync/drafts';

/** Install the service worker that lets the installed board open offline (src/sw/sw.ts). */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  addEventListener('load', () => {
    // Unsupported or refused: the app works the same online.
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

/** Signing out removes this device's offline copies of the owner's problems. */
export async function forgetOfflineData() {
  if ('caches' in globalThis) await caches.delete(CACHES.data);
  await savedCanvases.clear();
}
