import type { Preferences } from '../../shared/model';
import type { AppContext } from '../env';
import { ALWAYS, commit, now } from './store';

export function preferenceService(ctx: AppContext) {
  async function get(): Promise<Preferences> {
    const { results } = await ctx.db
      .prepare('SELECT key, value FROM preferences')
      .all<{ key: string; value: string }>();
    return Object.fromEntries(results.map((row) => [row.key, JSON.parse(row.value)]));
  }
  return {
    get,
    /** Merge keys; a null value removes the key. */
    async update(values: Preferences): Promise<Preferences> {
      const time = now();
      const statements = Object.entries(values).map(([key, value]) =>
        value === null
          ? ctx.db.prepare('DELETE FROM preferences WHERE key = ?').bind(key)
          : ctx.db
              .prepare(
                'INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
              )
              .bind(key, JSON.stringify(value), time),
      );
      if (statements.length) await commit(ctx, ALWAYS, statements);
      return get();
    },
  };
}
