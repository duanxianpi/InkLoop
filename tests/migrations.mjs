import { readdir, readFile } from 'node:fs/promises';

const directory = new URL('../migrations/', import.meta.url);

/**
 * Apply every migration in order, as Wrangler does. D1's exec() runs one statement per line, so
 * comments are dropped and multi-line statements (tables, triggers) are joined onto one line.
 */
export async function applyMigrations(db, until = Infinity) {
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files.slice(0, until)) {
    const sql = (await readFile(new URL(file, directory), 'utf8'))
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .replace(/\n(?!CREATE|INSERT|\n|$)/g, ' ');
    await db.exec(sql);
  }
}
