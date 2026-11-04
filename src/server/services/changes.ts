import type { ChangeResult } from '../../shared/model';
import { LIMITS } from '../../shared/limits';
import type { AppContext } from '../env';

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

export function changeService(ctx: AppContext) {
  const current = async () =>
    (await ctx.db.prepare('SELECT seq FROM change_counter WHERE id = 1').first<{ seq: number }>())!
      .seq;
  return {
    /** Without `since`, the current counter at once; otherwise a bounded wait until it differs. */
    async wait(
      since: number | null,
      timeoutMs: number,
      signal?: AbortSignal,
    ): Promise<ChangeResult> {
      let seq = await current();
      if (since === null || seq !== since) return { seq, changed: since !== null };
      const checks = Math.min(
        LIMITS.longPollMaxChecks,
        Math.floor(timeoutMs / LIMITS.longPollIntervalMs),
      );
      for (let check = 0; check < checks && !signal?.aborted; check++) {
        await sleep(LIMITS.longPollIntervalMs, signal);
        if (signal?.aborted) break;
        seq = await current();
        if (seq !== since) return { seq, changed: true };
      }
      return { seq, changed: false };
    },
  };
}
