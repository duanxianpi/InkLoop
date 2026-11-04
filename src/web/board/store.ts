import { useSyncExternalStore } from 'react';

/**
 * A minimal external store. While held (a pen stroke is in progress) updates accumulate without
 * re-rendering anything; release() applies them at once (Specification §4.2, §19.1).
 */
export function createStore<T extends object>(initial: T) {
  let state = initial;
  let held = 0;
  let pending = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    get: () => state,
    set(patch: Partial<T> | ((current: T) => Partial<T>)) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      if (held) pending = true;
      else emit();
    },
    hold() {
      held++;
    },
    release() {
      held = Math.max(0, held - 1);
      if (!held && pending) {
        pending = false;
        emit();
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
export type Store<T extends object> = ReturnType<typeof createStore<T>>;

export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
