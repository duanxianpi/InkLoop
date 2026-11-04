import { DomainError } from '../../shared/errors';
import type { AppContext } from '../env';

// D1 helpers shared by the product services. Every product write goes through `commit`, so the
// owner's auth epoch and the write's precondition are checked inside the same transaction.

export const now = () => Date.now();
export const iso = (ms: number) => new Date(ms).toISOString();

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
/** Sortable by creation time, then random: `snap_0mh2k3x1a_x8k2m9q0p1`. */
export function newId(prefix: string) {
  const random = crypto.getRandomValues(new Uint8Array(10));
  let suffix = '';
  for (const byte of random) suffix += ALPHABET[byte % 36];
  return `${prefix}_${now().toString(36).padStart(9, '0')}_${suffix}`;
}

export async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A precondition that evaluates to 1 when the write may proceed. */
export interface Condition {
  sql: string;
  binds: unknown[];
}
export const ALWAYS: Condition = { sql: '1', binds: [] };

export type Committed = { ok: true; results: D1Result[] } | { ok: false };

/**
 * Run `statements` as one D1 transaction, guarded by the auth epoch and `condition`.
 * Returns `{ ok: false }` only when the precondition definitely rolled the batch back; any other
 * failure propagates, because its outcome may be unknown.
 */
export async function commit(
  ctx: AppContext,
  condition: Condition,
  statements: D1PreparedStatement[],
): Promise<Committed> {
  try {
    const results = await ctx.db.batch([
      ctx.db
        .prepare(`INSERT INTO write_guards (auth_epoch, ok) VALUES (?, (${condition.sql}))`)
        .bind(ctx.authEpoch, ...condition.binds),
      ...statements,
      ctx.db.prepare('DELETE FROM write_guards'),
    ]);
    return { ok: true, results: results.slice(1, -1) };
  } catch (error) {
    const message = String((error as Error)?.message ?? '');
    if (message.includes('precondition_failed')) return { ok: false };
    if (message.includes('auth_epoch_changed'))
      throw new DomainError('unauthorized', 'Authorization changed; sign in again');
    throw error;
  }
}

export const isUniqueViolation = (error: unknown) =>
  /UNIQUE constraint failed: idempotency/.test(String((error as Error)?.message ?? ''));

/** Advance the change counter. Put it last in a batch; read the value with `committedSeq`. */
export const bumpCounter = (ctx: AppContext) =>
  ctx.db.prepare('UPDATE change_counter SET seq = seq + 1 WHERE id = 1 RETURNING seq');

export function committedSeq(result: D1Result | undefined): number | null {
  const row = result?.results?.[0] as { seq?: number } | undefined;
  return typeof row?.seq === 'number' ? row.seq : null;
}

/** Best-effort, after the commit: a failed notification never fails the write (catch-up finds it). */
export async function notify(ctx: AppContext, seq: number | null) {
  if (seq === null || !ctx.hub) return;
  try {
    await ctx.hub.notify(seq, ctx.authEpoch);
  } catch {
    console.error('change_notify_failed');
  }
}

/** Previous result for (operation, key), or null. The same key with different input is a conflict. */
export async function replay<T>(
  ctx: AppContext,
  operation: string,
  key: string,
  fingerprint: string,
): Promise<T | null> {
  const row = await ctx.db
    .prepare('SELECT fingerprint, result FROM idempotency WHERE operation = ? AND key = ?')
    .bind(operation, key)
    .first<{ fingerprint: string; result: string }>();
  if (!row) return null;
  if (row.fingerprint !== fingerprint)
    throw new DomainError('idempotency_conflict', 'This key was already used for another request');
  return JSON.parse(row.result) as T;
}

export const record = (
  ctx: AppContext,
  operation: string,
  key: string,
  fingerprint: string,
  result: unknown,
) =>
  ctx.db
    .prepare(
      'INSERT INTO idempotency (operation, key, fingerprint, result, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(operation, key, fingerprint, JSON.stringify(result), now());
