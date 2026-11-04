// Canvas content on this device, in IndexedDB (Architecture §7). A draft is unacknowledged content,
// stored before any network request and deleted once the server has acknowledged exactly its
// version. A saved canvas is the last content the server acknowledged, for opening offline.
// Each record carries the revision it belongs to, so it is never mistaken for newer server state.

export interface Draft {
  problem_id: string;
  /** Serialized tldraw document, exactly as it will be uploaded. */
  document: string;
  fingerprint: string;
  has_content: boolean;
  /** Server revision and edit epoch this content was written on top of. */
  base_revision: number;
  edit_epoch: number;
  version: number;
  updated_at: number;
}

export interface SavedCanvas {
  problem_id: string;
  /** The acknowledged document; null before the first save. */
  document: string | null;
  fingerprint: string | null;
  revision: number;
  edit_epoch: number;
}

const DB_NAME = 'inkloop';
const DRAFTS = 'drafts';
const SAVED = 'saved_canvases';
type Store = typeof DRAFTS | typeof SAVED;
const memory = { [DRAFTS]: new Map<string, Draft>(), [SAVED]: new Map<string, SavedCanvas>() };
let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 2);
      request.onupgradeneeded = () => {
        for (const name of [DRAFTS, SAVED])
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name, { keyPath: 'problem_id' });
      };
      request.onsuccess = () => {
        // Another tab upgrading the database: let it, and keep using memory here.
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      // Private browsing or blocked storage: keep drafts for this page's lifetime only.
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

async function run<T>(
  name: Store,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(name, mode);
    const request = action(transaction.objectStore(name));
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const drafts = {
  async get(problemId: string): Promise<Draft | null> {
    const stored = await run<Draft>(DRAFTS, 'readonly', (store) => store.get(problemId)).catch(
      () => undefined,
    );
    return stored ?? memory[DRAFTS].get(problemId) ?? null;
  },
  async put(draft: Draft) {
    memory[DRAFTS].set(draft.problem_id, draft);
    await run(DRAFTS, 'readwrite', (store) => store.put(draft)).catch(() => undefined);
  },
  /** Remove the draft only if it is still `version`; a newer local edit must survive. */
  async settle(problemId: string, version: number) {
    if (memory[DRAFTS].get(problemId)?.version === version) memory[DRAFTS].delete(problemId);
    await run(DRAFTS, 'readwrite', (store) => {
      const request = store.get(problemId);
      request.onsuccess = () => {
        if ((request.result as Draft | undefined)?.version === version) store.delete(problemId);
      };
    }).catch(() => undefined);
  },
  async remove(problemId: string) {
    memory[DRAFTS].delete(problemId);
    await run(DRAFTS, 'readwrite', (store) => store.delete(problemId)).catch(() => undefined);
  },
};

export const savedCanvases = {
  /** Resume changes the edit epoch, not the document. Only advance a matching revision: a
   * different revision belongs to other content and must never be relabelled as this one. */
  async advanceEpoch(problemId: string, revision: number, editEpoch: number) {
    const advance = (saved: SavedCanvas | undefined) =>
      saved && saved.revision === revision && saved.edit_epoch < editEpoch
        ? { ...saved, edit_epoch: editEpoch }
        : undefined;
    const updated = advance(memory[SAVED].get(problemId));
    if (updated) memory[SAVED].set(problemId, updated);
    await run(SAVED, 'readwrite', (store) => {
      const request = store.get(problemId);
      request.onsuccess = () => {
        const updated = advance(request.result as SavedCanvas | undefined);
        if (updated) store.put(updated);
      };
    }).catch(() => undefined);
  },
  async get(problemId: string): Promise<SavedCanvas | null> {
    const stored = await run<SavedCanvas>(SAVED, 'readonly', (store) => store.get(problemId)).catch(
      () => undefined,
    );
    return stored ?? memory[SAVED].get(problemId) ?? null;
  },
  /** Keep `saved` unless this device already holds a later acknowledged revision. */
  async put(saved: SavedCanvas) {
    const known = memory[SAVED].get(saved.problem_id);
    if (!known || !isOlder(saved, known)) memory[SAVED].set(saved.problem_id, saved);
    await run(SAVED, 'readwrite', (store) => {
      const request = store.get(saved.problem_id);
      request.onsuccess = () => {
        const stored = request.result as SavedCanvas | undefined;
        if (!stored || !isOlder(saved, stored)) store.put(saved);
      };
    }).catch(() => undefined);
  },
  async remove(problemId: string) {
    memory[SAVED].delete(problemId);
    await run(SAVED, 'readwrite', (store) => store.delete(problemId)).catch(() => undefined);
  },
  /** Signing out: no copy of the owner's work stays readable without the server. */
  async clear() {
    memory[SAVED].clear();
    await run(SAVED, 'readwrite', (store) => store.clear()).catch(() => undefined);
  },
};

const isOlder = (a: SavedCanvas, b: SavedCanvas) =>
  a.edit_epoch < b.edit_epoch || (a.edit_epoch === b.edit_epoch && a.revision < b.revision);
