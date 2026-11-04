import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = fileURLToPath(new URL('../../node_modules/.bin/wrangler', import.meta.url));
const buildScript = fileURLToPath(new URL('./build.mjs', import.meta.url));
const maintenance = fileURLToPath(new URL('./maintenance.ts', import.meta.url));

/** Injectable process runner lets tests prove ordering without touching cloud resources. */
export function deploy(extra = [], execute = spawnSync) {
  const options = { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } };
  const run = (args) => execute(cli, [...args, ...extra], options);
  const show = (result) => {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  };

  // No migration, provisioning or publish may run before a successful fresh build.
  const built = execute(process.execPath, [buildScript], options);
  show(built);
  if (built.status !== 0) return built.status ?? 1;

  let migration = run(['d1', 'migrations', 'apply', 'DB', '--remote']);
  if (migration.status !== 0) {
    const output = `${migration.stdout ?? ''}\n${migration.stderr ?? ''}`;
    if (
      !/Couldn't find an auto-provisioned D1 DB|Couldn't find a D1 DB|database.*not found/i.test(
        output,
      )
    ) {
      show(migration);
      return migration.status ?? 1;
    }
    console.log('First deployment: provision resources with a fail-closed maintenance entrypoint.');
    const provision = run(['deploy', maintenance, '--experimental-auto-create']);
    show(provision);
    if (provision.status !== 0) return provision.status ?? 1;
    migration = run(['d1', 'migrations', 'apply', 'DB', '--remote']);
  }
  show(migration);
  if (migration.status !== 0) return migration.status ?? 1;
  const consoleUrl = d1ConsoleUrl(run);
  const deployed = run([
    'deploy',
    '--experimental-auto-create',
    ...(consoleUrl ? ['--var', `D1_CONSOLE_URL:${consoleUrl}`] : []),
  ]);
  show(deployed);
  return deployed.status ?? 1;
}

/**
 * The Cloudflare dashboard's D1 Studio page for this Worker's database, shown on the setup page
 * so the owner can find the claim key. Best effort: any lookup failure only omits the link.
 * Auto-provisioned databases are named `<worker>-db`.
 */
export function d1ConsoleUrl(run) {
  try {
    const name = /"name"\s*:\s*"([^"]+)"/.exec(
      readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'),
    )?.[1];
    const who = run(['whoami', '--json']);
    const list = run(['d1', 'list', '--json']);
    if (!name || who.status !== 0 || list.status !== 0) return null;
    const accounts = JSON.parse(who.stdout).accounts ?? [];
    const database = JSON.parse(list.stdout).find((entry) => entry.name === `${name}-db`);
    if (accounts.length !== 1 || !database?.uuid) return null;
    return `https://dash.cloudflare.com/${accounts[0].id}/workers/d1/databases/${database.uuid}/studio`;
  } catch {
    return null;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(deploy(process.argv.slice(2)));
}
