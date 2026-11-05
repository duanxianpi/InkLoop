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

  // Account-level R2 activation is separate from bucket auto-provisioning. Check before any
  // migration or maintenance deployment, so a new account cannot fail halfway through setup.
  const r2 = run(['r2', 'bucket', 'list']);
  if (r2.status !== 0) {
    show(r2);
    const output = `${r2.stdout ?? ''}\n${r2.stderr ?? ''}`;
    if (/\b10042\b|please enable R2|R2.*not enabled/i.test(output)) {
      console.error(
        'R2 is not enabled for the target Cloudflare account. Before deploying InkLoop, open ' +
          'Cloudflare Dashboard > Storage & databases > R2 > Overview and complete the R2 ' +
          'subscription checkout. Then retry this deployment. InkLoop can create a bucket ' +
          'after activation, but cannot activate the account subscription for you.\n' +
          'Instructions: https://developers.cloudflare.com/r2/get-started/#before-you-begin',
      );
    } else {
      console.error(
        'R2 availability check failed. Check the Cloudflare account, deployment credentials, ' +
          'R2 permissions and connectivity, then retry. No migrations or deployments were attempted.',
      );
    }
    return r2.status ?? 1;
  }

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
 * Open the database overview first, then let the owner choose Explore Data. Direct Studio links
 * can fail on the dashboard's initial load. Fall back to the account D1 list if DB lookup fails;
 * an ambiguous account leaves the UI's generic D1 link in place.
 */
export function d1ConsoleUrl(run) {
  try {
    const who = run(['whoami', '--json']);
    if (who.status !== 0) return null;
    const accounts = JSON.parse(who.stdout).accounts ?? [];
    if (accounts.length !== 1 || !accounts[0].id) return null;
    const base = `https://dash.cloudflare.com/${accounts[0].id}/workers/d1`;
    const name = /"name"\s*:\s*"([^"]+)"/.exec(
      readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'),
    )?.[1];
    const list = run(['d1', 'list', '--json']);
    if (!name || list.status !== 0) return base;
    try {
      const databases = JSON.parse(list.stdout);
      const database = Array.isArray(databases)
        ? databases.find((entry) => entry.name === `${name}-db`)
        : null;
      return database?.uuid ? `${base}/databases/${database.uuid}/metrics` : base;
    } catch {
      return base;
    }
  } catch {
    return null;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(deploy(process.argv.slice(2)));
}
