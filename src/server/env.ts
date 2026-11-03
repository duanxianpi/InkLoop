import type { Env as AuthEnv, State, session } from './auth/common';
import type { ChangeHub } from './hub';

export interface Env extends AuthEnv {
  ASSETS: Fetcher;
  /** Private bucket for canvas documents and immutable Snapshot images. Never publicly exposed. */
  STORAGE: R2Bucket;
  /** Pushes change notifications to open pages over WebSockets. */
  CHANGE_HUB: DurableObjectNamespace<ChangeHub>;
}

/** Authorization context every application service runs under. */
export interface AppContext {
  db: D1Database;
  storage: R2Bucket;
  authEpoch: number;
  /** Best-effort notification after a D1 commit. Failure must never turn a committed write into an API failure. */
  hub?: { notify(seq: number, authEpoch: number): Promise<void> };
}

/** The deployment's single change hub (one owner, one object). */
export const changeHub = (env: Env) => env.CHANGE_HUB.get(env.CHANGE_HUB.idFromName('owner'));

export function appContext(env: Env, authEpoch: number): AppContext {
  return {
    db: env.DB,
    storage: env.STORAGE,
    authEpoch,
    hub: { notify: (seq, epoch) => changeHub(env).notify(seq, epoch) },
  };
}

/** Hono request variables: resolved once, reused by the mounted route groups. */
export interface ServerEnv {
  Bindings: Env;
  Variables: {
    authState: State;
    user: NonNullable<Awaited<ReturnType<typeof session>>>;
    services: import('./services').Services;
  };
}
