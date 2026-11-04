// Caches of the service worker (src/sw/sw.ts). Their names stay the same across builds.
export const CACHES = {
  /** Hashed and versioned files under /assets, pruned to the current build's files. */
  assets: 'inkloop-assets',
  /** The page shell, for opening the board offline. */
  shell: 'inkloop-shell',
  /** The board's last reads of the owner's problems; cleared on sign-out or a 401. */
  data: 'inkloop-data',
} as const;
