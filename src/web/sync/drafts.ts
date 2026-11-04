// Unacknowledged canvas content, kept in IndexedDB before any network request (Architecture §7).
// A draft is deleted once the server has acknowledged exactly its version.

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

const DB_NAME = 'inkloop';
const STORE = 'drafts';
const memory = new Map<string, Draft>();
let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORE, { keyPath: 'problem_id' });
      request.onsuccess = () => resolve(request.result);
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
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const drafts = {
  async get(problemId: string): Promise<Draft | null> {
    const stored = await run<Draft>('readonly', (store) => store.get(problemId)).catch(
      () => undefined,
    );
    return stored ?? memory.get(problemId) ?? null;
  },
  async put(draft: Draft) {
    memory.set(draft.problem_id, draft);
    await run('readwrite', (store) => store.put(draft)).catch(() => undefined);
  },
  /** Remove the draft only if it is still `version`; a newer local edit must survive. */
  async settle(problemId: string, version: number) {
    if (memory.get(problemId)?.version === version) memory.delete(problemId);
    await run('readwrite', (store) => {
      const request = store.get(problemId);
      request.onsuccess = () => {
        if ((request.result as Draft | undefined)?.version === version) store.delete(problemId);
      };
    }).catch(() => undefined);
  },
  async remove(problemId: string) {
    memory.delete(problemId);
    await run('readwrite', (store) => store.delete(problemId)).catch(() => undefined);
  },
};
